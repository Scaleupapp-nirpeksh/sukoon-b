const { VitalSign, HealthCheckIn } = require('../models/healthModel');

// Record vital sign
exports.recordVitalSign = async (req, res) => {
  try {
    const {
      type,
      values,
      unit,
      notes
    } = req.body;
    
    // Validate required fields
    if (!type || !values) {
      return res.status(400).json({
        status: 'error',
        message: 'Type and values are required',
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
      // Basic check if reading is normal (this would be more sophisticated in production)
      isNormal: checkIfNormal(type, values),
      timestamp: new Date()
    });
    
    await vitalSign.save();
    
    res.status(201).json({
      status: 'success',
      message: 'Vital sign recorded successfully',
      vitalSign
    });
  } catch (error) {
    console.error('Error recording vital sign:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to record vital sign',
    });
  }
};

// Get user vital signs
exports.getUserVitalSigns = async (req, res) => {
  try {
    const { type, from, to } = req.query;
    
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
    
    const vitalSigns = await VitalSign.find(query).sort({ timestamp: -1 });
    
    res.status(200).json({
      status: 'success',
      count: vitalSigns.length,
      vitalSigns
    });
  } catch (error) {
    console.error('Error getting vital signs:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get vital signs',
    });
  }
};

// Submit health check-in
exports.submitHealthCheckIn = async (req, res) => {
  try {
    const {
      feeling,
      symptoms,
      notes
    } = req.body;
    
    // Validate required fields
    if (!feeling) {
      return res.status(400).json({
        status: 'error',
        message: 'Feeling is required',
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
    
    // Basic AI assessment (would be more sophisticated in production)
    if (feeling === 'poor' || (symptoms && symptoms.length > 0)) {
      healthCheckIn.aiAssessment = {
        riskLevel: feeling === 'poor' ? 'medium' : 'low',
        recommendations: ['Stay hydrated', 'Rest adequately'],
        followUpRequired: feeling === 'poor'
      };
    }
    
    await healthCheckIn.save();
    
    res.status(201).json({
      status: 'success',
      message: 'Health check-in submitted successfully',
      healthCheckIn
    });
  } catch (error) {
    // Continue from healthController.js
    console.error('Error submitting health check-in:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to submit health check-in',
    });
  }
};

// Get user health check-ins
exports.getUserHealthCheckIns = async (req, res) => {
  try {
    const { from, to } = req.query;
    
    let query = { userId: req.user._id };
    
    // Add date range filter if provided
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }
    
    const healthCheckIns = await HealthCheckIn.find(query).sort({ createdAt: -1 });
    
    res.status(200).json({
      status: 'success',
      count: healthCheckIns.length,
      healthCheckIns
    });
  } catch (error) {
    console.error('Error getting health check-ins:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get health check-ins',
    });
  }
};

// Helper function to check if vital signs are within normal range
// This is a simplified version - in production this would be more sophisticated
function checkIfNormal(type, values) {
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
    default:
      return true;
  }
}