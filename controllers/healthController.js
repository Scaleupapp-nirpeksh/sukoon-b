const { VitalSign, HealthCheckIn, FollowUp } = require('../models/healthModel');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const OpenAI = require('openai');
const { sendPushNotification } = require('../services/notificationService');
const SymptomCorrelationService = require('../services/symptomCorrelationService');

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Record vital sign with enhanced validation and error handling
exports.recordVitalSign = async (req, res) => {
  try {
    const { type, values, unit, notes } = req.body;
    
    // Enhanced validation
    if (!type || !values) {
      return res.status(400).json({
        status: 'error',
        message: 'Type and values are required',
      });
    }
    
    // Validate type
    const validTypes = ['bloodPressure', 'glucose', 'weight', 'temperature', 'heartRate', 'oxygenLevel', 'other'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }
    
    // Type-specific validation
    if (type === 'bloodPressure' && (!values.systolic || !values.diastolic)) {
      return res.status(400).json({
        status: 'error',
        message: 'Blood pressure requires both systolic and diastolic values',
      });
    }
    
    // Calculate derived values
    const derivedValues = calculateDerivedValues(type, values);
    
    // Create new vital sign record
    const vitalSign = new VitalSign({
      userId: req.user._id,
      type,
      values,
      derivedValues,
      unit,
      notes,
      recordedBy: req.user._id,
      isNormal: checkIfNormal(type, values),
      timestamp: new Date(),
      followupRequired: false
    });
    
    await vitalSign.save();
    
    // Generate AI analysis for abnormal readings
    let aiAnalysis = null;
    if (!vitalSign.isNormal) {
      vitalSign.followupRequired = true;
      aiAnalysis = await generateAIHealthInsight(type, values, derivedValues, req.user);
      
      // Save the updated record with AI insights
      if (aiAnalysis) {
        vitalSign.aiInsights = aiAnalysis.insights;
        vitalSign.followupRequired = aiAnalysis.followupRequired;
        await vitalSign.save();
      }
    }
    
    res.status(201).json({
      status: 'success',
      message: 'Vital sign recorded successfully',
      vitalSign,
      derivedValues,
      aiAnalysis: aiAnalysis ? {
        insights: aiAnalysis.insights,
        followupRequired: aiAnalysis.followupRequired
      } : null
    });
  } catch (error) {
    logger.error('Error recording vital sign:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to record vital sign',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get user vital signs with enhanced analytics and filtering
exports.getUserVitalSigns = async (req, res) => {
  try {
    const { type, from, to, page = 1, limit = 10, groupBy } = req.query;
    
    let query = { userId: req.user._id };
    
    // Add type filter if provided
    if (type) {
      query.type = type;
    }
    
    // Add date range filter if provided
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = new Date(from);
      if (to) query.timestamp.$lte = new Date(to);
    }
    
    // Pagination
    const skip = (page - 1) * limit;
    
    // Get total count for pagination
    const total = await VitalSign.countDocuments(query);
    
    // Get vital signs with pagination
    const vitalSigns = await VitalSign.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Calculate trend data with enhanced analytics
    const trendData = await calculateEnhancedTrends(req.user._id, groupBy);
    
    // Calculate correlation data
    const correlationData = await calculateVitalSignCorrelations(req.user._id);
    
    res.status(200).json({
      status: 'success',
      count: vitalSigns.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      vitalSigns,
      trends: trendData,
      correlations: correlationData
    });
  } catch (error) {
    logger.error('Error getting vital signs:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get vital signs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Submit health check-in with AI assessment and dynamic follow-up questions
exports.submitHealthCheckIn = async (req, res) => {
  try {
    const { feeling, symptoms, notes, sleepHours, stressLevel, medicationAdherence, waterIntake, exerciseMinutes } = req.body;
    
    // Validate required fields
    if (!feeling) {
      return res.status(400).json({
        status: 'error',
        message: 'Feeling is required',
      });
    }
    
    // Validate feeling
    const validFeelings = ['good', 'fair', 'poor'];
    if (!validFeelings.includes(feeling)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid feeling. Must be one of: ${validFeelings.join(', ')}`,
      });
    }
    
    // Create new health check-in with additional lifestyle data
    const healthCheckIn = new HealthCheckIn({
      userId: req.user._id,
      feeling,
      symptoms: symptoms || [],
      notes,
      recordedBy: req.user._id,
      sleepHours: sleepHours || null,
      stressLevel: stressLevel || null,
      medicationAdherence: medicationAdherence || null,
      waterIntake: waterIntake || null,
      exerciseMinutes: exerciseMinutes || null,
      conversationStage: 'initial'
    });
    
    // Get AI assessment with follow-up questions if feeling is poor or symptoms are present
    if (feeling === 'poor' || (symptoms && symptoms.length > 0)) {
      const aiResponse = await generateAIHealthAssessmentWithQuestions(
        feeling, 
        symptoms, 
        { sleepHours, stressLevel, medicationAdherence, waterIntake, exerciseMinutes },
        req.user
      );
      
      healthCheckIn.aiAssessment = {
        riskLevel: aiResponse.riskLevel,
        recommendations: aiResponse.recommendations,
        followUpRequired: aiResponse.followUpRequired,
        reasoning: aiResponse.reasoning,
        confidenceScore: aiResponse.confidenceScore || 0.7
      };
      
      // Add follow-up questions if confidence is low or medium
      if (aiResponse.confidenceScore < 0.8 || aiResponse.followUpQuestions.length > 0) {
        healthCheckIn.followUpQuestions = aiResponse.followUpQuestions;
      }
    } else {
      // Default assessment for good feeling with no symptoms
      healthCheckIn.aiAssessment = {
        riskLevel: 'low',
        recommendations: [
          "You're doing great! Keep maintaining your healthy habits.",
          "Remember to stay hydrated and continue your regular exercise routine.",
          "Getting consistent quality sleep will help maintain your wellbeing."
        ],
        followUpRequired: false,
        confidenceScore: 0.9
      };
    }
    
    await healthCheckIn.save();
    
    // If high risk, trigger notification
    if (healthCheckIn.aiAssessment.riskLevel === 'high') {
      await triggerCaregiverNotification(req.user._id, 'health_concern', {
        checkInId: healthCheckIn._id,
        feeling,
        symptoms,
        timestamp: new Date()
      });
    }
    
    res.status(201).json({
      status: 'success',
      message: 'Health check-in submitted successfully',
      healthCheckIn,
      requiresFollowUp: healthCheckIn.followUpQuestions && healthCheckIn.followUpQuestions.length > 0
    });
  } catch (error) {
    logger.error('Error submitting health check-in:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to submit health check-in',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Submit follow-up responses to health check-in questions
exports.submitFollowUpResponses = async (req, res) => {
  try {
    const { checkInId, responses } = req.body;
    
    if (!checkInId || !responses || !Array.isArray(responses)) {
      return res.status(400).json({
        status: 'error',
        message: 'Check-in ID and responses array are required',
      });
    }
    
    // Find the original check-in
    const healthCheckIn = await HealthCheckIn.findOne({
      _id: checkInId,
      userId: req.user._id
    });
    
    if (!healthCheckIn) {
      return res.status(404).json({
        status: 'error',
        message: 'Health check-in not found',
      });
    }
    
    // Validate that the responses match the follow-up questions
    if (healthCheckIn.followUpQuestions.length !== responses.length) {
      return res.status(400).json({
        status: 'error',
        message: 'Number of responses must match number of follow-up questions',
      });
    }
    
    // Add responses to the health check-in
    healthCheckIn.followUpResponses = responses.map((response, index) => ({
      question: healthCheckIn.followUpQuestions[index],
      response,
      timestamp: new Date()
    }));
    
    // Update the conversation stage
    healthCheckIn.conversationStage = 'follow_up';
    
    // Get enhanced AI assessment with the additional information
    const enhancedAssessment = await enhanceAIAssessmentWithResponses(
      healthCheckIn.feeling,
      healthCheckIn.symptoms,
      healthCheckIn.followUpResponses,
      req.user
    );
    
    // Update the AI assessment
    healthCheckIn.aiAssessment = {
      ...healthCheckIn.aiAssessment,
      riskLevel: enhancedAssessment.riskLevel,
      recommendations: enhancedAssessment.recommendations,
      followUpRequired: enhancedAssessment.followUpRequired,
      reasoning: enhancedAssessment.reasoning,
      confidenceScore: enhancedAssessment.confidenceScore || 0.85
    };
    
    // Check if we need more follow-up questions
    if (enhancedAssessment.additionalQuestions && enhancedAssessment.additionalQuestions.length > 0) {
      // Store the previous questions and add new ones
      const previousQuestions = [...healthCheckIn.followUpQuestions];
      healthCheckIn.followUpQuestions = enhancedAssessment.additionalQuestions;
      healthCheckIn.previousFollowUpQuestions = previousQuestions;
      healthCheckIn.conversationStage = 'follow_up';
      healthCheckIn.furtherFollowUpRequired = true;
    } else {
      // No more questions needed
      healthCheckIn.conversationStage = 'completed';
      healthCheckIn.furtherFollowUpRequired = false;
    }
    
    await healthCheckIn.save();
    
    // If high risk, trigger notification
    if (healthCheckIn.aiAssessment.riskLevel === 'high' && !healthCheckIn.furtherFollowUpRequired) {
      await triggerCaregiverNotification(req.user._id, 'health_concern_update', {
        checkInId: healthCheckIn._id,
        feeling: healthCheckIn.feeling,
        riskLevel: healthCheckIn.aiAssessment.riskLevel,
        timestamp: new Date()
      });
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Follow-up responses submitted successfully',
      healthCheckIn,
      requiresMoreFollowUp: healthCheckIn.furtherFollowUpRequired
    });
  } catch (error) {
    logger.error('Error submitting follow-up responses:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to submit follow-up responses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get user health check-ins with pagination and enhanced analytics
exports.getUserHealthCheckIns = async (req, res) => {
  try {
    const { from, to, page = 1, limit = 10, includeTrends = 'true' } = req.query;
    
    let query = { userId: req.user._id };
    
    // Add date range filter if provided
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }
    
    // Pagination
    const skip = (page - 1) * limit;
    
    // Get total count for pagination
    const total = await HealthCheckIn.countDocuments(query);
    
    // Get health check-ins with pagination
    const healthCheckIns = await HealthCheckIn.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Response object
    const response = {
      status: 'success',
      count: healthCheckIns.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      healthCheckIns
    };
    
    // Include trends if requested
    if (includeTrends === 'true') {
      response.wellnessTrends = await calculateEnhancedWellnessTrends(req.user._id);
      response.lifestyleTrends = await calculateLifestyleTrends(req.user._id);
      response.symptomPatterns = await analyzeSymptomPatterns(req.user._id);
    }
    
    res.status(200).json(response);
  } catch (error) {
    logger.error('Error getting health check-ins:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get health check-ins',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get pending follow-ups for the user
exports.getPendingFollowUps = async (req, res) => {
  try {
    // Find health check-ins requiring follow-up
    const pendingFollowUps = await HealthCheckIn.find({
      userId: req.user._id,
      conversationStage: { $ne: 'completed' },
      followUpQuestions: { $exists: true, $not: { $size: 0 } }
    }).sort({ createdAt: -1 });
    
    // Also get scheduled follow-ups
    const scheduledFollowUps = await FollowUp.find({
      userId: req.user._id,
      status: 'pending'
    }).sort({ scheduledTime: 1 });
    
    res.status(200).json({
      status: 'success',
      pendingConversations: pendingFollowUps.map(f => ({
        _id: f._id,
        createdAt: f.createdAt,
        feeling: f.feeling,
        followUpQuestions: f.followUpQuestions,
        stage: f.conversationStage
      })),
      scheduledFollowUps: scheduledFollowUps.map(f => ({
        _id: f._id,
        scheduledTime: f.scheduledTime,
        followUpType: f.followUpType,
        riskLevel: f.riskLevel
      }))
    });
  } catch (error) {
    logger.error('Error getting pending follow-ups:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get pending follow-ups',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get comprehensive health analytics/dashboard data
exports.getHealthDashboard = async (req, res) => {
  try {
    // Get latest vital signs (one of each type)
    const latestVitals = await getLatestVitalSigns(req.user._id);
    
    // Get latest health check-in
    const latestCheckIn = await HealthCheckIn.findOne(
      { userId: req.user._id }
    ).sort({ createdAt: -1 });
    
    // Get health trends with enhanced analytics
    const vitalTrends = await calculateEnhancedTrends(req.user._id);
    const wellnessTrends = await calculateEnhancedWellnessTrends(req.user._id);
    const lifestyleTrends = await calculateLifestyleTrends(req.user._id);
    
    // Get vital sign correlations
    const vitalCorrelations = await calculateVitalSignCorrelations(req.user._id);
    
    // Get symptom patterns
    const symptomPatterns = await analyzeSymptomPatterns(req.user._id);

    // Get symptom-medication correlations
    const correlationService = new SymptomCorrelationService();
    const correlationResults = await correlationService.analyzeCorrelations(
      req.user._id.toString(),
      { timeframeInDays: 30 } // Use last 30 days for dashboard
    );

    // Only include significant correlations
    const significantCorrelations = correlationResults.medicationSymptomCorrelations
      .filter(c => Math.abs(c.correlation) > 0.3)
      .slice(0, 3); // Top 3 most significant
    
    // Get health insights using AI
    const healthInsights = await generateHealthDashboardInsights(
      req.user._id, 
      latestVitals, 
      latestCheckIn,
      vitalTrends,
      wellnessTrends,
      lifestyleTrends,
      symptomPatterns,
      significantCorrelations // Pass the correlations to the insights function
    );
    
    // Calculate health score
    const healthScore = calculateHealthScore(
      latestVitals,
      wellnessTrends,
      lifestyleTrends,
      symptomPatterns,
      significantCorrelations // Pass the correlations to the health score calculation
    );
    
    res.status(200).json({
      status: 'success',
      dashboard: {
        healthScore,
        latestVitals,
        latestCheckIn,
        vitalTrends,
        wellnessTrends,
        lifestyleTrends,
        vitalCorrelations,
        symptomPatterns,
        insights: healthInsights,
        symptomCorrelations: significantCorrelations
      }
    });
  } catch (error) {
    logger.error('Error getting health dashboard:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get health dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Calculate derived values from vital signs
function calculateDerivedValues(type, values) {
  try {
    const derivedValues = {};
    
    switch(type) {
      case 'bloodPressure':
        // Calculate Mean Arterial Pressure (MAP)
        if (values.systolic && values.diastolic) {
          derivedValues.map = Math.round((values.diastolic + (1/3) * (values.systolic - values.diastolic)) * 10) / 10;
        }
        
        // Calculate Pulse Pressure
        if (values.systolic && values.diastolic) {
          derivedValues.pulsePressure = values.systolic - values.diastolic;
        }
        break;
        
      case 'weight':
        // If we have height stored in user profile, we could calculate BMI
        // This would require fetching the user's health profile
        break;
        
      case 'heartRate':
        // Calculate heart rate zones (if we know max heart rate)
        // This is simplistic and assumes a default max HR based on age 40
        const estimatedMaxHR = 180; // 220 - 40 (assumed age)
        if (values.heartRate) {
          derivedValues.percentMaxHR = Math.round((values.heartRate / estimatedMaxHR) * 100);
          
          // Define heart rate zones
          if (derivedValues.percentMaxHR < 50) {
            derivedValues.hrZone = 'rest';
          } else if (derivedValues.percentMaxHR < 60) {
            derivedValues.hrZone = 'very_light';
          } else if (derivedValues.percentMaxHR < 70) {
            derivedValues.hrZone = 'light';
          } else if (derivedValues.percentMaxHR < 80) {
            derivedValues.hrZone = 'moderate';
          } else if (derivedValues.percentMaxHR < 90) {
            derivedValues.hrZone = 'hard';
          } else {
            derivedValues.hrZone = 'maximum';
          }
        }
        break;
        
      case 'oxygenLevel':
        // Calculate oxygen saturation zone
        if (values.oxygenLevel) {
          if (values.oxygenLevel >= 95) {
            derivedValues.o2Zone = 'normal';
          } else if (values.oxygenLevel >= 90) {
            derivedValues.o2Zone = 'mild_hypoxemia';
          } else if (values.oxygenLevel >= 85) {
            derivedValues.o2Zone = 'moderate_hypoxemia';
          } else {
            derivedValues.o2Zone = 'severe_hypoxemia';
          }
        }
        break;
        
      case 'glucose':
        // Calculate glucose zone
        if (values.glucoseLevel) {
          if (values.glucoseLevel < 70) {
            derivedValues.glucoseZone = 'hypoglycemia';
          } else if (values.glucoseLevel <= 140) {
            derivedValues.glucoseZone = 'normal';
          } else if (values.glucoseLevel <= 180) {
            derivedValues.glucoseZone = 'elevated';
          } else {
            derivedValues.glucoseZone = 'high';
          }
        }
        break;
    }
    
    return derivedValues;
  } catch (error) {
    logger.error('Error calculating derived values:', error);
    return {};
  }
}

// Helper function to check if vital signs are within normal range
function checkIfNormal(type, values) {
  try {
    switch(type) {
      case 'bloodPressure':
        return (values.systolic <= 140 && values.systolic >= 90) && 
               (values.diastolic <= 90 && values.diastolic >= 60);
      case 'glucose':
        return values.glucoseLevel >= 70 && values.glucoseLevel <= 140;
      case 'heartRate':
        return values.heartRate >= 60 && values.heartRate <= 100;
      case 'oxygenLevel':
        return values.oxygenLevel >= 95;
      case 'temperature':
        return values.temperature >= 97 && values.temperature <= 99;
      case 'weight':
        // Would need user's baseline weight and BMI for accurate assessment
        return true;
      default:
        return true;
    }
  } catch (error) {
    logger.error('Error in checkIfNormal:', error);
    return false; // Default to abnormal if there's an error
  }
}

// Calculate health score from various metrics
function calculateHealthScore(latestVitals, wellnessTrends, lifestyleTrends, symptomPatterns, symptomCorrelations) {
  try {
    let score = 70; // Start with a baseline score
    
    // Adjust for vital signs
    Object.entries(latestVitals).forEach(([type, data]) => {
      if (data.isNormal) {
        score += 2; // Add points for each normal vital
      } else {
        score -= 3; // Subtract points for abnormal vitals
      }
    });
    
    // Adjust for wellness trend
    if (wellnessTrends.wellnessTrend === 'improving') {
      score += 5;
    } else if (wellnessTrends.wellnessTrend === 'declining') {
      score -= 5;
    }
    
    // Adjust for feeling distribution
    if (wellnessTrends.feelingDistribution) {
      score += wellnessTrends.feelingDistribution.good * 0.1;
      score -= wellnessTrends.feelingDistribution.poor * 0.2;
    }
    
    // Adjust for lifestyle factors if available
    if (lifestyleTrends) {
      if (lifestyleTrends.averageSleepHours >= 7) score += 3;
      if (lifestyleTrends.averageStressLevel < 3) score += 3;
      if (lifestyleTrends.medicationAdherenceRate > 0.8) score += 3;
    }
    
    // Adjust for symptom frequency
    if (symptomPatterns && symptomPatterns.recentSymptomCount) {
      score -= Math.min(10, symptomPatterns.recentSymptomCount);
    }
    
    // Adjust for symptom-medication correlations
    if (symptomCorrelations && symptomCorrelations.length > 0) {
      // Look for concerning strong positive correlations (medication associated with symptoms)
      const concerningCorrelations = symptomCorrelations.filter(
        c => c.correlation > 0.5 && c.direction === 'positive'
      );
      
      // Look for beneficial strong negative correlations (medication potentially reducing symptoms)
      const beneficialCorrelations = symptomCorrelations.filter(
        c => c.correlation < -0.5 && c.direction === 'negative'
      );
      
      // Adjust score based on correlation findings
      if (concerningCorrelations.length > 0) {
        // More concerning correlations lower the score
        score -= Math.min(10, concerningCorrelations.length * 5);
      }
      
      if (beneficialCorrelations.length > 0) {
        // More beneficial correlations raise the score
        score += Math.min(10, beneficialCorrelations.length * 5);
      }
    }
    
    // Cap the score between 0 and 100
    score = Math.max(0, Math.min(100, Math.round(score)));
    
    // Determine health status based on score
    let status;
    if (score >= 85) {
      status = 'excellent';
    } else if (score >= 70) {
      status = 'good';
    } else if (score >= 50) {
      status = 'fair';
    } else {
      status = 'needs_attention';
    }
    
    return {
      score,
      status,
      maxScore: 100
    };
  } catch (error) {
    logger.error('Error calculating health score:', error);
    return {
      score: 50,
      status: 'unknown',
      maxScore: 100
    };
  }
}

// Generate AI health insight for abnormal readings with a reassuring tone
async function generateAIHealthInsight(type, values, derivedValues, user) {
  try {
    // Skip AI processing in development mode to save API calls
    if (process.env.NODE_ENV === 'development') {
      return {
        insights: [
          "Your reading is outside the typical range, but please don't worry - many factors can temporarily affect these values.",
          "It might be helpful to take another reading in a relaxed state to confirm these results.",
          "Consider discussing these results with your healthcare provider during your next visit for personalized guidance."
        ],
        followupRequired: true
      };
    }
    
    // Prepare context for AI
    let readingDescription;
    switch(type) {
      case 'bloodPressure':
        readingDescription = `blood pressure of ${values.systolic}/${values.diastolic} mmHg`;
        break;
      case 'glucose':
        readingDescription = `blood glucose level of ${values.glucoseLevel} mg/dL`;
        break;
      case 'heartRate':
        readingDescription = `heart rate of ${values.heartRate} bpm`;
        break;
      case 'oxygenLevel':
        readingDescription = `oxygen saturation level of ${values.oxygenLevel}%`;
        break;
      case 'temperature':
        readingDescription = `body temperature of ${values.temperature}°F`;
        break;
      default:
        readingDescription = `abnormal reading for ${type}`;
    }
    
    // Add derived values to description if available
    let derivedValuesText = '';
    if (derivedValues && Object.keys(derivedValues).length > 0) {
      derivedValuesText = `Derived values include: ${Object.entries(derivedValues)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ')}.`;
    }
    
    // Call OpenAI for health insights with a reassuring tone
    const prompt = `As a compassionate healthcare assistant, provide 3 brief, helpful insights about a patient with a ${readingDescription}. ${derivedValuesText} 
    
    This reading is outside normal range, but your tone should be reassuring and calming, not alarming. Provide realistic context about what might cause such readings and practical, helpful advice.
    
    Determine if follow-up with a healthcare provider is recommended (true/false).
    
    Format response as JSON: {
      "insights": ["insight1", "insight2", "insight3"], 
      "followupRequired": boolean
    }`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a compassionate healthcare assistant providing reassuring and helpful insights." },
        { role: "user", content: prompt }
      ],
      max_tokens: 350,
      temperature: 0.4
    });
    
    // Parse the response
    const response = JSON.parse(completion.choices[0].message.content.trim());
    
    return {
      insights: response.insights,
      followupRequired: response.followupRequired
    };
  } catch (error) {
    logger.error('Error generating AI health insight:', error);
    // Fallback insights in case of API error with reassuring tone
    return {
      insights: [
        "Your reading is outside the typical range, but many factors can temporarily affect these values including time of day, recent activity, or even how you were positioned.",
        "It's often helpful to take another reading after resting calmly for 15-20 minutes to see if the values return to your normal range.",
        "While this single reading isn't cause for immediate concern, sharing these results with your healthcare provider during your next visit would be a good proactive step."
      ],
      followupRequired: true
    };
  }
}

// Generate AI health assessment with follow-up questions
async function generateAIHealthAssessmentWithQuestions(feeling, symptoms, lifestyleFactors, user) {
  try {
    // Skip AI processing in development mode
    if (process.env.NODE_ENV === 'development') {
      let riskLevel = 'low';
      if (feeling === 'poor') riskLevel = 'medium';
      if (symptoms && symptoms.length > 2) riskLevel = 'high';
      
      return {
        riskLevel,
        recommendations: [
          "I understand you're not feeling your best right now. Getting adequate rest can help your body recover naturally.",
          "Staying well-hydrated is particularly important when you're not feeling well. Try to drink water regularly throughout the day.",
          "Monitor your symptoms over the next 24 hours. If they persist or worsen, consider reaching out to your healthcare provider."
        ],
        followUpRequired: riskLevel === 'high',
        confidenceScore: 0.7,
        followUpQuestions: [
          "How long have you been experiencing these symptoms?",
          "Have you noticed any specific triggers that make your symptoms better or worse?",
          "Are you currently taking any medications or remedies for these symptoms?"
        ],
        reasoning: "Based on the reported feeling and symptoms, this appears to be a mild health concern that warrants monitoring but not immediate medical attention."
      };
    }
    
    // Prepare symptoms description
    const symptomsDescription = symptoms && symptoms.length > 0 
      ? symptoms.map(s => `${s.name} (severity: ${s.severity}/5)`).join(', ')
      : 'no specific symptoms';
    
    // Prepare lifestyle factors description
    const lifestyleFactorsDescription = Object.entries(lifestyleFactors)
      .filter(([key, value]) => value !== null && value !== undefined)
      .map(([key, value]) => {
        switch(key) {
          case 'sleepHours':
            return `sleep: ${value} hours`;
          case 'stressLevel':
            return `stress level: ${value}/5`;
          case 'medicationAdherence':
            return `medication adherence: ${value}`;
          case 'waterIntake':
            return `water intake: ${value} glasses`;
          case 'exerciseMinutes':
            return `exercise: ${value} minutes`;
          default:
            return `${key}: ${value}`;
        }
      }).join(', ');
    
    // Call OpenAI for health assessment with follow-up questions
    const prompt = `As a compassionate healthcare assistant, assess a patient who reports feeling ${feeling} with ${symptomsDescription}. Additional lifestyle factors: ${lifestyleFactorsDescription || 'none reported'}.

    1) Determine risk level (low, medium, high)
    2) Provide 3 warm, reassuring health recommendations that are practical and helpful
    3) Generate 3 follow-up questions to better understand the patient's condition
    4) Determine if follow-up with a healthcare provider is recommended (true/false)
    5) Provide brief reasoning for your assessment
    6) Assign a confidence score (0.0-1.0) to your assessment based on available information

    Format response as JSON: {
      "riskLevel": string,
      "recommendations": [string, string, string],
      "followUpQuestions": [string, string, string],
      "followUpRequired": boolean,
      "reasoning": string,
      "confidenceScore": number
    }`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a compassionate healthcare assistant providing warm, reassuring guidance while gathering necessary information." },
        { role: "user", content: prompt }
      ],
      max_tokens: 600,
      temperature: 0.4
    });
    
    // Parse the response
    const response = JSON.parse(completion.choices[0].message.content.trim());
    
    return {
      riskLevel: response.riskLevel,
      recommendations: response.recommendations,
      followUpQuestions: response.followUpQuestions,
      followUpRequired: response.followUpRequired,
      reasoning: response.reasoning,
      confidenceScore: response.confidenceScore
    };
  } catch (error) {
    logger.error('Error generating AI health assessment with questions:', error);
    // Fallback assessment in case of API error
    let riskLevel = 'low';
    if (feeling === 'poor') riskLevel = 'medium';
    if (symptoms && symptoms.length > 2) riskLevel = 'high';
    
    return {
      riskLevel,
      recommendations: [
        "I understand you're not feeling your best right now. Getting adequate rest can help your body recover naturally.",
        "Staying well-hydrated is particularly important when you're not feeling well. Try to drink water regularly throughout the day.",
        "Monitor your symptoms over the next 24 hours. If they persist or worsen, consider reaching out to your healthcare provider."
      ],
      followUpQuestions: [
        "How long have you been experiencing these symptoms?",
        "Have you noticed any specific triggers that make your symptoms better or worse?",
        "Are you currently taking any medications or remedies for these symptoms?"
      ],
      followUpRequired: riskLevel === 'high',
      reasoning: "Based on the reported feeling and symptoms, this appears to be a health concern that should be monitored.",
      confidenceScore: 0.6
    };
  }
}

// Enhance AI assessment with follow-up responses
async function enhanceAIAssessmentWithResponses(feeling, symptoms, followUpResponses, user) {
  try {
    // Skip AI processing in development mode
    if (process.env.NODE_ENV === 'development') {
      return {
        riskLevel: symptoms && symptoms.length > 2 ? 'medium' : 'low',
        recommendations: [
          "Thank you for providing more information. Based on your responses, rest and hydration remain essential for your recovery.",
          "Monitoring your symptoms for the next 24-48 hours will help determine if additional care is needed.",
          "If your symptoms worsen or you develop new symptoms like high fever or difficulty breathing, please contact your healthcare provider promptly."
        ],
        followUpRequired: symptoms && symptoms.length > 2,
        reasoning: "With the additional information provided, we have a better understanding of the situation. The symptoms appear to be manageable with self-care for now.",
        confidenceScore: 0.85,
        additionalQuestions: []
      };
    }
    
    // Format symptoms
    const symptomsDescription = symptoms && symptoms.length > 0 
      ? symptoms.map(s => `${s.name} (severity: ${s.severity}/5)`).join(', ')
      : 'no specific symptoms';
    
    // Format follow-up responses
    const responsesText = followUpResponses.map(r => 
      `Q: ${r.question}\nA: ${r.response}`
    ).join('\n\n');
    
    // Call OpenAI for enhanced assessment
    const prompt = `As a compassionate healthcare assistant, you previously assessed a patient who reported feeling ${feeling} with ${symptomsDescription}. They have now provided additional information through follow-up questions:

    ${responsesText}

    Based on this additional information:
    1) Re-assess the risk level (low, medium, high)
    2) Provide 3 updated, warm, reassuring health recommendations
    3) Determine if follow-up with a healthcare provider is recommended (true/false)
    4) Provide brief reasoning for your updated assessment
    5) Assign a confidence score (0.0-1.0) to your assessment
    6) If necessary, provide up to 2 additional follow-up questions if more information is needed

    Format response as JSON: {
      "riskLevel": string,
      "recommendations": [string, string, string],
      "followUpRequired": boolean,
      "reasoning": string,
      "confidenceScore": number,
      "additionalQuestions": [string] (empty array if no more questions)
    }`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a compassionate healthcare assistant providing warm, reassuring guidance based on comprehensive information." },
        { role: "user", content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.3
    });
    
    // Parse the response
    const response = JSON.parse(completion.choices[0].message.content.trim());
    
    return {
      riskLevel: response.riskLevel,
      recommendations: response.recommendations,
      followUpRequired: response.followUpRequired,
      reasoning: response.reasoning,
      confidenceScore: response.confidenceScore,
      additionalQuestions: response.additionalQuestions || []
    };
  } catch (error) {
    logger.error('Error enhancing AI assessment with responses:', error);
    // Fallback assessment in case of API error
    return {
      riskLevel: symptoms && symptoms.length > 2 ? 'medium' : 'low',
      recommendations: [
        "Thank you for providing more information. Based on your responses, rest and hydration remain essential for your recovery.",
        "Monitoring your symptoms for the next 24-48 hours will help determine if additional care is needed.",
        "If your symptoms worsen or you develop new symptoms like high fever or difficulty breathing, please contact your healthcare provider promptly."
      ],
      followUpRequired: symptoms && symptoms.length > 2,
      reasoning: "With the additional information provided, we have a better understanding of the situation. The symptoms appear to be manageable with self-care for now.",
      confidenceScore: 0.85,
      additionalQuestions: []
    };
  }
}

// Calculate enhanced trends with more sophisticated analytics
async function calculateEnhancedTrends(userId, groupBy = 'day') {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Get aggregated vital sign data
    const trendData = await VitalSign.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), timestamp: { $gte: thirtyDaysAgo } } },
      { $sort: { timestamp: 1 } },
      { $group: {
          _id: "$type",
          readings: { 
            $push: { 
              timestamp: "$timestamp", 
              values: "$values",
              derivedValues: "$derivedValues",
              isNormal: "$isNormal"
            } 
          },
          normalCount: { $sum: { $cond: ["$isNormal", 1, 0] } },
          abnormalCount: { $sum: { $cond: ["$isNormal", 0, 1] } },
          totalCount: { $sum: 1 },
          minValues: { $min: "$values" },
          maxValues: { $max: "$values" },
          avgValues: { $avg: "$values" }
        }
      }
    ]);
    
    // Group data by specified interval (day, week, month)
    const groupedData = {};
    trendData.forEach(item => {
      const type = item._id;
      const readings = item.readings;
      
      if (readings.length > 0) {
        // Group readings by the specified interval
        const intervalGroups = {};
        
        readings.forEach(reading => {
          const date = new Date(reading.timestamp);
          let intervalKey;
          
          if (groupBy === 'week') {
            // Get the week number (approximate)
            const weekNum = Math.ceil((date.getDate() + (date.getDay() + 1)) / 7);
            intervalKey = `${date.getFullYear()}-${date.getMonth() + 1}-W${weekNum}`;
          } else if (groupBy === 'month') {
            intervalKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
          } else {
            // Default to day
            intervalKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
          }
          
          if (!intervalGroups[intervalKey]) {
            intervalGroups[intervalKey] = [];
          }
          
          intervalGroups[intervalKey].push(reading);
        });
        
        // Calculate statistics for each interval
        const intervalStats = Object.entries(intervalGroups).map(([interval, intervalReadings]) => {
          // Calculate average values for the interval
          const avgValues = {};
          const minValues = {};
          const maxValues = {};
          
          // Initialize with first reading values
          const firstReading = intervalReadings[0];
          Object.entries(firstReading.values).forEach(([key, value]) => {
            if (typeof value === 'number') {
              avgValues[key] = value;
              minValues[key] = value;
              maxValues[key] = value;
            }
          });
          
          // Calculate aggregates
          intervalReadings.slice(1).forEach(reading => {
            Object.entries(reading.values).forEach(([key, value]) => {
              if (typeof value === 'number') {
                // Sum for average
                avgValues[key] = (avgValues[key] || 0) + value;
                
                // Min/max
                minValues[key] = Math.min(minValues[key] || Infinity, value);
                maxValues[key] = Math.max(maxValues[key] || -Infinity, value);
              }
            });
          });
          
          // Calculate averages
          Object.keys(avgValues).forEach(key => {
            avgValues[key] = avgValues[key] / intervalReadings.length;
          });
          
          // Calculate normal/abnormal count
          const normalCount = intervalReadings.filter(r => r.isNormal).length;
          
          return {
            interval,
            date: new Date(intervalReadings[0].timestamp),
            count: intervalReadings.length,
            normalCount,
            abnormalCount: intervalReadings.length - normalCount,
            avgValues,
            minValues,
            maxValues,
            readings: intervalReadings
          };
        });
        
        // Sort by date
        const sortedIntervalStats = intervalStats.sort((a, b) => a.date - b.date);
        
        // Calculate overall trend
        let trendDirection = 'stable';
        let changePercentage = 0;
        
        if (sortedIntervalStats.length > 1) {
          // Compare first and last interval for trend
          const firstInterval = sortedIntervalStats[0];
          const lastInterval = sortedIntervalStats[sortedIntervalStats.length - 1];
          
          // Calculate trend based on type-specific key metrics
          switch(type) {
            case 'bloodPressure':
              const firstSystolic = firstInterval.avgValues.systolic;
              const lastSystolic = lastInterval.avgValues.systolic;
              
              trendDirection = lastSystolic > firstSystolic * 1.05 ? 'increasing' : 
                              lastSystolic < firstSystolic * 0.95 ? 'decreasing' : 'stable';
              
              changePercentage = Math.abs(((lastSystolic - firstSystolic) / firstSystolic) * 100).toFixed(1);
              break;
              
            case 'glucose':
              const firstGlucose = firstInterval.avgValues.glucoseLevel;
              const lastGlucose = lastInterval.avgValues.glucoseLevel;
              
              trendDirection = lastGlucose > firstGlucose * 1.1 ? 'increasing' : 
                              lastGlucose < firstGlucose * 0.9 ? 'decreasing' : 'stable';
              
              changePercentage = Math.abs(((lastGlucose - firstGlucose) / firstGlucose) * 100).toFixed(1);
              break;
              
            case 'heartRate':
              const firstHR = firstInterval.avgValues.heartRate;
              const lastHR = lastInterval.avgValues.heartRate;
              
              trendDirection = lastHR > firstHR * 1.1 ? 'increasing' : 
                              lastHR < firstHR * 0.9 ? 'decreasing' : 'stable';
              
              changePercentage = Math.abs(((lastHR - firstHR) / firstHR) * 100).toFixed(1);
              break;
              
            case 'oxygenLevel':
              const firstO2 = firstInterval.avgValues.oxygenLevel;
              const lastO2 = lastInterval.avgValues.oxygenLevel;
              
              trendDirection = lastO2 > firstO2 * 1.05 ? 'increasing' : 
                              lastO2 < firstO2 * 0.95 ? 'decreasing' : 'stable';
              
              changePercentage = Math.abs(((lastO2 - firstO2) / firstO2) * 100).toFixed(1);
              break;
              
            case 'weight':
              const firstWeight = firstInterval.avgValues.weight;
              const lastWeight = lastInterval.avgValues.weight;
              
              trendDirection = lastWeight > firstWeight * 1.02 ? 'increasing' : 
                              lastWeight < firstWeight * 0.98 ? 'decreasing' : 'stable';
              
              changePercentage = Math.abs(((lastWeight - firstWeight) / firstWeight) * 100).toFixed(1);
              break;
              
            default:
              trendDirection = 'stable';
              changePercentage = 0;
          }
        }
        
        // Calculate variability (standard deviation)
        const variability = {};
        if (sortedIntervalStats.length > 1) {
          // Get all the keys from the first interval's avgValues
          const keys = Object.keys(sortedIntervalStats[0].avgValues);
          
          keys.forEach(key => {
            // Get all values for this key
            const allValues = sortedIntervalStats.map(interval => interval.avgValues[key]);
            
            // Calculate mean
            const mean = allValues.reduce((sum, val) => sum + val, 0) / allValues.length;
            
            // Calculate variance
            const variance = allValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / allValues.length;
            
            // Calculate standard deviation
            variability[key] = Math.sqrt(variance).toFixed(2);
          });
        }
        
        // Get abnormal streak (consecutive abnormal readings)
        const currentAbnormalStreak = getAbnormalStreak(readings);
        
        // Detect outliers
        const outliers = detectOutliers(readings, type);
        
        groupedData[type] = {
          readings: readings.length,
          normalCount: item.normalCount,
          abnormalCount: item.abnormalCount,
          trendDirection,
          changePercentage,
          currentAbnormalStreak,
          variability,
          outliers,
          intervalStats: sortedIntervalStats,
          dataPoints: readings.map(r => ({
            timestamp: r.timestamp,
            values: r.values,
            isNormal: r.isNormal
          }))
        };
      }
    });
    
    return groupedData;
  } catch (error) {
    logger.error('Error calculating enhanced trends:', error);
    return {};
  }
}

// Calculate vital sign correlations
async function calculateVitalSignCorrelations(userId) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Get all vital signs within time range
    const vitalSigns = await VitalSign.find({
      userId,
      timestamp: { $gte: thirtyDaysAgo }
    }).sort({ timestamp: 1 });
    
    // Group by day to align different types of readings
    const dailyReadings = {};
    
    vitalSigns.forEach(reading => {
      const date = new Date(reading.timestamp);
      const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      
      if (!dailyReadings[dateKey]) {
        dailyReadings[dateKey] = {
          date: dateKey,
          readings: {}
        };
      }
      
      // Get the key values based on reading type
      const values = {};
      switch(reading.type) {
        case 'bloodPressure':
          values.systolic = reading.values.systolic;
          values.diastolic = reading.values.diastolic;
          break;
        case 'glucose':
          values.glucoseLevel = reading.values.glucoseLevel;
          break;
        case 'heartRate':
          values.heartRate = reading.values.heartRate;
          break;
        case 'oxygenLevel':
          values.oxygenLevel = reading.values.oxygenLevel;
          break;
        case 'weight':
          values.weight = reading.values.weight;
          break;
        case 'temperature':
          values.temperature = reading.values.temperature;
          break;
      }
      
      // Store the values
      dailyReadings[dateKey].readings[reading.type] = values;
    });
    
    // Convert to array for processing
    const dailyReadingsArray = Object.values(dailyReadings);
    
    // Need at least a few days of data for correlations
    if (dailyReadingsArray.length < 5) {
      return {
        correlations: [],
        message: "Insufficient data for correlation analysis. Need at least 5 days of readings."
      };
    }
    
    // Calculate correlations between different vital sign metrics
    const correlations = [];
    const metrics = [
      { type: 'bloodPressure', key: 'systolic' },
      { type: 'bloodPressure', key: 'diastolic' },
      { type: 'glucose', key: 'glucoseLevel' },
      { type: 'heartRate', key: 'heartRate' },
      { type: 'oxygenLevel', key: 'oxygenLevel' },
      { type: 'weight', key: 'weight' },
      { type: 'temperature', key: 'temperature' }
    ];
    
    // Calculate correlations between each pair of metrics
    for (let i = 0; i < metrics.length; i++) {
      for (let j = i + 1; j < metrics.length; j++) {
        const metric1 = metrics[i];
        const metric2 = metrics[j];
        
        // Get paired values where both metrics exist on the same day
        const pairedValues = dailyReadingsArray
          .filter(day => 
            day.readings[metric1.type] && day.readings[metric1.type][metric1.key] !== undefined &&
            day.readings[metric2.type] && day.readings[metric2.type][metric2.key] !== undefined
          )
          .map(day => ({
            metric1Value: day.readings[metric1.type][metric1.key],
            metric2Value: day.readings[metric2.type][metric2.key],
            date: day.date
          }));
        
        // Need at least 5 pairs for meaningful correlation
        if (pairedValues.length >= 5) {
          const correlation = calculatePearsonCorrelation(
            pairedValues.map(p => p.metric1Value),
            pairedValues.map(p => p.metric2Value)
          );
          
          // Only include meaningful correlations
          if (!isNaN(correlation) && Math.abs(correlation) > 0.3) {
            correlations.push({
              metric1: `${metric1.type}.${metric1.key}`,
              metric2: `${metric2.type}.${metric2.key}`,
              correlation: parseFloat(correlation.toFixed(2)),
              strength: getCorrelationStrength(correlation),
              direction: correlation > 0 ? 'positive' : 'negative',
              sampleSize: pairedValues.length,
              dataPoints: pairedValues
            });
          }
        }
      }
    }
    
    // Sort by correlation strength (absolute value)
    correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    
    return {
      correlations,
      dailyReadingsCount: dailyReadingsArray.length
    };
  } catch (error) {
    logger.error('Error calculating vital sign correlations:', error);
    return { correlations: [], error: "Error calculating correlations" };
  }
}

// Calculate Pearson correlation coefficient
function calculatePearsonCorrelation(x, y) {
  const n = x.length;
  if (n !== y.length || n === 0) return NaN;
  
  // Calculate sums
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  
  // Calculate correlation coefficient
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  if (denominator === 0) return 0;
  
  return numerator / denominator;
}

// Get correlation strength description
function getCorrelationStrength(correlation) {
  const absCorrelation = Math.abs(correlation);
  
  if (absCorrelation >= 0.7) {
    return 'strong';
  } else if (absCorrelation >= 0.5) {
    return 'moderate';
  } else if (absCorrelation >= 0.3) {
    return 'weak';
  } else {
    return 'negligible';
  }
}

// Calculate enhanced wellness trends from health check-ins
async function calculateEnhancedWellnessTrends(userId) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Get aggregated health check-in data
    const checkInData = await HealthCheckIn.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), createdAt: { $gte: thirtyDaysAgo } } },
      { $sort: { createdAt: 1 } },
      { $group: {
          _id: null,
          checkIns: { 
            $push: { 
              createdAt: "$createdAt", 
              feeling: "$feeling",
              symptoms: "$symptoms",
              aiAssessment: "$aiAssessment",
              sleepHours: "$sleepHours",
              stressLevel: "$stressLevel"
            } 
          },
          goodCount: { $sum: { $cond: [{ $eq: ["$feeling", "good"] }, 1, 0] } },
          fairCount: { $sum: { $cond: [{ $eq: ["$feeling", "fair"] }, 1, 0] } },
          poorCount: { $sum: { $cond: [{ $eq: ["$feeling", "poor"] }, 1, 0] } },
          totalCount: { $sum: 1 },
          riskLevels: { 
            $push: { 
              riskLevel: "$aiAssessment.riskLevel",
              createdAt: "$createdAt"
            } 
          }
        }
      }
    ]);
    
    if (checkInData.length === 0) {
      return {
        checkInCount: 0,
        wellnessTrend: 'insufficient_data',
        feelingDistribution: { good: 0, fair: 0, poor: 0 },
        dataPoints: [],
        recentTrend: 'insufficient_data',
        weeklyAverages: []
      };
    }
    
    const data = checkInData[0];
    
    // Calculate overall wellness trend
    let wellnessTrend = 'stable';
    if (data.checkIns.length > 5) {
      const firstFive = data.checkIns.slice(0, 5);
      const lastFive = data.checkIns.slice(-5);
      
      // Count feelings in first five and last five check-ins
      const firstFiveGoodCount = firstFive.filter(c => c.feeling === 'good').length;
      const lastFiveGoodCount = lastFive.filter(c => c.feeling === 'good').length;
      
      wellnessTrend = lastFiveGoodCount > firstFiveGoodCount ? 'improving' : 
                      lastFiveGoodCount < firstFiveGoodCount ? 'declining' : 'stable';
    }
    
    // Calculate feeling distribution percentages
    const feelingDistribution = {
      good: parseFloat(((data.goodCount / data.totalCount) * 100).toFixed(1)),
      fair: parseFloat(((data.fairCount / data.totalCount) * 100).toFixed(1)),
      poor: parseFloat(((data.poorCount / data.totalCount) * 100).toFixed(1))
    };
    
    // Calculate weekly averages
    const weeklyAverages = calculateWeeklyFeelingAverages(data.checkIns);
    
    // Calculate recent wellness trend (last 7 days vs previous 7 days)
    const recentTrend = calculateRecentWellnessTrend(data.checkIns);
    
    // Calculate symptom frequency
    const symptomFrequency = calculateSymptomFrequency(data.checkIns);
    
    // Calculate risk level distribution
    const riskLevelDistribution = calculateRiskLevelDistribution(data.riskLevels);
    
    // Calculate longest streak of good days
    const goodDayStreak = calculateLongestStreak(data.checkIns, 'good');
    
    // Extract data points for chart display
    const dataPoints = data.checkIns.map(c => ({
      date: c.createdAt,
      feeling: c.feeling,
      hasSymptoms: c.symptoms && c.symptoms.length > 0,
      symptomCount: c.symptoms ? c.symptoms.length : 0,
      riskLevel: c.aiAssessment ? c.aiAssessment.riskLevel : null
    }));
    
    return {
      checkInCount: data.totalCount,
      wellnessTrend,
      recentTrend,
      feelingDistribution,
      weeklyAverages,
      dataPoints,
      symptomFrequency,
      riskLevelDistribution,
      goodDayStreak
    };
  } catch (error) {
    logger.error('Error calculating enhanced wellness trends:', error);
    return {
      checkInCount: 0,
      wellnessTrend: 'error',
      feelingDistribution: { good: 0, fair: 0, poor: 0 },
      dataPoints: [],
      recentTrend: 'error',
      weeklyAverages: []
    };
  }
}

// Calculate weekly feeling averages
function calculateWeeklyFeelingAverages(checkIns) {
  // Group check-ins by week
  const weeklyGroups = {};
  
  checkIns.forEach(checkIn => {
    const date = new Date(checkIn.createdAt);
    const weekNumber = getWeekNumber(date);
    const weekKey = `${date.getFullYear()}-W${weekNumber}`;
    
    if (!weeklyGroups[weekKey]) {
      weeklyGroups[weekKey] = {
        week: weekKey,
        startDate: getFirstDayOfWeek(date),
        checkIns: []
      };
    }
    
    weeklyGroups[weekKey].checkIns.push(checkIn);
  });
  
  // Calculate feeling scores and averages for each week
  return Object.values(weeklyGroups).map(week => {
    const feelingScores = week.checkIns.map(c => {
      // Convert feeling to numeric score: good=3, fair=2, poor=1
      switch(c.feeling) {
        case 'good': return 3;
        case 'fair': return 2;
        case 'poor': return 1;
        default: return 0;
      }
    });
    
    const avgScore = feelingScores.reduce((sum, score) => sum + score, 0) / feelingScores.length;
    
    // Count feelings
    const goodCount = week.checkIns.filter(c => c.feeling === 'good').length;
    const fairCount = week.checkIns.filter(c => c.feeling === 'fair').length;
    const poorCount = week.checkIns.filter(c => c.feeling === 'poor').length;
    
    return {
      week: week.week,
      startDate: week.startDate,
      checkInCount: week.checkIns.length,
      averageScore: parseFloat(avgScore.toFixed(2)),
      feelingCounts: {
        good: goodCount,
        fair: fairCount,
        poor: poorCount
      },
      distribution: {
        good: parseFloat(((goodCount / week.checkIns.length) * 100).toFixed(1)),
        fair: parseFloat(((fairCount / week.checkIns.length) * 100).toFixed(1)),
        poor: parseFloat(((poorCount / week.checkIns.length) * 100).toFixed(1))
      }
    };
  }).sort((a, b) => a.startDate - b.startDate);
}

// Calculate recent wellness trend (last 7 days vs previous 7 days)
function calculateRecentWellnessTrend(checkIns) {
  if (checkIns.length < 7) {
    return 'insufficient_data';
  }
  
  // Sort by date
  const sortedCheckIns = [...checkIns].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Get last 7 days and previous 7 days
  const last7Days = sortedCheckIns.slice(0, 7);
  const previous7Days = sortedCheckIns.slice(7, 14);
  
  // If we don't have enough data for previous 7 days
  if (previous7Days.length < 3) {
    return 'insufficient_previous_data';
  }
  
  // Calculate average feeling scores
  function calcAvgScore(checkIns) {
    const scores = checkIns.map(c => {
      switch(c.feeling) {
        case 'good': return 3;
        case 'fair': return 2;
        case 'poor': return 1;
        default: return 0;
      }
    });
    
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
  
  const recentAvg = calcAvgScore(last7Days);
  const previousAvg = calcAvgScore(previous7Days);
  
  // Calculate percentage change
  const percentChange = ((recentAvg - previousAvg) / previousAvg) * 100;
  
  let trend;
  if (percentChange >= 10) {
    trend = 'significantly_improving';
  } else if (percentChange >= 5) {
    trend = 'slightly_improving';
  } else if (percentChange <= -10) {
    trend = 'significantly_declining';
  } else if (percentChange <= -5) {
    trend = 'slightly_declining';
  } else {
    trend = 'stable';
  }
  
  return {
    trend,
    percentChange: parseFloat(percentChange.toFixed(1)),
    recentAverage: parseFloat(recentAvg.toFixed(2)),
    previousAverage: parseFloat(previousAvg.toFixed(2))
  };
}

// Calculate symptom frequency
function calculateSymptomFrequency(checkIns) {
  const symptomCounts = {};
  let totalSymptomCount = 0;
  
  // Count occurrences of each symptom
  checkIns.forEach(checkIn => {
    if (checkIn.symptoms && checkIn.symptoms.length > 0) {
      checkIn.symptoms.forEach(symptom => {
        const symptomName = symptom.name.toLowerCase();
        if (!symptomCounts[symptomName]) {
          symptomCounts[symptomName] = {
            count: 0,
            severitySum: 0,
            occurrences: []
          };
        }
        
        symptomCounts[symptomName].count++;
        symptomCounts[symptomName].severitySum += symptom.severity || 0;
        symptomCounts[symptomName].occurrences.push({
          date: checkIn.createdAt,
          severity: symptom.severity || 0
        });
        
        totalSymptomCount++;
      });
    }
  });
  
  // Calculate average severity and sort by frequency
  const symptoms = Object.entries(symptomCounts).map(([name, data]) => ({
    name,
    count: data.count,
    frequency: parseFloat(((data.count / checkIns.length) * 100).toFixed(1)),
    averageSeverity: parseFloat((data.severitySum / data.count).toFixed(1)),
    occurrences: data.occurrences
  })).sort((a, b) => b.count - a.count);
  
  return {
    totalSymptomCount,
    averagePerCheckIn: parseFloat((totalSymptomCount / checkIns.length).toFixed(2)),
    uniqueSymptomCount: symptoms.length,
    symptoms
  };
}

// Calculate risk level distribution
function calculateRiskLevelDistribution(riskLevels) {
  if (!riskLevels || riskLevels.length === 0) {
    return {
      low: 0,
      medium: 0,
      high: 0,
      emergency: 0
    };
  }
  
  // Count occurrences of each risk level
  const counts = {
    low: 0,
    medium: 0,
    high: 0,
    emergency: 0
  };
  
  riskLevels.forEach(item => {
    if (item.riskLevel) {
      counts[item.riskLevel] = (counts[item.riskLevel] || 0) + 1;
    }
  });
  
  // Calculate percentages
  const total = riskLevels.length;
  const distribution = {
    low: parseFloat(((counts.low / total) * 100).toFixed(1)),
    medium: parseFloat(((counts.medium / total) * 100).toFixed(1)),
    high: parseFloat(((counts.high / total) * 100).toFixed(1)),
    emergency: parseFloat(((counts.emergency / total) * 100).toFixed(1))
  };
  
  return {
    counts,
    distribution,
    total
  };
}

// Calculate longest streak of a specific feeling
function calculateLongestStreak(checkIns, targetFeeling) {
  if (!checkIns || checkIns.length === 0) {
    return 0;
  }
  
  // Sort by date (oldest first)
  const sortedCheckIns = [...checkIns].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  
  let currentStreak = 0;
  let longestStreak = 0;
  let currentStreakStart = null;
  let longestStreakStart = null;
  let longestStreakEnd = null;
  
  for (let i = 0; i < sortedCheckIns.length; i++) {
    if (sortedCheckIns[i].feeling === targetFeeling) {
      // Start or continue streak
      if (currentStreak === 0) {
        currentStreakStart = sortedCheckIns[i].createdAt;
      }
      currentStreak++;
      
      // Update longest streak if current is longer
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        longestStreakStart = currentStreakStart;
        longestStreakEnd = sortedCheckIns[i].createdAt;
      }
    } else {
      // Reset streak
      currentStreak = 0;
      currentStreakStart = null;
    }
  }
  
  return {
    length: longestStreak,
    startDate: longestStreakStart,
    endDate: longestStreakEnd
  };
}

// Calculate lifestyle trends from health check-ins
async function calculateLifestyleTrends(userId) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Get health check-ins with lifestyle data
    const checkIns = await HealthCheckIn.find({
      userId,
      createdAt: { $gte: thirtyDaysAgo }
    }).sort({ createdAt: 1 });
    
    if (checkIns.length === 0) {
      return {
        checkInCount: 0,
        message: "No health check-ins found"
      };
    }
    
    // Filter check-ins with lifestyle data
    const checkInsWithSleep = checkIns.filter(c => c.sleepHours !== null && c.sleepHours !== undefined);
    const checkInsWithStress = checkIns.filter(c => c.stressLevel !== null && c.stressLevel !== undefined);
    const checkInsWithMedication = checkIns.filter(c => c.medicationAdherence !== null && c.medicationAdherence !== undefined);
    const checkInsWithWater = checkIns.filter(c => c.waterIntake !== null && c.waterIntake !== undefined);
    const checkInsWithExercise = checkIns.filter(c => c.exerciseMinutes !== null && c.exerciseMinutes !== undefined);
    
    // Calculate sleep metrics
    const sleepMetrics = checkInsWithSleep.length > 0 ? {
      checkInCount: checkInsWithSleep.length,
      averageSleepHours: parseFloat((checkInsWithSleep.reduce((sum, c) => sum + c.sleepHours, 0) / checkInsWithSleep.length).toFixed(1)),
      minSleepHours: Math.min(...checkInsWithSleep.map(c => c.sleepHours)),
      maxSleepHours: Math.max(...checkInsWithSleep.map(c => c.sleepHours)),
      optimalSleepPercent: parseFloat(((checkInsWithSleep.filter(c => c.sleepHours >= 7 && c.sleepHours <= 9).length / checkInsWithSleep.length) * 100).toFixed(1)),
      dataPoints: checkInsWithSleep.map(c => ({
        date: c.createdAt,
        sleepHours: c.sleepHours,
        feeling: c.feeling
      }))
    } : null;
    
    // Calculate stress metrics
    const stressMetrics = checkInsWithStress.length > 0 ? {
      checkInCount: checkInsWithStress.length,
      averageStressLevel: parseFloat((checkInsWithStress.reduce((sum, c) => sum + c.stressLevel, 0) / checkInsWithStress.length).toFixed(1)),
      highStressPercent: parseFloat(((checkInsWithStress.filter(c => c.stressLevel >= 4).length / checkInsWithStress.length) * 100).toFixed(1)),
      lowStressPercent: parseFloat(((checkInsWithStress.filter(c => c.stressLevel <= 2).length / checkInsWithStress.length) * 100).toFixed(1)),
      dataPoints: checkInsWithStress.map(c => ({
        date: c.createdAt,
        stressLevel: c.stressLevel,
        feeling: c.feeling
      }))
    } : null;
    
    // Calculate medication adherence metrics
    const medicationMetrics = checkInsWithMedication.length > 0 ? {
      checkInCount: checkInsWithMedication.length,
      adherenceRate: parseFloat(((checkInsWithMedication.filter(c => c.medicationAdherence === 'full').length / checkInsWithMedication.length) * 100).toFixed(1)),
      distribution: {
        full: parseFloat(((checkInsWithMedication.filter(c => c.medicationAdherence === 'full').length / checkInsWithMedication.length) * 100).toFixed(1)),
        partial: parseFloat(((checkInsWithMedication.filter(c => c.medicationAdherence === 'partial').length / checkInsWithMedication.length) * 100).toFixed(1)),
        missed: parseFloat(((checkInsWithMedication.filter(c => c.medicationAdherence === 'missed').length / checkInsWithMedication.length) * 100).toFixed(1))
      },
      dataPoints: checkInsWithMedication.map(c => ({
        date: c.createdAt,
        medicationAdherence: c.medicationAdherence,
        feeling: c.feeling
      }))
    } : null;
    
    // Calculate water intake metrics
    const waterMetrics = checkInsWithWater.length > 0 ? {
      checkInCount: checkInsWithWater.length,
      averageWaterIntake: parseFloat((checkInsWithWater.reduce((sum, c) => sum + c.waterIntake, 0) / checkInsWithWater.length).toFixed(1)),
      sufficientHydrationPercent: parseFloat(((checkInsWithWater.filter(c => c.waterIntake >= 8).length / checkInsWithWater.length) * 100).toFixed(1)),
      dataPoints: checkInsWithWater.map(c => ({
        date: c.createdAt,
        waterIntake: c.waterIntake,
        feeling: c.feeling
      }))
    } : null;
    
    // Calculate exercise metrics
    const exerciseMetrics = checkInsWithExercise.length > 0 ? {
      checkInCount: checkInsWithExercise.length,
      averageExerciseMinutes: parseFloat((checkInsWithExercise.reduce((sum, c) => sum + c.exerciseMinutes, 0) / checkInsWithExercise.length).toFixed(1)),
      activePercent: parseFloat(((checkInsWithExercise.filter(c => c.exerciseMinutes >= 30).length / checkInsWithExercise.length) * 100).toFixed(1)),
      dataPoints: checkInsWithExercise.map(c => ({
        date: c.createdAt,
        exerciseMinutes: c.exerciseMinutes,
        feeling: c.feeling
      }))
    } : null;
    
    // Analyze correlations between lifestyle factors and feeling
    const correlations = analyzeLifestyleCorrelations(checkIns);
    
    return {
      totalCheckIns: checkIns.length,
      sleepMetrics,
      stressMetrics,
      medicationMetrics,
      waterMetrics,
      exerciseMetrics,
      correlations
    };
  } catch (error) {
    logger.error('Error calculating lifestyle trends:', error);
    return {
      error: 'Failed to calculate lifestyle trends',
      checkInCount: 0
    };
  }
}

// Analyze lifestyle correlations with feeling
function analyzeLifestyleCorrelations(checkIns) {
  // Need at least 5 check-ins for correlations
  if (checkIns.length < 5) {
    return {
      message: "Insufficient data for correlation analysis"
    };
  }
  
  const correlations = [];
  
  // Convert feelings to numeric scores
  const feelingScores = checkIns.map(c => {
    let score;
    switch(c.feeling) {
      case 'good': score = 3; break;
      case 'fair': score = 2; break;
      case 'poor': score = 1; break;
      default: score = null;
    }
    
    return {
      date: c.createdAt,
      score,
      sleepHours: c.sleepHours,
      stressLevel: c.stressLevel,
      waterIntake: c.waterIntake,
      exerciseMinutes: c.exerciseMinutes,
      medicationAdherence: c.medicationAdherence
    };
  });
  
  // Calculate sleep correlation
  const sleepData = feelingScores.filter(d => d.score !== null && d.sleepHours !== null && d.sleepHours !== undefined);
  if (sleepData.length >= 5) {
    const sleepCorrelation = calculatePearsonCorrelation(
      sleepData.map(d => d.sleepHours),
      sleepData.map(d => d.score)
    );
    
    correlations.push({
      factor: 'sleepHours',
      correlation: parseFloat(sleepCorrelation.toFixed(2)),
      strength: getCorrelationStrength(sleepCorrelation),
      direction: sleepCorrelation > 0 ? 'positive' : 'negative',
      interpretation: sleepCorrelation > 0 ? 'More sleep is associated with better feelings' : 'More sleep is associated with worse feelings',
      sampleSize: sleepData.length
    });
  }
  
  // Calculate stress correlation
  const stressData = feelingScores.filter(d => d.score !== null && d.stressLevel !== null && d.stressLevel !== undefined);
  if (stressData.length >= 5) {
    const stressCorrelation = calculatePearsonCorrelation(
      stressData.map(d => d.stressLevel),
      stressData.map(d => d.score)
    );
    
    correlations.push({
      factor: 'stressLevel',
      correlation: parseFloat(stressCorrelation.toFixed(2)),
      strength: getCorrelationStrength(stressCorrelation),
      direction: stressCorrelation > 0 ? 'positive' : 'negative',
      interpretation: stressCorrelation < 0 ? 'Lower stress is associated with better feelings' : 'Higher stress is associated with better feelings',
      sampleSize: stressData.length
    });
  }
  
  // Calculate water intake correlation
  const waterData = feelingScores.filter(d => d.score !== null && d.waterIntake !== null && d.waterIntake !== undefined);
  if (waterData.length >= 5) {
    const waterCorrelation = calculatePearsonCorrelation(
      waterData.map(d => d.waterIntake),
      waterData.map(d => d.score)
    );
    
    correlations.push({
      factor: 'waterIntake',
      correlation: parseFloat(waterCorrelation.toFixed(2)),
      strength: getCorrelationStrength(waterCorrelation),
      direction: waterCorrelation > 0 ? 'positive' : 'negative',
      interpretation: waterCorrelation > 0 ? 'More water intake is associated with better feelings' : 'More water intake is associated with worse feelings',
      sampleSize: waterData.length
    });
  }
  
  // Calculate exercise correlation
  const exerciseData = feelingScores.filter(d => d.score !== null && d.exerciseMinutes !== null && d.exerciseMinutes !== undefined);
  if (exerciseData.length >= 5) {
    const exerciseCorrelation = calculatePearsonCorrelation(
      exerciseData.map(d => d.exerciseMinutes),
      exerciseData.map(d => d.score)
    );
    
    correlations.push({
      factor: 'exerciseMinutes',
      correlation: parseFloat(exerciseCorrelation.toFixed(2)),
      strength: getCorrelationStrength(exerciseCorrelation),
      direction: exerciseCorrelation > 0 ? 'positive' : 'negative',
      interpretation: exerciseCorrelation > 0 ? 'More exercise is associated with better feelings' : 'More exercise is associated with worse feelings',
      sampleSize: exerciseData.length
    });
  }
  
  // Sort by correlation strength (absolute value)
  correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  
  // Calculate medication adherence effect
  const medicationEffect = calculateMedicationAdherenceEffect(feelingScores);
  
  return {
    correlations,
    medicationEffect
  };
}

// Calculate medication adherence effect on feeling scores
function calculateMedicationAdherenceEffect(feelingScores) {
  const medicationData = feelingScores.filter(d => d.score !== null && d.medicationAdherence !== null && d.medicationAdherence !== undefined);
  
  if (medicationData.length < 5) {
    return null;
  }
  
  // Group by adherence level
  const groupedByAdherence = {
    full: medicationData.filter(d => d.medicationAdherence === 'full'),
    partial: medicationData.filter(d => d.medicationAdherence === 'partial'),
    missed: medicationData.filter(d => d.medicationAdherence === 'missed')
  };
  
  // Calculate average feeling score for each group
  const averageScores = {};
  Object.entries(groupedByAdherence).forEach(([adherence, data]) => {
    if (data.length > 0) {
      averageScores[adherence] = parseFloat((data.reduce((sum, d) => sum + d.score, 0) / data.length).toFixed(2));
    }
  });
  
  // Calculate overall effect if we have at least two groups
  let effectStrength = 'unknown';
  let direction = 'unknown';
  
  if (averageScores.full && (averageScores.partial || averageScores.missed)) {
    const fullScore = averageScores.full;
    const nonFullScore = averageScores.missed || averageScores.partial;
    
    const difference = fullScore - nonFullScore;
    
    if (Math.abs(difference) > 0.5) {
      effectStrength = 'strong';
    } else if (Math.abs(difference) > 0.2) {
      effectStrength = 'moderate';
    } else {
      effectStrength = 'weak';
    }
    
    direction = difference > 0 ? 'positive' : 'negative';
  }
  
  return {
    averageScores,
    effect: {
      strength: effectStrength,
      direction,
      interpretation: direction === 'positive' ? 'Full medication adherence is associated with better feelings' : 'Full medication adherence does not show clear improvement in feelings'
    },
    sampleSizes: {
      full: groupedByAdherence.full.length,
      partial: groupedByAdherence.partial.length,
      missed: groupedByAdherence.missed.length
    }
  };
}

// Analyze symptom patterns over time
async function analyzeSymptomPatterns(userId) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Get health check-ins with symptoms
    const checkIns = await HealthCheckIn.find({
      userId,
      createdAt: { $gte: thirtyDaysAgo },
      'symptoms.0': { $exists: true } // Only include check-ins with at least one symptom
    }).sort({ createdAt: 1 });
    
    if (checkIns.length === 0) {
      return {
        checkInCount: 0,
        message: "No symptom data found"
      };
    }
    
    // Extract and organize symptom data
    const allSymptoms = [];
    const symptomsByDate = {};
    const uniqueSymptoms = new Set();
    
    checkIns.forEach(checkIn => {
      const dateStr = new Date(checkIn.createdAt).toISOString().split('T')[0];
      
      if (!symptomsByDate[dateStr]) {
        symptomsByDate[dateStr] = [];
      }
      
      checkIn.symptoms.forEach(symptom => {
        const symptomObj = {
          name: symptom.name.toLowerCase(),
          severity: symptom.severity || 0,
          date: checkIn.createdAt,
          feeling: checkIn.feeling,
          bodyLocation: symptom.bodyLocation,
          dateStr
        };
        
        allSymptoms.push(symptomObj);
        symptomsByDate[dateStr].push(symptomObj);
        uniqueSymptoms.add(symptom.name.toLowerCase());
      });
    });
    
    // Calculate symptom frequency and severity
    const symptomStats = {};
    
    allSymptoms.forEach(symptom => {
      if (!symptomStats[symptom.name]) {
        symptomStats[symptom.name] = {
          count: 0,
          severitySum: 0,
          occurrences: [],
          dateStrs: new Set()
        };
      }
      
      symptomStats[symptom.name].count++;
      symptomStats[symptom.name].severitySum += symptom.severity;
      symptomStats[symptom.name].occurrences.push({
        date: symptom.date,
        severity: symptom.severity,
        feeling: symptom.feeling,
        bodyLocation: symptom.bodyLocation
      });
      symptomStats[symptom.name].dateStrs.add(symptom.dateStr);
    });
    
    // Calculate symptom metrics
    const symptomMetrics = Object.entries(symptomStats).map(([name, stats]) => ({
      name,
      occurrenceCount: stats.count,
      dayCount: stats.dateStrs.size,
      averageSeverity: parseFloat((stats.severitySum / stats.count).toFixed(1)),
      occurrences: stats.occurrences.sort((a, b) => new Date(a.date) - new Date(b.date)),
      prevalence: parseFloat(((stats.dateStrs.size / Object.keys(symptomsByDate).length) * 100).toFixed(1))
    })).sort((a, b) => b.dayCount - a.dayCount);
    
    // Identify co-occurring symptoms
    const coOccurrences = {};
    
    Object.values(symptomsByDate).forEach(dateSymptoms => {
      if (dateSymptoms.length > 1) {
        // Check each pair of symptoms on the same day
        for (let i = 0; i < dateSymptoms.length; i++) {
          for (let j = i + 1; j < dateSymptoms.length; j++) {
            const sym1 = dateSymptoms[i].name;
            const sym2 = dateSymptoms[j].name;
            
            // Create consistent key regardless of symptom order
            const pairKey = [sym1, sym2].sort().join('__');
            
            if (!coOccurrences[pairKey]) {
              coOccurrences[pairKey] = {
                symptoms: [sym1, sym2],
                count: 0,
                dates: new Set()
              };
            }
            
            coOccurrences[pairKey].count++;
            coOccurrences[pairKey].dates.add(dateSymptoms[i].dateStr);
          }
        }
      }
    });
    
    // Calculate co-occurrence metrics
    const coOccurrenceMetrics = Object.values(coOccurrences)
      .map(pair => ({
        symptoms: pair.symptoms,
        dayCount: pair.dates.size,
        prevalence: parseFloat(((pair.dates.size / Object.keys(symptomsByDate).length) * 100).toFixed(1))
      }))
      .filter(pair => pair.dayCount >= 2) // Only include pairs that co-occur at least twice
      .sort((a, b) => b.dayCount - a.dayCount);
    
    // Calculate recent symptom counts (last 7 days)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const recentSymptoms = allSymptoms.filter(s => new Date(s.date) >= oneWeekAgo);
    const recentSymptomCount = recentSymptoms.length;
    const recentDaysWithSymptoms = new Set(recentSymptoms.map(s => s.dateStr)).size;
    
    return {
      totalCheckInsWithSymptoms: checkIns.length,
      uniqueSymptomCount: uniqueSymptoms.size,
      totalSymptomOccurrences: allSymptoms.length,
      daysWithSymptoms: Object.keys(symptomsByDate).length,
      recentSymptomCount,
      recentDaysWithSymptoms,
      symptomMetrics: symptomMetrics.slice(0, 10), // Top 10 most frequent symptoms
      coOccurrenceMetrics: coOccurrenceMetrics.slice(0, 5) // Top 5 co-occurrences
    };
  } catch (error) {
    logger.error('Error analyzing symptom patterns:', error);
    return {
      error: 'Failed to analyze symptom patterns',
      checkInCount: 0
    };
  }
}

// Helper function to get the longest streak of abnormal readings
function getAbnormalStreak(readings) {
  if (!readings || readings.length === 0) {
    return 0;
  }
  
  // Sort by date (newest first)
  const sortedReadings = [...readings].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  let currentStreak = 0;
  
  for (const reading of sortedReadings) {
    if (!reading.isNormal) {
      currentStreak++;
    } else {
      break;
    }
  }
  
  return currentStreak;
}

// Helper function to detect outliers in vital sign readings
function detectOutliers(readings, type) {
  if (!readings || readings.length < 5) {
    return [];
  }
  
  const outliers = [];
  
  // Get key value based on reading type
  const getKeyValue = (reading) => {
    switch(type) {
      case 'bloodPressure':
        return reading.values.systolic;
      case 'glucose':
        return reading.values.glucoseLevel;
      case 'heartRate':
        return reading.values.heartRate;
      case 'oxygenLevel':
        return reading.values.oxygenLevel;
      case 'weight':
        return reading.values.weight;
      case 'temperature':
        return reading.values.temperature;
      default:
        return null;
    }
  };
  
  // Get values
  const values = readings.map(r => getKeyValue(r)).filter(v => v !== null);
  
  // Calculate mean and standard deviation
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const std = Math.sqrt(values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length);
  
  // Find outliers (values more than 2 standard deviations from mean)
  readings.forEach(reading => {
    const value = getKeyValue(reading);
    if (value !== null) {
      const zScore = Math.abs((value - mean) / std);
      
      if (zScore > 2) {
        outliers.push({
          timestamp: reading.timestamp,
          value,
          zScore: parseFloat(zScore.toFixed(2)),
          isHigh: value > mean
        });
      }
    }
  });
  
  return outliers.sort((a, b) => b.zScore - a.zScore);
}

// Helper functions for date calculations
function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Helper function to get the first day of the week
function getFirstDayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

// Get latest vital signs of each type
async function getLatestVitalSigns(userId) {
  try {
    // Get the latest reading of each type
    const latestVitals = await VitalSign.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $sort: { timestamp: -1 } },
      { $group: {
          _id: "$type",
          latestReading: { $first: "$ROOT" }
        }
      }
    ]);
    
    // Format the results
    const formattedVitals = {};
    latestVitals.forEach(item => {
      formattedVitals[item._id] = {
        timestamp: item.latestReading.timestamp,
        values: item.latestReading.values,
        derivedValues: item.latestReading.derivedValues || {},
        unit: item.latestReading.unit,
        isNormal: item.latestReading.isNormal
      };
    });
    
    return formattedVitals;
  } catch (error) {
    logger.error('Error getting latest vital signs:', error);
    return {};
  }
}

// Generate health dashboard insights using AI with a reassuring tone
async function generateHealthDashboardInsights(
  userId, 
  latestVitals, 
  latestCheckIn,
  vitalTrends,
  wellnessTrends,
  lifestyleTrends,
  symptomPatterns,
  symptomCorrelations
) {
  try {
    // Skip AI processing in development mode
    if (process.env.NODE_ENV === 'development') {
      return [
        "Your consistent health tracking is helping you build a good picture of your overall wellness - this is a great proactive step for your health!",
        "Your vital signs are generally within expected ranges, which is a positive sign. Keep up the good monitoring routine you've established.",
        "Regular check-ins help identify patterns over time, giving you more control over your health journey. You're doing great with this consistent tracking!"
      ];
    }
    
    // Prepare data summary for AI
    const vitalSummary = Object.entries(latestVitals).map(([type, data]) => {
      let readingDescription;
      switch(type) {
        case 'bloodPressure':
          readingDescription = `${data.values.systolic}/${data.values.diastolic} mmHg`;
          break;
        case 'glucose':
          readingDescription = `${data.values.glucoseLevel} mg/dL`;
          break;
        case 'heartRate':
          readingDescription = `${data.values.heartRate} bpm`;
          break;
        case 'oxygenLevel':
          readingDescription = `${data.values.oxygenLevel}%`;
          break;
        case 'temperature':
          readingDescription = `${data.values.temperature}°F`;
          break;
        default:
          readingDescription = JSON.stringify(data.values);
      }
      return `${type}: ${readingDescription} (${data.isNormal ? 'normal' : 'abnormal'})`;
    }).join(', ');
    
    const feelingSummary = latestCheckIn ? 
      `Last health check-in: feeling ${latestCheckIn.feeling} with ${latestCheckIn.symptoms?.length || 0} symptoms` : 
      'No recent health check-ins';
    
    const wellnessSummary = wellnessTrends?.wellnessTrend !== 'insufficient_data' ? 
      `Wellness trend: ${wellnessTrends.wellnessTrend} (${wellnessTrends.feelingDistribution?.good || 0}% good days)` :
      'Insufficient data for wellness trend';
    
    // Prepare lifestyle summary
    let lifestyleSummary = 'Lifestyle factors: ';
    if (lifestyleTrends) {
      if (lifestyleTrends.sleepMetrics) {
        lifestyleSummary += `avg sleep ${lifestyleTrends.sleepMetrics.averageSleepHours} hrs, `;
      }
      if (lifestyleTrends.stressMetrics) {
        lifestyleSummary += `avg stress level ${lifestyleTrends.stressMetrics.averageStressLevel}/5, `;
      }
      if (lifestyleTrends.medicationMetrics) {
        lifestyleSummary += `medication adherence ${lifestyleTrends.medicationMetrics.adherenceRate}%, `;
      }
    }
    
    // Prepare symptom summary
    let symptomSummary = '';
    if (symptomPatterns && symptomPatterns.symptomMetrics && symptomPatterns.symptomMetrics.length > 0) {
      const topSymptoms = symptomPatterns.symptomMetrics.slice(0, 3);
      symptomSummary = `Most frequent symptoms: ${topSymptoms.map(s => s.name).join(', ')}`;
    }
    
    // Prepare correlation summary
    let correlationSummary = '';
    if (symptomCorrelations && symptomCorrelations.length > 0) {
      correlationSummary = `Significant medication-symptom correlations: ${symptomCorrelations.map(c => 
        `${c.medicationName} and ${c.symptomName} (${c.strength} ${c.direction} correlation)`
      ).join('; ')}`;
    }
    
    // Call OpenAI for dashboard insights with a reassuring tone
    const prompt = `
      As a compassionate healthcare assistant, provide 3-5 personalized, reassuring health insights based on this data summary:
      ${vitalSummary}
      ${feelingSummary}
      ${wellnessSummary}
      ${lifestyleSummary}
      ${symptomSummary}
      ${correlationSummary}
      
      Your insights should be:
      1. Warm and supportive in tone - never alarming or clinical
      2. Specific to the data provided but easy to understand
      3. Actionable and encouraging
      4. Focused on empowering the person's health journey
      
      Format as JSON array of strings.`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a compassionate healthcare assistant providing warm, reassuring insights." },
        { role: "user", content: prompt }
      ],
      max_tokens: 400,
      temperature: 0.5
    });
    
    // Parse the response
    try {
      const insights = JSON.parse(completion.choices[0].message.content.trim());
      return insights;
    } catch (parseError) {
      logger.error('Error parsing AI insights:', parseError);
      
      // Fall back to extracting insights from non-JSON response
      const responseText = completion.choices[0].message.content.trim();
      
      // Extract insights by line breaks or numbered points
      const extractedInsights = responseText
        .split(/\n|\d\./)
        .map(line => line.trim())
        .filter(line => line.length > 20);
        
      return extractedInsights.length > 0 ? extractedInsights : [responseText];
    }
  } catch (error) {
    logger.error('Error generating dashboard insights:', error);
    // Fallback insights in case of API error - with reassuring tone
    return [
      "Your consistent health tracking is a wonderful proactive step - you're building a valuable picture of your overall wellness journey!",
      "The patterns in your data give you more insight and control over your health. Keep up this excellent monitoring routine you've established.",
      "Remember that day-to-day fluctuations are completely normal. The long-term trends are what matter most, and you're doing great tracking those!"
    ];
  }
}

// Trigger caregiver notification
async function triggerCaregiverNotification(userId, type, data) {
  try {
    // Implementation depends on your notification system
    // This is a placeholder for the notification logic
    logger.info(`Notification triggered for user ${userId}. Type: ${type}`);
    
    // In a real implementation, you would:
    // 1. Find the user's caregivers
    // 2. Create notifications for each caregiver
    // 3. Send push notifications, SMS, or emails as appropriate
    
    // Send push notification to user
    const notificationTitle = type === 'health_concern' ? 
      'Health Check-in Follow-up' : 
      'Health Update';
    
    const notificationBody = type === 'health_concern' ?
      'Your recent health check-in suggests you may need follow-up. Tap to view details.' :
      'There\'s an update regarding your recent health check-in. Tap to view details.';
    
    await sendPushNotification(userId, notificationTitle, notificationBody, data);
    
    return true;
  } catch (error) {
    logger.error('Error triggering caregiver notification:', error);
    return false;
  }
}

// GET /api/health/vitals/trends
exports.getVitalTrends = async (req, res) => {
  try {
    const { groupBy = 'day', type, from, to } = req.query;
    
    // Validate groupBy parameter
    const validGroupings = ['day', 'week', 'month'];
    if (!validGroupings.includes(groupBy)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid groupBy parameter. Must be one of: ${validGroupings.join(', ')}`
      });
    }
    
    // Create date range filter if provided
    const dateFilter = {};
    if (from || to) {
      if (from) dateFilter.from = new Date(from);
      if (to) dateFilter.to = new Date(to);
    }
    
    // Calculate enhanced trends with the requested parameters
    const trends = await calculateEnhancedTrends(req.user._id, groupBy, type, dateFilter);
    
    // Generate human-readable insight for each vital type
    const trendsWithInsights = {};
    
    for (const [vitalType, data] of Object.entries(trends)) {
      // Skip if no readings for this type
      if (!data || data.readings === 0) continue;
      
      trendsWithInsights[vitalType] = {
        ...data,
        insight: generateTrendInsight(vitalType, data)
      };
    }
    
    // Check if we have data
    if (Object.keys(trendsWithInsights).length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No vital sign data available for the specified criteria',
        trends: {}
      });
    }
    
    res.status(200).json({
      status: 'success',
      trends: trendsWithInsights,
      groupBy,
      period: {
        from: dateFilter.from || 'all available',
        to: dateFilter.to || 'latest'
      }
    });
  } catch (error) {
    logger.error('Error getting vital trends:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get vital trends',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to generate human-readable insights for trends
function generateTrendInsight(type, trendData) {
  try {
    const { trendDirection, changePercentage, readings, normalCount, abnormalCount, variability } = trendData;
    
    // No readings case
    if (readings === 0) {
      return "No readings available to analyze trends.";
    }
    
    // Normal/abnormal ratio
    const normalPercentage = Math.round((normalCount / readings) * 100);
    
    // Start with type-specific context
    let typeContext = '';
    switch (type) {
      case 'bloodPressure':
        typeContext = 'blood pressure';
        break;
      case 'glucose':
        typeContext = 'blood glucose';
        break;
      case 'heartRate':
        typeContext = 'heart rate';
        break;
      case 'oxygenLevel':
        typeContext = 'oxygen saturation';
        break;
      case 'temperature':
        typeContext = 'body temperature';
        break;
      case 'weight':
        typeContext = 'weight';
        break;
      default:
        typeContext = type;
    }
    
    // Basic insight based on trend direction with reassuring tone
    let message = '';
    if (trendDirection === 'increasing') {
      if ((type === 'bloodPressure' || type === 'glucose') && changePercentage > 5) {
        message = `Your ${typeContext} readings have been gradually increasing by about ${changePercentage}% over this period. Small variations are normal, and tracking helps you stay informed. `;
      } else if (type === 'oxygenLevel' && changePercentage > 2) {
        message = `Your ${typeContext} has improved by about ${changePercentage}% during this period, which is a positive trend. `;
      } else {
        message = `Your ${typeContext} readings have shown a slight upward trend of about ${changePercentage}% over this period. `;
      }
    } else if (trendDirection === 'decreasing') {
      if ((type === 'bloodPressure' || type === 'glucose') && changePercentage > 5) {
        message = `Your ${typeContext} readings have been gradually decreasing by about ${changePercentage}% over this period, which can be a positive change depending on your baseline. `;
      } else if (type === 'oxygenLevel' && changePercentage > 2) {
        message = `Your ${typeContext} has decreased slightly by about ${changePercentage}% during this period. Remember that small variations are normal. `;
      } else {
        message = `Your ${typeContext} readings have shown a slight downward trend of about ${changePercentage}% over this period. `;
      }
    } else {
      message = `Your ${typeContext} readings have remained relatively stable over this period, which is generally a good sign of consistency. `;
    }
    
    // Add information about normal readings
    if (normalPercentage >= 85) {
      message += `${normalPercentage}% of your readings have been within normal range, which is excellent. `;
    } else if (normalPercentage >= 70) {
      message += `${normalPercentage}% of your readings have been within normal range, which is good. `;
    } else {
      message += `${normalPercentage}% of your readings have been within normal range. Continuing to track helps you and your healthcare provider understand these patterns better. `;
    }
    
    // Add variability insight if available
    if (variability) {
      const mainKey = type === 'bloodPressure' ? 'systolic' : 
                      type === 'glucose' ? 'glucoseLevel' : 
                      type === 'heartRate' ? 'heartRate' : 
                      type === 'oxygenLevel' ? 'oxygenLevel' : 
                      type === 'weight' ? 'weight' : 'value';
                      
      if (variability[mainKey] && parseFloat(variability[mainKey]) > 0) {
        const variabilityValue = parseFloat(variability[mainKey]);
        if (variabilityValue < 5) {
          message += `Your readings show minimal variability, suggesting good stability.`;
        } else if (variabilityValue < 10) {
          message += `Your readings show moderate variability, which is common in daily measurements.`;
        } else {
          message += `Your readings show some variability, which is something to keep an eye on while continuing your tracking.`;
        }
      }
    }
    
    return message;
  } catch (error) {
    logger.error('Error generating trend insight:', error);
    return "Trend analysis available, but detailed insight generation was not possible.";
  }
}

// GET /api/health/vitals/correlations
exports.getVitalCorrelations = async (req, res) => {
  try {
    const { minCorrelation = 0.3, from, to } = req.query;
    
    // Create date range filter if provided
    const dateFilter = {};
    if (from || to) {
      if (from) dateFilter.from = new Date(from);
      if (to) dateFilter.to = new Date(to);
    }
    
    // Calculate correlations between different vital signs with filter criteria
    const correlationResults = await calculateVitalSignCorrelations(
      req.user._id, 
      parseFloat(minCorrelation),
      dateFilter
    );
    
    // Add human-readable interpretations for the correlations
    const enhancedCorrelations = correlationResults.correlations.map(correlation => ({
      ...correlation,
      userFriendlyInterpretation: generateCorrelationInsight(correlation)
    }));
    
    // Prepare response
    const response = {
      status: 'success',
      correlations: enhancedCorrelations,
      dailyReadingsCount: correlationResults.dailyReadingsCount,
      significantCorrelationsCount: enhancedCorrelations.length,
      message: correlationResults.message
    };
    
    // Add recommendation if few or no correlations found
    if (enhancedCorrelations.length < 2 && correlationResults.dailyReadingsCount > 0) {
      response.recommendation = "Continue tracking multiple vital signs regularly to reveal more correlations between them. The more data you provide, the more insights become available.";
    }
    
    res.status(200).json(response);
  } catch (error) {
    logger.error('Error getting vital correlations:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get vital correlations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to generate human-readable correlation insights
function generateCorrelationInsight(correlation) {
  try {
    const { metric1, metric2, correlation: value, strength, direction } = correlation;
    
    // Extract readable metric names
    const getReadableMetricName = (metricPath) => {
      const parts = metricPath.split('.');
      let readableName = '';
      
      switch (parts[0]) {
        case 'bloodPressure':
          readableName = parts[1] === 'systolic' ? 'systolic blood pressure' : 'diastolic blood pressure';
          break;
        case 'glucose':
          readableName = 'blood glucose';
          break;
        case 'heartRate':
          readableName = 'heart rate';
          break;
        case 'oxygenLevel':
          readableName = 'oxygen saturation';
          break;
        case 'temperature':
          readableName = 'body temperature';
          break;
        case 'weight':
          readableName = 'weight';
          break;
        default:
          readableName = metricPath;
      }
      
      return readableName;
    };
    
    const metric1Name = getReadableMetricName(metric1);
    const metric2Name = getReadableMetricName(metric2);
    
    // Create a user-friendly message with reassuring tone
    let message = `There appears to be a ${strength} ${direction} relationship between your ${metric1Name} and ${metric2Name}. `;
    
    if (direction === 'positive') {
      message += `This means that when one increases, the other tends to increase as well. `;
    } else {
      message += `This means that when one increases, the other tends to decrease. `;
    }
    
    // Add health context if appropriate for common physiological relationships
    if ((metric1.includes('bloodPressure') && metric2.includes('heartRate')) || 
        (metric2.includes('bloodPressure') && metric1.includes('heartRate'))) {
      message += `This is a common physiological relationship many people experience, as your heart often works harder (faster heart rate) to maintain blood pressure.`;
    } else if ((metric1.includes('temperature') && metric2.includes('heartRate')) || 
               (metric2.includes('temperature') && metric1.includes('heartRate'))) {
      message += `This is a normal physiological response, as your heart typically beats faster when body temperature rises.`;
    } else if ((metric1.includes('oxygenLevel') && metric2.includes('heartRate')) || 
               (metric2.includes('oxygenLevel') && metric1.includes('heartRate'))) {
      message += `Your body may be compensating for oxygen levels by adjusting heart rate, which is a normal regulatory response.`;
    } else {
      message += `Tracking these measurements over time helps you understand your personal health patterns better.`;
    }
    
    return message;
  } catch (error) {
    logger.error('Error generating correlation insight:', error);
    return "A correlation has been detected between these measurements.";
  }
}

// GET /api/health/symptoms/patterns
exports.getSymptomPatterns = async (req, res) => {
  try {
    const { from, to, includeDetails = 'true' } = req.query;
    
    // Create date range filter if provided
    const dateFilter = {};
    if (from || to) {
      if (from) dateFilter.from = new Date(from);
      if (to) dateFilter.to = new Date(to);
    }
    
    // Analyze patterns in reported symptoms
    const patterns = await analyzeSymptomPatterns(req.user._id, dateFilter);
    
    // If no symptoms found, return early
    if (patterns.totalCheckInsWithSymptoms === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No symptom data found for the specified period',
        patterns: {
          totalCheckInsWithSymptoms: 0,
          uniqueSymptomCount: 0,
          daysWithSymptoms: 0
        }
      });
    }
    
    // Add human-readable insights about symptom patterns
    let insights = [];
    
    if (patterns.symptomMetrics && patterns.symptomMetrics.length > 0) {
      // Add insight about most frequent symptom
      const mostFrequent = patterns.symptomMetrics[0];
      insights.push(`Your most frequent symptom is "${mostFrequent.name}" which has occurred on ${mostFrequent.dayCount} days (${mostFrequent.prevalence}% of days with health check-ins).`);
      
      // Add insight about symptom severity if available
      if (mostFrequent.averageSeverity) {
        insights.push(`On average, you rate the severity of "${mostFrequent.name}" as ${mostFrequent.averageSeverity} out of 5.`);
      }
      
      // Add insight about symptom pattern
      const symptomPattern = detectSymptomPattern(mostFrequent.occurrences);
      if (symptomPattern) {
        insights.push(symptomPattern);
      }
      
      // Add insight about co-occurring symptoms if available
      if (patterns.coOccurrenceMetrics && patterns.coOccurrenceMetrics.length > 0) {
        const topCoOccurrence = patterns.coOccurrenceMetrics[0];
        insights.push(`"${topCoOccurrence.symptoms[0]}" and "${topCoOccurrence.symptoms[1]}" frequently occur together (${topCoOccurrence.dayCount} days, ${topCoOccurrence.prevalence}% of symptom days).`);
      }
      
      // Add insight about recent symptoms
      if (patterns.recentSymptomCount > 0) {
        insights.push(`In the past 7 days, you've experienced symptoms on ${patterns.recentDaysWithSymptoms} days with a total of ${patterns.recentSymptomCount} symptom occurrences.`);
      }
    } else {
      insights.push("Not enough symptom data available to analyze patterns.");
    }
    
    // Determine if we should include detailed metrics based on query param
    const responsePatterns = {
      ...patterns,
      insights
    };
    
    // If details aren't requested, remove the detailed arrays
    if (includeDetails !== 'true') {
      if (responsePatterns.symptomMetrics) {
        responsePatterns.symptomMetrics = responsePatterns.symptomMetrics.map(metric => {
          const { occurrences, ...rest } = metric;
          return rest;
        });
      }
      
      if (responsePatterns.coOccurrenceMetrics) {
        // Keep coOccurrenceMetrics but remove any large arrays
        responsePatterns.coOccurrenceMetrics = responsePatterns.coOccurrenceMetrics.map(metric => {
          const { details, ...rest } = metric;
          return rest;
        });
      }
    }
    
    res.status(200).json({
      status: 'success',
      patterns: responsePatterns
    });
  } catch (error) {
    logger.error('Error getting symptom patterns:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get symptom patterns',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to detect patterns in symptom occurrences
function detectSymptomPattern(occurrences) {
  try {
    if (!occurrences || occurrences.length < 3) {
      return null;
    }
    
    // Sort by date
    const sortedOccurrences = [...occurrences].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Check for specific patterns
    
    // Pattern 1: Increasing severity
    let increasingCount = 0;
    for (let i = 1; i < sortedOccurrences.length; i++) {
      if (sortedOccurrences[i].severity > sortedOccurrences[i-1].severity) {
        increasingCount++;
      }
    }
    const increasingPercentage = (increasingCount / (sortedOccurrences.length - 1)) * 100;
    
    // Pattern 2: Decreasing severity
    let decreasingCount = 0;
    for (let i = 1; i < sortedOccurrences.length; i++) {
      if (sortedOccurrences[i].severity < sortedOccurrences[i-1].severity) {
        decreasingCount++;
      }
    }
    const decreasingPercentage = (decreasingCount / (sortedOccurrences.length - 1)) * 100;
    
    // Pattern 3: Time of day pattern (morning, afternoon, evening)
    const timeOfDayMap = {
      morning: 0,
      afternoon: 0,
      evening: 0
    };
    
    sortedOccurrences.forEach(occurrence => {
      const hour = new Date(occurrence.date).getHours();
      if (hour >= 5 && hour < 12) {
        timeOfDayMap.morning++;
      } else if (hour >= 12 && hour < 18) {
        timeOfDayMap.afternoon++;
      } else {
        timeOfDayMap.evening++;
      }
    });
    
    const maxTimeOfDay = Object.entries(timeOfDayMap).sort((a, b) => b[1] - a[1])[0];
    const timeOfDayPercentage = (maxTimeOfDay[1] / sortedOccurrences.length) * 100;
    
    // Determine the most significant pattern
    if (increasingPercentage > 60) {
      return `This symptom has shown an increasing trend in severity over time.`;
    } else if (decreasingPercentage > 60) {
      return `This symptom has shown a decreasing trend in severity over time, which is positive.`;
    } else if (timeOfDayPercentage > 60) {
      return `This symptom tends to occur most frequently in the ${maxTimeOfDay[0]} (${Math.round(timeOfDayPercentage)}% of occurrences).`;
    }
    
    return null;
  } catch (error) {
    logger.error('Error detecting symptom pattern:', error);
    return null;
  }
}

// GET /api/health/lifestyle/trends
exports.getLifestyleTrends = async (req, res) => {
  try {
    const { from, to, factor } = req.query;
    
    // Create date range filter if provided
    const dateFilter = {};
    if (from || to) {
      if (from) dateFilter.from = new Date(from);
      if (to) dateFilter.to = new Date(to);
    }
    
    // Calculate lifestyle trends with date filter
    const lifestyleTrends = await calculateLifestyleTrends(req.user._id, dateFilter);
    
    // Handle case with no data
    if (lifestyleTrends.checkInCount === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No lifestyle data found for the specified period',
        lifestyleTrends: {
          checkInCount: 0
        }
      });
    }
    
    // Generate personalized recommendations based on the data
    const recommendations = generateLifestyleRecommendations(lifestyleTrends);
    
    // If a specific factor is requested, filter the response
    if (factor) {
      const validFactors = ['sleep', 'stress', 'medication', 'water', 'exercise'];
      if (!validFactors.includes(factor)) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid factor parameter. Must be one of: ${validFactors.join(', ')}`
        });
      }
      
      const factorKey = factor === 'sleep' ? 'sleepMetrics' : 
                         factor === 'stress' ? 'stressMetrics' : 
                         factor === 'medication' ? 'medicationMetrics' : 
                         factor === 'water' ? 'waterMetrics' : 
                         'exerciseMetrics';
      
      const factorRecommendations = recommendations.filter(rec => rec.category === factor);
      
      res.status(200).json({
        status: 'success',
        factor,
        metrics: lifestyleTrends[factorKey] || null,
        recommendations: factorRecommendations,
        correlations: lifestyleTrends.correlations ? 
          (lifestyleTrends.correlations.correlations || []).filter(corr => corr.factor.includes(factor)) : []
      });
    } else {
      // Return complete lifestyle trends
      res.status(200).json({
        status: 'success',
        lifestyleTrends: {
          ...lifestyleTrends,
          recommendations
        }
      });
    }
  } catch (error) {
    logger.error('Error getting lifestyle trends:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get lifestyle trends',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to generate lifestyle recommendations
function generateLifestyleRecommendations(lifestyleTrends) {
  const recommendations = [];
  
  // Sleep recommendations
  if (lifestyleTrends.sleepMetrics) {
    const avgSleep = lifestyleTrends.sleepMetrics.averageSleepHours;
    if (avgSleep < 7) {
      recommendations.push({
        category: 'sleep',
        text: `You're averaging ${avgSleep} hours of sleep, which is below the recommended 7-9 hours. Consider going to bed 30 minutes earlier to improve your rest.`,
        priority: 'high'
      });
    } else if (avgSleep > 9) {
      recommendations.push({
        category: 'sleep',
        text: `You're averaging ${avgSleep} hours of sleep. While rest is important, consistently sleeping more than 9 hours might indicate other health patterns worth discussing with your healthcare provider.`,
        priority: 'medium'
      });
    } else {
      recommendations.push({
        category: 'sleep',
        text: `Great job maintaining healthy sleep patterns with an average of ${avgSleep} hours! Consistent sleep schedules help maintain overall wellbeing.`,
        priority: 'low'
      });
    }
  }
  
  // Stress recommendations
  if (lifestyleTrends.stressMetrics) {
    const avgStress = lifestyleTrends.stressMetrics.averageStressLevel;
    if (avgStress > 3) {
      recommendations.push({
        category: 'stress',
        text: `Your recent stress levels have been elevated (${avgStress}/5). Consider incorporating brief mindfulness exercises or short breaks throughout your day.`,
        priority: 'high'
      });
    } else if (avgStress > 2) {
      recommendations.push({
        category: 'stress',
        text: `Your stress levels are moderate (${avgStress}/5). Regular relaxation techniques can help maintain balance in your daily life.`,
        priority: 'medium'
      });
    } else {
      recommendations.push({
        category: 'stress',
        text: `You're managing stress well (${avgStress}/5). Continue the practices that help you maintain this positive balance.`,
        priority: 'low'
      });
    }
  }
  
  // Medication adherence recommendations
  if (lifestyleTrends.medicationMetrics) {
    const adherenceRate = lifestyleTrends.medicationMetrics.adherenceRate;
    if (adherenceRate < 80) {
      recommendations.push({
        category: 'medication',
        text: `Your medication adherence rate is ${adherenceRate}%. Setting reminders or establishing a routine might help improve consistency.`,
        priority: 'high'
      });
    } else if (adherenceRate < 90) {
      recommendations.push({
        category: 'medication',
        text: `Your medication adherence rate is good at ${adherenceRate}%. Look for patterns in the times you miss doses to further improve.`,
        priority: 'medium'
      });
    } else {
      recommendations.push({
        category: 'medication',
        text: `Excellent medication adherence at ${adherenceRate}%! Consistent medication habits contribute significantly to your health management.`,
        priority: 'low'
      });
    }
  }
  
  // Water intake recommendations
  if (lifestyleTrends.waterMetrics) {
    const avgWater = lifestyleTrends.waterMetrics.averageWaterIntake;
    if (avgWater < 6) {
      recommendations.push({
        category: 'water',
        text: `Your water intake (${avgWater} glasses per day) is below recommendations. Try keeping a water bottle visible as a reminder to drink more throughout the day.`,
        priority: 'medium'
      });
    } else {
      recommendations.push({
        category: 'water',
        text: `You're doing well with hydration at ${avgWater} glasses per day. Consistent hydration supports many aspects of health.`,
        priority: 'low'
      });
    }
  }
  
  // Exercise recommendations
  if (lifestyleTrends.exerciseMetrics) {
    const avgExercise = lifestyleTrends.exerciseMetrics.averageExerciseMinutes;
    if (avgExercise < 20) {
      recommendations.push({
        category: 'exercise',
        text: `Adding just a few minutes of light exercise each day, like a short walk, can significantly improve your overall health and mood.`,
        priority: 'medium'
      });
    } else if (avgExercise < 30) {
      recommendations.push({
        category: 'exercise',
        text: `You're averaging ${avgExercise} minutes of exercise. Gradually increasing to 30 minutes on most days would provide additional health benefits.`,
        priority: 'medium'
      });
    } else {
      recommendations.push({
        category: 'exercise',
        text: `Great job maintaining regular exercise at ${avgExercise} minutes per day! Your consistent activity contributes to your overall wellbeing.`,
        priority: 'low'
      });
    }
  }
  
  // Check lifestyle correlations
  if (lifestyleTrends.correlations && lifestyleTrends.correlations.correlations) {
    const strongCorrelations = lifestyleTrends.correlations.correlations.filter(c => 
      Math.abs(c.correlation) > 0.6 && c.sampleSize >= 7
    );
    
    if (strongCorrelations.length > 0) {
      // Focus on the strongest correlation
      const topCorrelation = strongCorrelations[0];
      
      if (topCorrelation.factor === 'sleepHours' && topCorrelation.direction === 'positive') {
        recommendations.push({
          category: 'sleep',
          text: `Your data shows a strong connection between sleep and how you feel. Prioritizing consistent, quality sleep appears to be especially important for your wellbeing.`,
          priority: 'high'
        });
      } else if (topCorrelation.factor === 'stressLevel' && topCorrelation.direction === 'negative') {
        recommendations.push({
          category: 'stress',
          text: `Your data reveals a strong connection between lower stress levels and feeling better. Stress management techniques may be particularly beneficial for your health.`,
          priority: 'high'
        });
      } else if (topCorrelation.factor === 'exerciseMinutes' && topCorrelation.direction === 'positive') {
        recommendations.push({
          category: 'exercise',
          text: `Your data shows a strong link between exercise and improved wellbeing. Even short activity periods appear to positively impact how you feel.`,
          priority: 'high'
        });
      }
    }
  }
  
  return recommendations.sort((a, b) => {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    return priorityRank[a.priority] - priorityRank[b.priority];
  });
}

// GET /api/health/wellness/trends
exports.getWellnessTrends = async (req, res) => {
  try {
    const { from, to, include_details = 'true' } = req.query;
    
    // Create date range filter if provided
    const dateFilter = {};
    if (from || to) {
      if (from) dateFilter.from = new Date(from);
      if (to) dateFilter.to = new Date(to);
    }
    
    // Calculate wellness trends with date filter
    const wellnessTrends = await calculateEnhancedWellnessTrends(req.user._id, dateFilter);
    
    // Handle case with no data
    if (wellnessTrends.checkInCount === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No wellness data found for the specified period',
        wellnessTrends: {
          checkInCount: 0,
          wellnessTrend: 'insufficient_data'
        }
      });
    }
    
    // Generate insights based on the wellness trends
    const insights = generateWellnessInsights(wellnessTrends);
    
    // Prepare response with or without details
    const response = {
      status: 'success',
      wellnessTrends: {
        ...wellnessTrends,
        insights
      }
    };
    
    // Remove detailed data points if not requested
    if (include_details !== 'true') {
      if (response.wellnessTrends.dataPoints) {
        delete response.wellnessTrends.dataPoints;
      }
      
      if (response.wellnessTrends.weeklyAverages) {
        response.wellnessTrends.weeklyAverages = response.wellnessTrends.weeklyAverages.map(week => {
          const { checkInCount, averageScore, distribution } = week;
          return { week: week.week, startDate: week.startDate, checkInCount, averageScore, distribution };
        });
      }
    }
    
    res.status(200).json(response);
  } catch (error) {
    logger.error('Error getting wellness trends:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get wellness trends',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to generate wellness insights
function generateWellnessInsights(wellnessTrends) {
  const insights = [];
  
  // Overall wellness trend insight
  if (wellnessTrends.wellnessTrend === 'improving') {
    insights.push({
      type: 'trend',
      text: 'Your overall wellness trend is improving, which is great to see! Continue with the positive habits that are working for you.'
    });
  } else if (wellnessTrends.wellnessTrend === 'declining') {
    insights.push({
      type: 'trend',
      text: 'Your overall wellness trend shows some decline recently. Consider what factors might be affecting how you feel and what small changes might help.'
    });
  } else if (wellnessTrends.wellnessTrend === 'stable') {
    insights.push({
      type: 'trend',
      text: 'Your overall wellness has been stable recently, showing consistency in how you\'re feeling day to day.'
    });
  }
  
  // Recent trend insight (more specific)
  if (wellnessTrends.recentTrend && typeof wellnessTrends.recentTrend !== 'string') {
    if (wellnessTrends.recentTrend.trend === 'significantly_improving') {
      insights.push({
        type: 'recent',
        text: `You've been feeling notably better in the past week compared to the previous week (${wellnessTrends.recentTrend.percentChange}% improvement).`
      });
    } else if (wellnessTrends.recentTrend.trend === 'slightly_improving') {
      insights.push({
        type: 'recent',
        text: `You've been feeling somewhat better in the past week (${wellnessTrends.recentTrend.percentChange}% improvement).`
      });
    } else if (wellnessTrends.recentTrend.trend === 'significantly_declining') {
      insights.push({
        type: 'recent',
        text: `You've been feeling less well in the past week compared to the previous week. Small self-care steps might help improve how you're feeling.`
      });
    }
  }
  
  // Good day streak insight
  if (wellnessTrends.goodDayStreak && wellnessTrends.goodDayStreak.length > 2) {
    insights.push({
      type: 'streak',
      text: `Your longest streak of consecutive "good" days was ${wellnessTrends.goodDayStreak.length} days. This is valuable information about what consecutive good days look like for you.`
    });
  }
  
  // Feeling distribution insight
  if (wellnessTrends.feelingDistribution) {
    const { good, fair, poor } = wellnessTrends.feelingDistribution;
    
    if (good > 70) {
      insights.push({
        type: 'distribution',
        text: `You're reporting feeling good ${good}% of the time, which is excellent! You're having predominantly positive days.`
      });
    } else if (good + fair > 70) {
      insights.push({
        type: 'distribution',
        text: `You're reporting feeling good or fair ${good + fair}% of the time. Most of your days are neutral to positive.`
      });
    } else if (poor > 40) {
      insights.push({
        type: 'distribution',
        text: `You're reporting feeling poor ${poor}% of the time. Consider discussing these patterns with your healthcare provider to identify potential supports.`
      });
    }
  }
  
  // Weekly pattern insight
  if (wellnessTrends.weeklyAverages && wellnessTrends.weeklyAverages.length >= 2) {
    // Find the best and worst weeks
    const sortedWeeks = [...wellnessTrends.weeklyAverages].sort((a, b) => b.averageScore - a.averageScore);
    const bestWeek = sortedWeeks[0];
    const worstWeek = sortedWeeks[sortedWeeks.length - 1];
    
    // Only provide insight if there's a meaningful difference
    if (bestWeek.averageScore - worstWeek.averageScore > 0.5) {
      insights.push({
        type: 'weekly',
        text: `Your best week started around ${new Date(bestWeek.startDate).toLocaleDateString()}. Reflecting on what was different during this period might reveal helpful patterns.`
      });
    }
  }
  
  return insights;
}

// GET /api/health/health-score
exports.getHealthScore = async (req, res) => {
  try {
    // Get all the data needed to calculate health score
    const latestVitals = await getLatestVitalSigns(req.user._id);
    const wellnessTrends = await calculateEnhancedWellnessTrends(req.user._id);
    const lifestyleTrends = await calculateLifestyleTrends(req.user._id);
    const symptomPatterns = await analyzeSymptomPatterns(req.user._id);
    
    // Calculate the comprehensive health score
    const healthScore = calculateComprehensiveHealthScore(
      latestVitals,
      wellnessTrends,
      lifestyleTrends,
      symptomPatterns
    );
    
    // Generate insights for each score component
    const scoreInsights = generateHealthScoreInsights(healthScore);
    
    // Generate recommendations based on score components
    const recommendations = generateHealthScoreRecommendations(healthScore);
    
    // Prepare the response
    res.status(200).json({
      status: 'success',
      healthScore: {
        ...healthScore,
        insights: scoreInsights,
        recommendations
      },
      lastUpdated: new Date()
    });
  } catch (error) {
    logger.error('Error calculating health score:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to calculate health score',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Extended health score calculation that provides component scores
function calculateComprehensiveHealthScore(latestVitals, wellnessTrends, lifestyleTrends, symptomPatterns) {
  try {
    // Initialize component scores
    const components = {
      vitals: {
        score: 70,
        weight: 0.3,
        normalCount: 0,
        totalCount: 0,
        details: {}
      },
      wellness: {
        score: 70,
        weight: 0.3,
        details: {}
      },
      lifestyle: {
        score: 70,
        weight: 0.3,
        details: {}
      },
      symptoms: {
        score: 70,
        weight: 0.1,
        details: {}
      }
    };
    
    // --- Vitals Component ---
    // Start with a baseline of 70 for vitals
    if (Object.keys(latestVitals).length > 0) {
      // Count normal vs abnormal readings
      Object.entries(latestVitals).forEach(([type, data]) => {
        components.vitals.totalCount++;
        
        if (data.isNormal) {
          components.vitals.normalCount++;
        }
        
        // Add type-specific details
        components.vitals.details[type] = {
          isNormal: data.isNormal,
          timestamp: data.timestamp
        };
      });
      
      // Calculate vitals score based on normal percentage
      if (components.vitals.totalCount > 0) {
        const normalPercentage = (components.vitals.normalCount / components.vitals.totalCount) * 100;
        
        // Scale from 40-100 based on normal percentage
        components.vitals.score = 40 + (normalPercentage * 0.6);
      }
    } else {
      // No vitals data reduces the weight
      components.vitals.weight = 0.1;
      // Redistribute weights
      components.wellness.weight = 0.4;
      components.lifestyle.weight = 0.4;
    }
    
    // --- Wellness Component ---
    if (wellnessTrends && wellnessTrends.checkInCount > 0) {
      // Base wellness score on feeling distribution
      if (wellnessTrends.feelingDistribution) {
        const { good, fair, poor } = wellnessTrends.feelingDistribution;
        
        // Calculate weighted score (good=100, fair=60, poor=20)
        components.wellness.score = (good * 1.0) + (fair * 0.6) + (poor * 0.2);
        components.wellness.details.feelingDistribution = wellnessTrends.feelingDistribution;
      }
      
      // Adjust for wellness trend
      if (wellnessTrends.wellnessTrend === 'improving') {
        components.wellness.score += 5;
      } else if (wellnessTrends.wellnessTrend === 'declining') {
        components.wellness.score -= 5;
      }
      
      components.wellness.details.trend = wellnessTrends.wellnessTrend;
      
      // Adjust for recent trend
      if (wellnessTrends.recentTrend && typeof wellnessTrends.recentTrend !== 'string' && wellnessTrends.recentTrend.percentChange) {
        // Add a small adjustment based on recent trend percentage
        components.wellness.score += wellnessTrends.recentTrend.percentChange * 0.2;
        components.wellness.details.recentTrend = wellnessTrends.recentTrend.trend;
      }
      
      // Cap the wellness score between 0-100
      components.wellness.score = Math.max(0, Math.min(100, components.wellness.score));
    } else {
      // No wellness data reduces the weight
      components.wellness.weight = 0.1;
      // Redistribute weights
      components.vitals.weight = 0.4;
      components.lifestyle.weight = 0.4;
    }
    
    // --- Lifestyle Component ---
    if (lifestyleTrends && (lifestyleTrends.sleepMetrics || lifestyleTrends.stressMetrics || 
                            lifestyleTrends.medicationMetrics || lifestyleTrends.exerciseMetrics)) {
      // Start with baseline score
      let lifestyleScore = 70;
      let factorsCount = 0;
      
      // Add sleep metrics
      if (lifestyleTrends.sleepMetrics) {
        const avgSleep = lifestyleTrends.sleepMetrics.averageSleepHours;
        factorsCount++;
        
        // Optimal sleep (7-9 hours) gets 100
        if (avgSleep >= 7 && avgSleep <= 9) {
          lifestyleScore += 30;
        } 
        // Suboptimal but close (6-7 or 9-10) gets 80
        else if ((avgSleep >= 6 && avgSleep < 7) || (avgSleep > 9 && avgSleep <= 10)) {
          lifestyleScore += 10;
        }
        // Very low or high sleep reduces score
        else if (avgSleep < 5 || avgSleep > 11) {
          lifestyleScore -= 10;
        }
        
        components.lifestyle.details.sleep = {
          averageHours: avgSleep,
          isOptimal: (avgSleep >= 7 && avgSleep <= 9)
        };
      }
      
      // Add stress metrics
      if (lifestyleTrends.stressMetrics) {
        const avgStress = lifestyleTrends.stressMetrics.averageStressLevel;
        factorsCount++;
        
        // Low stress (1-2) gets bonus
        if (avgStress <= 2) {
          lifestyleScore += 20;
        }
        // High stress (4-5) reduces score
        else if (avgStress >= 4) {
          lifestyleScore -= 20;
        }
        
        components.lifestyle.details.stress = {
          averageLevel: avgStress,
          isLow: (avgStress <= 2)
        };
      }
      
      // Add medication adherence
      if (lifestyleTrends.medicationMetrics) {
        const adherenceRate = lifestyleTrends.medicationMetrics.adherenceRate;
        factorsCount++;
        
        // High adherence (>90%) gets bonus
        if (adherenceRate >= 90) {
          lifestyleScore += 20;
        }
        // Medium adherence (70-90%) is neutral
        else if (adherenceRate >= 70) {
          // No adjustment
        }
        // Low adherence (<70%) reduces score
        else {
          lifestyleScore -= 20;
        }
        
        components.lifestyle.details.medicationAdherence = {
          rate: adherenceRate,
          isGood: (adherenceRate >= 90)
        };
      }
      
      // Add exercise metrics
      if (lifestyleTrends.exerciseMetrics) {
        const avgExercise = lifestyleTrends.exerciseMetrics.averageExerciseMinutes;
        factorsCount++;
        
        // Good exercise (>=30 min) gets bonus
        if (avgExercise >= 30) {
          lifestyleScore += 20;
        }
        // Some exercise (10-30 min) gets small bonus
        else if (avgExercise >= 10) {
          lifestyleScore += 10;
        }
        // Little exercise (<10 min) reduces score slightly
        else {
          lifestyleScore -= 10;
        }
        
        components.lifestyle.details.exercise = {
          averageMinutes: avgExercise,
          isSufficient: (avgExercise >= 30)
        };
      }
      
      // Adjust for number of lifestyle factors tracked
      if (factorsCount > 0) {
        // Average the adjustments
        lifestyleScore = 70 + ((lifestyleScore - 70) / factorsCount);
      }
      
      // Cap the lifestyle score between 0-100
      components.lifestyle.score = Math.max(0, Math.min(100, lifestyleScore));
    } else {
      // No lifestyle data reduces the weight
      components.lifestyle.weight = 0.1;
      // Redistribute weights
      components.vitals.weight = 0.4;
      components.wellness.weight = 0.4;
    }
    
    // --- Symptoms Component ---
    if (symptomPatterns && symptomPatterns.uniqueSymptomCount > 0) {
      // Base score of 100, subtract for symptoms
      let symptomsScore = 100;
      
      // Reduce score for recent symptoms (last 7 days)
      if (symptomPatterns.recentSymptomCount > 0) {
        // Each recent symptom reduces score (max reduction of 30)
        const reductionAmount = Math.min(30, symptomPatterns.recentSymptomCount * 5);
        symptomsScore -= reductionAmount;
        
        components.symptoms.details.recentSymptoms = {
          count: symptomPatterns.recentSymptomCount,
          days: symptomPatterns.recentDaysWithSymptoms
        };
      }
      
      // Additional reduction for symptom severity if available
      if (symptomPatterns.symptomMetrics && symptomPatterns.symptomMetrics.length > 0) {
        // Calculate average severity across all symptoms
        let totalSeverity = 0;
        let severityCount = 0;
        
        symptomPatterns.symptomMetrics.forEach(symptom => {
          if (symptom.averageSeverity) {
            totalSeverity += symptom.averageSeverity;
            severityCount++;
          }
        });
        
        if (severityCount > 0) {
          const avgSeverity = totalSeverity / severityCount;
          
          // Reduce score based on severity (1-5 scale, 5 being worst)
          // Reduction from 0-30 points
          const severityReduction = Math.min(30, avgSeverity * 6);
          symptomsScore -= severityReduction;
          
          components.symptoms.details.averageSeverity = avgSeverity;
        }
      }
      
      // Cap the symptoms score between 0-100
      components.symptoms.score = Math.max(0, Math.min(100, symptomsScore));
    } else {
      // No symptoms is positive
      components.symptoms.score = 100;
      components.symptoms.details.noSymptoms = true;
    }
    
    // Calculate weighted total score
    const totalScore = Math.round(
      (components.vitals.score * components.vitals.weight) +
      (components.wellness.score * components.wellness.weight) +
      (components.lifestyle.score * components.lifestyle.weight) +
      (components.symptoms.score * components.symptoms.weight)
    );
    
    // Determine health status based on score
    let status;
    if (totalScore >= 85) {
      status = 'excellent';
    } else if (totalScore >= 70) {
      status = 'good';
    } else if (totalScore >= 50) {
      status = 'fair';
    } else {
      status = 'needs_attention';
    }
    
    return {
      score: totalScore,
      status,
      maxScore: 100,
      components
    };
  } catch (error) {
    logger.error('Error calculating comprehensive health score:', error);
    return {
      score: 50,
      status: 'unknown',
      maxScore: 100,
      components: {}
    };
  }
}

// Generate insights for health score components
function generateHealthScoreInsights(healthScore) {
  const insights = [];
  
  // Overall score insight
  if (healthScore.status === 'excellent') {
    insights.push({
      type: 'overall',
      text: 'Your overall health score is excellent! You\'re doing a great job managing multiple aspects of your health.'
    });
  } else if (healthScore.status === 'good') {
    insights.push({
      type: 'overall',
      text: 'Your overall health score is good. You\'re maintaining positive health habits in many areas.'
    });
  } else if (healthScore.status === 'fair') {
    insights.push({
      type: 'overall',
      text: 'Your overall health score is fair. There are some areas where small changes could potentially improve your wellbeing.'
    });
  } else if (healthScore.status === 'needs_attention') {
    insights.push({
      type: 'overall',
      text: 'Your health score indicates some areas that may benefit from attention. The recommendations below might help identify specific steps to consider.'
    });
  }
  
  // Component-specific insights
  const { components } = healthScore;
  
  // Vitals insight
  if (components.vitals && components.vitals.totalCount > 0) {
    const normalPercentage = Math.round((components.vitals.normalCount / components.vitals.totalCount) * 100);
    
    if (normalPercentage >= 90) {
      insights.push({
        type: 'vitals',
        text: `${normalPercentage}% of your vital signs are within normal ranges, which is excellent.`
      });
    } else if (normalPercentage >= 70) {
      insights.push({
        type: 'vitals',
        text: `${normalPercentage}% of your vital signs are within normal ranges. Continued tracking helps identify patterns over time.`
      });
    } else {
      insights.push({
        type: 'vitals',
        text: `${normalPercentage}% of your vital signs are within normal ranges. Regular tracking helps you and your healthcare provider monitor these values.`
      });
    }
  }
  
  // Wellness insight
  if (components.wellness && components.wellness.details.feelingDistribution) {
    const { good } = components.wellness.details.feelingDistribution;
    
    if (good >= 70) {
      insights.push({
        type: 'wellness',
        text: `You're reporting feeling good ${good}% of the time, which is excellent for your overall wellbeing.`
      });
    } else if (good >= 50) {
      insights.push({
        type: 'wellness',
        text: `You're reporting feeling good ${good}% of the time. Your check-ins help identify what factors contribute to your better days.`
      });
    } else {
      insights.push({
        type: 'wellness',
        text: `You're reporting feeling good ${good}% of the time. Tracking how you feel helps identify patterns that may affect your wellbeing.`
      });
    }
  }
  
  // Lifestyle insight - focus on strongest and weakest factors
  if (components.lifestyle) {
    // Find highest and lowest scoring lifestyle factors
    const factors = [];
    
    if (components.lifestyle.details.sleep) {
      factors.push({
        name: 'sleep',
        score: components.lifestyle.details.sleep.isOptimal ? 100 : 
               (components.lifestyle.details.sleep.averageHours >= 6 ? 70 : 40),
        text: components.lifestyle.details.sleep.isOptimal ? 
              'Your sleep patterns are in the optimal range' : 
              `You're averaging ${components.lifestyle.details.sleep.averageHours} hours of sleep`
      });
    }
    
    if (components.lifestyle.details.stress) {
      factors.push({
        name: 'stress',
        score: components.lifestyle.details.stress.isLow ? 100 : 
               (components.lifestyle.details.stress.averageLevel <= 3 ? 70 : 40),
        text: components.lifestyle.details.stress.isLow ? 
              'Your stress levels are consistently low' : 
              `Your average stress level is ${components.lifestyle.details.stress.averageLevel}/5`
      });
    }
    
    if (components.lifestyle.details.medicationAdherence) {
      factors.push({
        name: 'medication adherence',
        score: components.lifestyle.details.medicationAdherence.isGood ? 100 : 
               (components.lifestyle.details.medicationAdherence.rate >= 70 ? 70 : 40),
        text: components.lifestyle.details.medicationAdherence.isGood ? 
              'Your medication adherence is excellent' : 
              `Your medication adherence rate is ${components.lifestyle.details.medicationAdherence.rate}%`
      });
    }
    
    if (components.lifestyle.details.exercise) {
      factors.push({
        name: 'exercise',
        score: components.lifestyle.details.exercise.isSufficient ? 100 : 
               (components.lifestyle.details.exercise.averageMinutes >= 10 ? 70 : 40),
        text: components.lifestyle.details.exercise.isSufficient ? 
              'Your regular exercise habits are beneficial' : 
              `You're averaging ${components.lifestyle.details.exercise.averageMinutes} minutes of exercise`
      });
    }
    
    // Sort factors by score
    factors.sort((a, b) => b.score - a.score);
    
    // Provide insight on strongest factor if available
    if (factors.length > 0 && factors[0].score >= 70) {
      insights.push({
        type: 'lifestyle',
        text: `Strength: ${factors[0].text}, which positively contributes to your overall health.`
      });
    }
    
    // Provide insight on weakest factor if it needs improvement
    if (factors.length > 1 && factors[factors.length - 1].score < 70) {
      insights.push({
        type: 'lifestyle',
        text: `Opportunity: ${factors[factors.length - 1].text}, which may be an area to consider for small improvements.`
      });
    }
  }
  
  // Symptoms insight
  if (components.symptoms) {
    if (components.symptoms.details.noSymptoms) {
      insights.push({
        type: 'symptoms',
        text: 'You haven\'t reported any symptoms recently, which positively affects your overall wellbeing.'
      });
    } else if (components.symptoms.details.recentSymptoms) {
      const { count, days } = components.symptoms.details.recentSymptoms;
      
      if (count <= 2 && days <= 2) {
        insights.push({
          type: 'symptoms',
          text: `You've experienced minimal symptoms recently (${count} symptom occurrences over ${days} days).`
        });
      } else {
        insights.push({
          type: 'symptoms',
          text: `You've experienced symptoms on ${days} days recently. Tracking these patterns helps identify potential triggers or patterns.`
        });
      }
    }
  }
  
  return insights;
}

// Generate recommendations based on health score components
function generateHealthScoreRecommendations(healthScore) {
  const recommendations = [];
  const { components } = healthScore;
  
  // Vitals recommendations
  if (components.vitals && components.vitals.totalCount > 0) {
    const normalPercentage = Math.round((components.vitals.normalCount / components.vitals.totalCount) * 100);
    
    if (normalPercentage < 70) {
      // Check which vital signs were abnormal
      const abnormalVitals = [];
      
      Object.entries(components.vitals.details).forEach(([type, details]) => {
        if (!details.isNormal) {
          abnormalVitals.push(type);
        }
      });
      
      if (abnormalVitals.length > 0) {
        recommendations.push({
          category: 'vitals',
          text: `Consider discussing your ${abnormalVitals.join(', ')} readings with your healthcare provider during your next visit.`,
          priority: 'medium'
        });
      }
    }
    
    // If few vital signs recorded
    if (components.vitals.totalCount < 3) {
      recommendations.push({
        category: 'vitals',
        text: 'Regular monitoring of key vital signs provides valuable insights into your physical health. Consider tracking additional vital signs regularly.',
        priority: 'low'
      });
    }
  }
  
  // Wellness recommendations
  if (components.wellness && components.wellness.details.feelingDistribution) {
    const { good, poor } = components.wellness.details.feelingDistribution;
    
    if (poor > 30) {
      recommendations.push({
        category: 'wellness',
        text: 'You\'re reporting feeling poor on many days. Consider reflecting on what factors might be affecting how you feel and what small changes might help.',
        priority: 'high'
      });
    }
    
    if (good < 50) {
      recommendations.push({
        category: 'wellness',
        text: 'Try to identify patterns on days when you feel better. What activities, sleep patterns, or other factors might be contributing to those good days?',
        priority: 'medium'
      });
    }
  }
  
  // Lifestyle-specific recommendations
  if (components.lifestyle) {
    // Sleep recommendations
    if (components.lifestyle.details.sleep) {
      const avgSleep = components.lifestyle.details.sleep.averageHours;
      
      if (avgSleep < 6) {
        recommendations.push({
          category: 'sleep',
          text: `You're averaging ${avgSleep} hours of sleep, which is below recommendations. Consider setting a consistent bedtime routine and gradually increasing sleep duration.`,
          priority: 'high'
        });
      } else if (avgSleep < 7) {
        recommendations.push({
          category: 'sleep',
          text: `You're averaging ${avgSleep} hours of sleep. Increasing sleep time by just 30 minutes could help you reach the recommended 7-9 hours.`,
          priority: 'medium'
        });
      }
    }
    
    // Stress recommendations
    if (components.lifestyle.details.stress) {
      const avgStress = components.lifestyle.details.stress.averageLevel;
      
      if (avgStress > 3) {
        recommendations.push({
          category: 'stress',
          text: 'Your stress levels are elevated. Simple stress management techniques like deep breathing, short walks, or brief mindfulness exercises might be helpful.',
          priority: 'high'
        });
      }
    }
    
    // Medication adherence recommendations
    if (components.lifestyle.details.medicationAdherence) {
      const adherenceRate = components.lifestyle.details.medicationAdherence.rate;
      
      if (adherenceRate < 70) {
        recommendations.push({
          category: 'medication',
          text: 'Your medication adherence could be improved. Setting regular reminders or associating medication with a daily routine can help.',
          priority: 'high'
        });
      } else if (adherenceRate < 90) {
        recommendations.push({
          category: 'medication',
          text: 'Your medication adherence is good but could be better. Consider what factors might be causing occasional missed doses.',
          priority: 'medium'
        });
      }
    }
    
    // Exercise recommendations
    if (components.lifestyle.details.exercise) {
      const avgExercise = components.lifestyle.details.exercise.averageMinutes;
      
      if (avgExercise < 10) {
        recommendations.push({
          category: 'exercise',
          text: 'Even a few minutes of light physical activity can provide health benefits. Consider short, gentle activities like brief walks or simple stretching.',
          priority: 'medium'
        });
      } else if (avgExercise < 30) {
        recommendations.push({
          category: 'exercise',
          text: `You're getting some activity with ${avgExercise} minutes of exercise. Gradually increasing this time could provide additional health benefits.`,
          priority: 'low'
        });
      }
    }
  }
  
  // Symptom recommendations
  if (components.symptoms && components.symptoms.details.recentSymptoms) {
    const { count, days } = components.symptoms.details.recentSymptoms;
    
    if (count > 5 && days > 3) {
      recommendations.push({
        category: 'symptoms',
        text: 'You\'ve been experiencing frequent symptoms recently. Consider tracking any patterns in when they occur and what might trigger them.',
        priority: 'high'
      });
    }
    
    if (components.symptoms.details.averageSeverity && components.symptoms.details.averageSeverity > 3) {
      recommendations.push({
        category: 'symptoms',
        text: 'You\'re experiencing symptoms with moderate to high severity. Consider discussing these with your healthcare provider if they persist.',
        priority: 'high'
      });
    }
  }
  
  // Sort recommendations by priority
  return recommendations.sort((a, b) => {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    return priorityRank[a.priority] - priorityRank[b.priority];
  });
}

module.exports = exports;