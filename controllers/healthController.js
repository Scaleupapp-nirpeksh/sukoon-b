const { VitalSign, HealthCheckIn, FollowUp } = require('../models/healthModel');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const OpenAI = require('openai');
const { sendPushNotification } = require('../services/notificationService');

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
    
    // Get health insights using AI
    const healthInsights = await generateHealthDashboardInsights(
      req.user._id, 
      latestVitals, 
      latestCheckIn,
      vitalTrends,
      wellnessTrends,
      lifestyleTrends,
      symptomPatterns
    );
    
    // Calculate health score
    const healthScore = calculateHealthScore(
      latestVitals,
      wellnessTrends,
      lifestyleTrends,
      symptomPatterns
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
        insights: healthInsights
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
function calculateHealthScore(latestVitals, wellnessTrends, lifestyleTrends, symptomPatterns) {
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
async function generateHealthDashboardInsights(userId, latestVitals, latestCheckIn, vitalTrends, wellnessTrends, lifestyleTrends, symptomPatterns) {
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
    
    // Call OpenAI for dashboard insights with a reassuring tone
    const prompt = `As a compassionate healthcare assistant, provide 3 personalized, reassuring health insights based on this data summary:
      ${vitalSummary}
      ${feelingSummary}
      ${wellnessSummary}
      ${lifestyleSummary}
      ${symptomSummary}
      
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
    const insights = JSON.parse(completion.choices[0].message.content.trim());
    
    return insights;
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

module.exports = exports;