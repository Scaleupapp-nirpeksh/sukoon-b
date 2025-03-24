const { VitalSign, HealthCheckIn } = require('../models/healthModel');
const { Configuration, OpenAIApi } = require('openai');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const OpenAI = require('openai');

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
    
    // Create new vital sign record
    const vitalSign = new VitalSign({
      userId: req.user._id,
      type,
      values,
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
      aiAnalysis = await generateAIHealthInsight(type, values, req.user);
      
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

// Get user vital signs with pagination and filtering
exports.getUserVitalSigns = async (req, res) => {
  try {
    const { type, from, to, page = 1, limit = 10 } = req.query;
    
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
    
    // Calculate trend data for each type
    const trendData = await calculateTrends(req.user._id);
    
    res.status(200).json({
      status: 'success',
      count: vitalSigns.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      vitalSigns,
      trends: trendData
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

// Submit health check-in with AI assessment
exports.submitHealthCheckIn = async (req, res) => {
  try {
    const { feeling, symptoms, notes } = req.body;
    
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
    
    // Create new health check-in
    const healthCheckIn = new HealthCheckIn({
      userId: req.user._id,
      feeling,
      symptoms: symptoms || [],
      notes,
      recordedBy: req.user._id
    });
    
    // Get AI assessment if feeling is poor or symptoms are present
    if (feeling === 'poor' || (symptoms && symptoms.length > 0)) {
      const aiAssessment = await generateAIHealthAssessment(feeling, symptoms, req.user);
      
      healthCheckIn.aiAssessment = {
        riskLevel: aiAssessment.riskLevel,
        recommendations: aiAssessment.recommendations,
        followUpRequired: aiAssessment.followUpRequired
      };
    } else {
      // Default assessment for good feeling with no symptoms
      healthCheckIn.aiAssessment = {
        riskLevel: 'low',
        recommendations: ['Maintain your healthy routine', 'Stay hydrated'],
        followUpRequired: false
      };
    }
    
    await healthCheckIn.save();
    
    // If high risk, trigger notification (implementation dependent on your notification system)
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
      healthCheckIn
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

// Get user health check-ins with pagination
exports.getUserHealthCheckIns = async (req, res) => {
  try {
    const { from, to, page = 1, limit = 10 } = req.query;
    
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
    
    // Get wellness trends
    const wellnessTrends = await calculateWellnessTrends(req.user._id);
    
    res.status(200).json({
      status: 'success',
      count: healthCheckIns.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      healthCheckIns,
      wellnessTrends
    });
  } catch (error) {
    logger.error('Error getting health check-ins:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get health check-ins',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get health analytics/dashboard data
exports.getHealthDashboard = async (req, res) => {
  try {
    // Get latest vital signs (one of each type)
    const latestVitals = await getLatestVitalSigns(req.user._id);
    
    // Get latest health check-in
    const latestCheckIn = await HealthCheckIn.findOne(
      { userId: req.user._id }
    ).sort({ createdAt: -1 });
    
    // Get health trends
    const vitalTrends = await calculateTrends(req.user._id);
    const wellnessTrends = await calculateWellnessTrends(req.user._id);
    
    // Get health insights using AI
    const healthInsights = await generateHealthDashboardInsights(
      req.user._id, 
      latestVitals, 
      latestCheckIn,
      vitalTrends,
      wellnessTrends
    );
    
    res.status(200).json({
      status: 'success',
      dashboard: {
        latestVitals,
        latestCheckIn,
        vitalTrends,
        wellnessTrends,
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

// Generate AI health insight for abnormal readings
async function generateAIHealthInsight(type, values, user) {
  try {
    // Skip AI processing in development mode to save API calls
    if (process.env.NODE_ENV === 'development') {
      return {
        insights: [
          "This is a simulated AI insight in development mode.",
          "Please consult with a healthcare professional about your abnormal reading."
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
    
    // Call OpenAI for health insights
    const prompt = `As a healthcare assistant, provide 3 brief, helpful insights about a patient with a ${readingDescription}. This reading is outside normal range. Also, determine if follow-up with a healthcare provider is recommended (true/false). Format response as JSON: {"insights": ["insight1", "insight2", "insight3"], "followupRequired": boolean}`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a healthcare assistant providing brief insights." },
        { role: "user", content: prompt }
      ],
      max_tokens: 250,
      temperature: 0.3
    });
    
    // Parse the response
    const response = JSON.parse(completion.choices[0].message.content.trim());
    
    return {
      insights: response.insights,
      followupRequired: response.followupRequired
    };
  } catch (error) {
    logger.error('Error generating AI health insight:', error);
    // Fallback insights in case of API error
    return {
      insights: [
        "Your reading is outside the normal range.",
        "Consider consulting with a healthcare professional.",
        "Monitor this vital sign more frequently in the coming days."
      ],
      followupRequired: true
    };
  }
}

// Generate AI health assessment for check-ins
async function generateAIHealthAssessment(feeling, symptoms, user) {
  try {
    // Skip AI processing in development mode
    if (process.env.NODE_ENV === 'development') {
      let riskLevel = 'low';
      if (feeling === 'poor') riskLevel = 'medium';
      if (symptoms && symptoms.length > 2) riskLevel = 'high';
      
      return {
        riskLevel,
        recommendations: [
          "This is a simulated AI recommendation in development mode.",
          "Ensure you're drinking enough water and getting adequate rest."
        ],
        followUpRequired: riskLevel === 'high'
      };
    }
    
    // Prepare symptoms description
    const symptomsDescription = symptoms && symptoms.length > 0 
      ? symptoms.map(s => `${s.name} (severity: ${s.severity}/5)`).join(', ')
      : 'no specific symptoms';
    
    // Call OpenAI for health assessment
    const prompt = `As a healthcare assistant, assess a patient who reports feeling ${feeling} with ${symptomsDescription}. Determine risk level (low, medium, high) and provide 2-3 health recommendations. Format response as JSON: {"riskLevel": string, "recommendations": [string], "followUpRequired": boolean}`;
    
    const completion = await openai.createCompletion({
      model: "text-davinci-003",  // Or your preferred model
      prompt: prompt,
      max_tokens: 250,
      temperature: 0.3
    });
    
    // Parse the response
    const response = JSON.parse(completion.data.choices[0].text.trim());
    
    return {
      riskLevel: response.riskLevel,
      recommendations: response.recommendations,
      followUpRequired: response.followUpRequired
    };
  } catch (error) {
    logger.error('Error generating AI health assessment:', error);
    // Fallback assessment in case of API error
    let riskLevel = 'low';
    if (feeling === 'poor') riskLevel = 'medium';
    if (symptoms && symptoms.length > 2) riskLevel = 'high';
    
    return {
      riskLevel,
      recommendations: [
        "Stay hydrated and get adequate rest.",
        "Monitor your symptoms and contact a healthcare provider if they worsen."
      ],
      followUpRequired: riskLevel === 'high'
    };
  }
}

// Calculate health trends
async function calculateTrends(userId) {
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
              isNormal: "$isNormal"
            } 
          },
          normalCount: { $sum: { $cond: ["$isNormal", 1, 0] } },
          abnormalCount: { $sum: { $cond: ["$isNormal", 0, 1] } }
        }
      }
    ]);
    
    // Calculate trend direction and percentage for each type
    const processedTrends = {};
    
    trendData.forEach(item => {
      const type = item._id;
      const readings = item.readings;
      
      if (readings.length > 1) {
        // Get first and last readings for comparison
        const firstReading = readings[0];
        const lastReading = readings[readings.length - 1];
        
        let trendDirection;
        let changePercentage;
        
        // Calculate trend based on type
        switch(type) {
          case 'bloodPressure':
            const firstSystolic = firstReading.values.systolic;
            const lastSystolic = lastReading.values.systolic;
            trendDirection = lastSystolic > firstSystolic ? 'increasing' : 
                             lastSystolic < firstSystolic ? 'decreasing' : 'stable';
            changePercentage = Math.abs(((lastSystolic - firstSystolic) / firstSystolic) * 100).toFixed(1);
            break;
          case 'glucose':
            const firstGlucose = firstReading.values.glucoseLevel;
            const lastGlucose = lastReading.values.glucoseLevel;
            trendDirection = lastGlucose > firstGlucose ? 'increasing' : 
                             lastGlucose < firstGlucose ? 'decreasing' : 'stable';
            changePercentage = Math.abs(((lastGlucose - firstGlucose) / firstGlucose) * 100).toFixed(1);
            break;
          // Add similar calculations for other types
          default:
            trendDirection = 'stable';
            changePercentage = 0;
        }
        
        processedTrends[type] = {
          readings: readings.length,
          normalCount: item.normalCount,
          abnormalCount: item.abnormalCount,
          trendDirection,
          changePercentage,
          dataPoints: readings.map(r => ({
            timestamp: r.timestamp,
            values: r.values,
            isNormal: r.isNormal
          }))
        };
      } else if (readings.length === 1) {
        // Not enough data for trend
        processedTrends[type] = {
          readings: 1,
          normalCount: item.normalCount,
          abnormalCount: item.abnormalCount,
          trendDirection: 'insufficient_data',
          changePercentage: 0,
          dataPoints: readings.map(r => ({
            timestamp: r.timestamp,
            values: r.values,
            isNormal: r.isNormal
          }))
        };
      }
    });
    
    return processedTrends;
  } catch (error) {
    logger.error('Error calculating health trends:', error);
    return {};
  }
}

// Calculate wellness trends from health check-ins
async function calculateWellnessTrends(userId) {
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
              aiAssessment: "$aiAssessment"
            } 
          },
          goodCount: { $sum: { $cond: [{ $eq: ["$feeling", "good"] }, 1, 0] } },
          fairCount: { $sum: { $cond: [{ $eq: ["$feeling", "fair"] }, 1, 0] } },
          poorCount: { $sum: { $cond: [{ $eq: ["$feeling", "poor"] }, 1, 0] } },
          totalCount: { $sum: 1 }
        }
      }
    ]);
    
    if (checkInData.length === 0) {
      return {
        checkInCount: 0,
        wellnessTrend: 'insufficient_data',
        feelingDistribution: { good: 0, fair: 0, poor: 0 },
        dataPoints: []
      };
    }
    
    const data = checkInData[0];
    
    // Calculate wellness trend
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
    
    // Extract data points for chart display
    const dataPoints = data.checkIns.map(c => ({
      date: c.createdAt,
      feeling: c.feeling,
      hasSymptoms: c.symptoms && c.symptoms.length > 0
    }));
    
    return {
      checkInCount: data.totalCount,
      wellnessTrend,
      feelingDistribution,
      dataPoints
    };
  } catch (error) {
    logger.error('Error calculating wellness trends:', error);
    return {
      checkInCount: 0,
      wellnessTrend: 'error',
      feelingDistribution: { good: 0, fair: 0, poor: 0 },
      dataPoints: []
    };
  }
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
          latestReading: { $first: "$$ROOT" }
        }
      }
    ]);
    
    // Format the results
    const formattedVitals = {};
    latestVitals.forEach(item => {
      formattedVitals[item._id] = {
        timestamp: item.latestReading.timestamp,
        values: item.latestReading.values,
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

// Generate health dashboard insights using AI
async function generateHealthDashboardInsights(userId, latestVitals, latestCheckIn, vitalTrends, wellnessTrends) {
  try {
    // Skip AI processing in development mode
    if (process.env.NODE_ENV === 'development') {
      return [
        "This is a simulated AI health insight in development mode.",
        "Regular monitoring of your vital signs contributes to better health awareness.",
        "Continue your health check-ins to track your wellness over time."
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
      `Last health check-in: feeling ${latestCheckIn.feeling} with ${latestCheckIn.symptoms.length} symptoms` : 
      'No recent health check-ins';
    
    const wellnessSummary = wellnessTrends.wellnessTrend !== 'insufficient_data' ? 
      `Wellness trend: ${wellnessTrends.wellnessTrend} (${wellnessTrends.feelingDistribution.good}% good days)` :
      'Insufficient data for wellness trend';
    
    // Call OpenAI for dashboard insights
    const prompt = `As a healthcare assistant, provide 3 brief, personalized health insights based on this data summary:
      ${vitalSummary}
      ${feelingSummary}
      ${wellnessSummary}
      Keep insights concise, actionable, and encouraging. Format as JSON array of strings.`;
    
    const completion = await openai.createCompletion({
      model: "text-davinci-003",  // Or your preferred model
      prompt: prompt,
      max_tokens: 250,
      temperature: 0.5
    });
    
    // Parse the response
    const insights = JSON.parse(completion.data.choices[0].text.trim());
    
    return insights;
  } catch (error) {
    logger.error('Error generating dashboard insights:', error);
    // Fallback insights in case of API error
    return [
      "Regular monitoring of your health metrics helps you stay proactive about your wellness.",
      "Consider discussing any abnormal readings with your healthcare provider.",
      "Maintaining consistent health check-ins gives you better insight into your wellness trends."
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
    
    return true;
  } catch (error) {
    logger.error('Error triggering caregiver notification:', error);
    return false;
  }
}