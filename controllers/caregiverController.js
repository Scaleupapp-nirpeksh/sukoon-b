// controllers/caregiverController.js
const mongoose = require('mongoose');
const User = require('../models/userModel');
const CaregiverRelationship = require('../models/CaregiverRelationship');
const Medication = require('../models/medicationModel');
const MedicationLog = require('../models/MedicationLog');
const { VitalSign, HealthCheckIn } = require('../models/healthModel');
const CaregiverReport = require('../models/CaregiverReport');
const logger = require('../utils/logger');

// Send caregiver invitation (existing function enhanced)
exports.sendCaregiverInvitation = async (req, res) => {
  try {
    const { phoneNumber, relationship, permissions, notes } = req.body;
    
    // Validate required fields
    if (!phoneNumber || !relationship) {
      return res.status(400).json({
        status: 'error',
        message: 'Phone number and relationship are required',
      });
    }
    
    // Check if caregiver exists
    const caregiver = await User.findOne({ phoneNumber });
    
    if (!caregiver) {
      return res.status(404).json({
        status: 'error',
        message: 'User with this phone number not found',
      });
    }
    
    // Check if this relationship already exists
    const existingRelationship = await CaregiverRelationship.findOne({
      caregiverId: caregiver._id,
      patientId: req.user._id
    });
    
    if (existingRelationship) {
      return res.status(400).json({
        status: 'error',
        message: 'This caregiver relationship already exists',
        relationshipStatus: existingRelationship.status
      });
    }
    
    // Create the caregiver relationship
    const caregiverRelationship = new CaregiverRelationship({
      caregiverId: caregiver._id,
      patientId: req.user._id,
      relationship,
      status: 'pending',
      invitedBy: req.user._id,
      notes,
      permissions: permissions || undefined
    });
    
    await caregiverRelationship.save();
    
    // TODO: Send notification to caregiver
    
    res.status(201).json({
      status: 'success',
      message: 'Caregiver invitation sent successfully',
      caregiverInfo: {
        _id: caregiver._id,
        fullName: caregiver.fullName,
        phoneNumber: caregiver.phoneNumber,
        relationship,
        status: 'pending'
      }
    });
  } catch (error) {
    logger.error('Error sending caregiver invitation:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send caregiver invitation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all caregivers for the logged-in patient
exports.getCaregivers = async (req, res) => {
  try {
    // Find active caregiver relationships where the current user is the patient
    const relationships = await CaregiverRelationship.find({
      patientId: req.user._id,
      status: 'active'
    }).populate('caregiverId', 'fullName phoneNumber email'); // Adjust fields as necessary

    if (!relationships || relationships.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No caregivers found',
        caregivers: []
      });
    }

    // Map the relationships to extract caregiver details and relationship info
    const caregivers = relationships.map(rel => ({
      relationshipId: rel._id,
      caregiver: rel.caregiverId,
      relationship: rel.relationship,
      status: rel.status,
      permissions: rel.permissions,
      notificationPreferences: rel.notificationPreferences,
      invitedBy: rel.invitedBy,
      invitationAcceptedAt: rel.invitationAcceptedAt,
      notes: rel.notes
    }));

    res.status(200).json({
      status: 'success',
      caregivers
    });
  } catch (error) {
    logger.error('Error fetching caregivers:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch caregivers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Accept or reject caregiver invitation
exports.respondToInvitation = async (req, res) => {
  try {
    const { action } = req.body;
    const relationshipId = req.params.id;
    
    if (!action || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        status: 'error',
        message: 'Action must be either "accept" or "reject"'
      });
    }
    
    // Find the relationship
    const relationship = await CaregiverRelationship.findOne({
      _id: relationshipId,
      caregiverId: req.user._id,
      status: 'pending'
    });
    
    if (!relationship) {
      return res.status(404).json({
        status: 'error',
        message: 'Invitation not found or already processed'
      });
    }
    
    // Update relationship status
    relationship.status = action === 'accept' ? 'active' : 'rejected';
    
    if (action === 'accept') {
      relationship.invitationAcceptedAt = new Date();
    }
    
    await relationship.save();
    
    // Get patient details
    const patient = await User.findById(relationship.patientId);
    
    res.status(200).json({
      status: 'success',
      message: `Invitation ${action === 'accept' ? 'accepted' : 'rejected'} successfully`,
      relationship: {
        _id: relationship._id,
        status: relationship.status,
        patient: {
          _id: patient._id,
          fullName: patient.fullName
        }
      }
    });
  } catch (error) {
    logger.error('Error responding to caregiver invitation:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process invitation response',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get caregiver patients
exports.getCaregiverPatients = async (req, res) => {
  try {
    // Find active relationships where user is caregiver
    const relationships = await CaregiverRelationship.find({
      caregiverId: req.user._id,
      status: 'active'
    });
    
    if (relationships.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'You are not currently a caregiver for any patients',
        patients: []
      });
    }
    
    // Get patient details for each relationship
    const patientIds = relationships.map(r => r.patientId);
    const patients = await User.find({ _id: { $in: patientIds } });
    
    // Combine relationship data with patient details
    const patientData = relationships.map(relationship => {
      const patient = patients.find(p => p._id.toString() === relationship.patientId.toString());
      return {
        relationshipId: relationship._id,
        relationship: relationship.relationship,
        permissions: relationship.permissions,
        patient: {
          _id: patient._id,
          fullName: patient.fullName,
          gender: patient.gender,
          dateOfBirth: patient.dateOfBirth,
          phoneNumber: patient.phoneNumber
        }
      };
    });
    
    res.status(200).json({
      status: 'success',
      count: patientData.length,
      patients: patientData
    });
  } catch (error) {
    logger.error('Error getting caregiver patients:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get patients',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get patient dashboard data as caregiver
exports.getPatientDashboard = async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Verify caregiver relationship and permissions
    const relationship = await CaregiverRelationship.findOne({
      caregiverId: req.user._id,
      patientId,
      status: 'active'
    });
    
    if (!relationship) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to view this patient\'s data'
      });
    }
    
    // Get patient basic info
    const patient = await User.findById(patientId);
    
    if (!patient) {
      return res.status(404).json({
        status: 'error',
        message: 'Patient not found'
      });
    }
    
    // Prepare dashboard data
    const dashboardData = {
      patient: {
        _id: patient._id,
        fullName: patient.fullName,
        gender: patient.gender,
        dateOfBirth: patient.dateOfBirth,
        age: calculateAge(patient.dateOfBirth)
      },
      medicationSummary: {},
      vitalSigns: {},
      recentSymptoms: [],
      criticalAlerts: []
    };
    
    // Get medication data if permitted
    if (relationship.permissions.viewMedications) {
      dashboardData.medicationSummary = await getMedicationSummary(patientId);
    }
    
    // Get vital signs if permitted
    if (relationship.permissions.viewVitals) {
      dashboardData.vitalSigns = await getLatestVitalSigns(patientId);
    }
    
    // Get symptoms if permitted
    if (relationship.permissions.viewSymptoms) {
      dashboardData.recentSymptoms = await getRecentSymptoms(patientId);
    }
    
    // Get critical alerts
    if (relationship.permissions.receiveAlerts) {
      dashboardData.criticalAlerts = await getCriticalAlerts(patientId);
    }
    
    res.status(200).json({
      status: 'success',
      dashboard: dashboardData
    });
  } catch (error) {
    logger.error('Error getting patient dashboard:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get patient dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get patient medication logs as caregiver
exports.getPatientMedicationLogs = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { period = '7days', medicationId } = req.query;
    
    // Verify caregiver relationship and permissions
    const relationship = await CaregiverRelationship.findOne({
      caregiverId: req.user._id,
      patientId,
      status: 'active',
      'permissions.viewMedications': true
    });
    
    if (!relationship) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to view this patient\'s medication data'
      });
    }
    
    // Determine date range
    const endDate = new Date();
    let startDate = new Date();
    
    switch(period) {
      case '3days':
        startDate.setDate(startDate.getDate() - 3);
        break;
      case '7days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '14days':
        startDate.setDate(startDate.getDate() - 14);
        break;
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }
    
    // Build query
    const query = {
      userId: patientId,
      createdAt: { $gte: startDate, $lte: endDate }
    };
    
    if (medicationId) {
      query.medicationId = medicationId;
    }
    
    // Get medication logs
    const logs = await MedicationLog.find(query)
      .sort({ createdAt: -1 })
      .populate('medicationId', 'name dosage dosageForm');
    
    // Get all medications for the patient
    const medications = await Medication.find({
      userId: patientId,
      isActive: true
    });
    
    // Calculate adherence for each medication
    const medicationAdherence = [];
    
    for (const medication of medications) {
      const medLogs = logs.filter(log => 
        log.medicationId && log.medicationId._id.toString() === medication._id.toString()
      );
      
      const totalLogs = medLogs.length;
      const takenLogs = medLogs.filter(log => log.status === 'taken').length;
      const adherenceRate = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null;
      
      medicationAdherence.push({
        medicationId: medication._id,
        name: medication.name,
        dosage: medication.dosage,
        adherenceRate,
        totalLogs,
        takenLogs
      });
    }
    
    // Overall adherence
    const overallAdherence = {
      totalLogs: logs.length,
      takenLogs: logs.filter(log => log.status === 'taken').length,
      adherenceRate: logs.length > 0 ? 
        Math.round((logs.filter(log => log.status === 'taken').length / logs.length) * 100) : null
    };
    
    res.status(200).json({
      status: 'success',
      period,
      dateRange: {
        start: startDate,
        end: endDate
      },
      overallAdherence,
      medicationAdherence,
      recentLogs: logs.slice(0, 20)
    });
  } catch (error) {
    logger.error('Error getting patient medication logs:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get patient medication logs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get patient's vital signs as caregiver
exports.getPatientVitalSigns = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { type, period = '7days' } = req.query;
    
    // Verify caregiver relationship and permissions
    const relationship = await CaregiverRelationship.findOne({
      caregiverId: req.user._id,
      patientId,
      status: 'active',
      'permissions.viewVitals': true
    });
    
    if (!relationship) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to view this patient\'s vital signs'
      });
    }
    
    // Determine date range
    const endDate = new Date();
    let startDate = new Date();
    
    switch(period) {
      case '3days':
        startDate.setDate(startDate.getDate() - 3);
        break;
      case '7days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '14days':
        startDate.setDate(startDate.getDate() - 14);
        break;
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }
    
    // Build query
    const query = {
      userId: patientId,
      timestamp: { $gte: startDate, $lte: endDate }
    };
    
    if (type) {
      query.type = type;
    }
    
    // Get vital signs
    const vitalSigns = await VitalSign.find(query).sort({ timestamp: -1 });
    
    // Group by type
    const vitalsByType = {};
    vitalSigns.forEach(vital => {
      if (!vitalsByType[vital.type]) {
        vitalsByType[vital.type] = [];
      }
      vitalsByType[vital.type].push(vital);
    });
    
    // Calculate stats for each type
    const vitalStats = Object.keys(vitalsByType).map(vitalType => {
      const vitals = vitalsByType[vitalType];
      const abnormalCount = vitals.filter(v => !v.isNormal).length;
      
      return {
        type: vitalType,
        count: vitals.length,
        abnormalCount,
        abnormalPercentage: Math.round((abnormalCount / vitals.length) * 100),
        latest: vitals[0]
      };
    });
    
    res.status(200).json({
      status: 'success',
      period,
      dateRange: {
        start: startDate,
        end: endDate
      },
      vitalStats,
      recentReadings: vitalSigns.slice(0, 20)
    });
  } catch (error) {
    logger.error('Error getting patient vital signs:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get patient vital signs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get patient's health check-ins as caregiver
exports.getPatientHealthCheckIns = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { period = '7days' } = req.query;
    
    // Verify caregiver relationship and permissions
    const relationship = await CaregiverRelationship.findOne({
      caregiverId: req.user._id,
      patientId,
      status: 'active',
      'permissions.viewSymptoms': true
    });
    
    if (!relationship) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to view this patient\'s health check-ins'
      });
    }
    
    // Determine date range
    const endDate = new Date();
    let startDate = new Date();
    
    switch(period) {
      case '3days':
        startDate.setDate(startDate.getDate() - 3);
        break;
      case '7days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '14days':
        startDate.setDate(startDate.getDate() - 14);
        break;
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }
    
    // Get health check-ins
    const checkIns = await HealthCheckIn.find({
      userId: patientId,
      createdAt: { $gte: startDate, $lte: endDate }
    }).sort({ createdAt: -1 });
    
    // Count feelings
    const feelingStats = {
      good: 0,
      fair: 0,
      poor: 0
    };
    
    checkIns.forEach(checkIn => {
      feelingStats[checkIn.feeling]++;
    });
    
    // Count symptoms
    const symptomCounts = {};
    checkIns.forEach(checkIn => {
      if (checkIn.symptoms && checkIn.symptoms.length > 0) {
        checkIn.symptoms.forEach(symptom => {
          if (!symptomCounts[symptom.name]) {
            symptomCounts[symptom.name] = {
              count: 0,
              totalSeverity: 0
            };
          }
          symptomCounts[symptom.name].count++;
          symptomCounts[symptom.name].totalSeverity += symptom.severity || 0;
        });
      }
    });
    
    // Format symptom stats
    const symptomStats = Object.keys(symptomCounts).map(name => ({
      name,
      count: symptomCounts[name].count,
      averageSeverity: Math.round((symptomCounts[name].totalSeverity / symptomCounts[name].count) * 10) / 10
    })).sort((a, b) => b.count - a.count);
    
    res.status(200).json({
      status: 'success',
      period,
      dateRange: {
        start: startDate,
        end: endDate
      },
      checkInCount: checkIns.length,
      feelingStats,
      symptomStats,
      recentCheckIns: checkIns.slice(0, 10)
    });
  } catch (error) {
    logger.error('Error getting patient health check-ins:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get patient health check-ins',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update caregiver notification preferences
exports.updateNotificationPreferences = async (req, res) => {
  try {
    const { relationshipId } = req.params;
    const { notificationPreferences } = req.body;
    
    // Verify relationship
    const relationship = await CaregiverRelationship.findOne({
      _id: relationshipId,
      caregiverId: req.user._id,
      status: 'active'
    });
    
    if (!relationship) {
      return res.status(404).json({
        status: 'error',
        message: 'Caregiver relationship not found'
      });
    }
    
    // Update notification preferences
    if (notificationPreferences) {
      relationship.notificationPreferences = {
        ...relationship.notificationPreferences,
        ...notificationPreferences
      };
    }
    
    await relationship.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Notification preferences updated successfully',
      notificationPreferences: relationship.notificationPreferences
    });
  } catch (error) {
    logger.error('Error updating notification preferences:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update notification preferences',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get recent caregiver reports
exports.getCaregiverReports = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    // Verify relationship
    const relationship = await CaregiverRelationship.findOne({
      caregiverId: req.user._id,
      patientId,
      status: 'active'
    });
    
    if (!relationship) {
      return res.status(404).json({
        status: 'error',
        message: 'Caregiver relationship not found'
      });
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get reports
    const reports = await CaregiverReport.find({
      caregiverId: req.user._id,
      patientId
    })
    .sort({ reportDate: -1 })
    .skip(skip)
    .limit(parseInt(limit));
    
    // Count total
    const total = await CaregiverReport.countDocuments({
      caregiverId: req.user._id,
      patientId
    });
    
    // Mark reports as viewed
    const reportIds = reports.map(report => report._id);
    await CaregiverReport.updateMany(
      { _id: { $in: reportIds }, 'reportStatus.viewed': false },
      { 
        'reportStatus.viewed': true,
        'reportStatus.viewedAt': new Date()
      }
    );
    
    res.status(200).json({
      status: 'success',
      count: reports.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      reports
    });
  } catch (error) {
    logger.error('Error getting caregiver reports:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get caregiver reports',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Record medication for patient as caregiver
exports.recordPatientMedication = async (req, res) => {
  try {
    const { patientId, medicationId } = req.params;
    const { status, scheduledTime, takenTime, notes } = req.body;
    
    // Verify caregiver relationship and permissions
    const relationship = await CaregiverRelationship.findOne({
      caregiverId: req.user._id,
      patientId,
      status: 'active',
      'permissions.recordMedications': true
    });
    
    if (!relationship) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to record medications for this patient'
      });
    }
    
    // Validate status
    const validStatuses = ['taken', 'skipped', 'missed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    // Verify medication belongs to patient
    const medication = await Medication.findOne({
      _id: medicationId,
      userId: patientId
    });
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found or does not belong to this patient'
      });
    }
    
    // Create medication log
    const medicationLog = new MedicationLog({
      userId: patientId,
      medicationId,
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
      takenTime: status === 'taken' ? (takenTime ? new Date(takenTime) : new Date()) : null,
      status,
      notes,
      recordedBy: req.user._id,
      recordedAt: new Date(),
      quantityAdjustment: status === 'taken' ? -1 : 0
    });
    
    await medicationLog.save();
    
    // Update medication remaining quantity if taken
    if (status === 'taken' && medication.remainingQuantity !== undefined) {
      medication.remainingQuantity = Math.max(0, medication.remainingQuantity - 1);
      await medication.save();
    }
    
    res.status(201).json({
      status: 'success',
      message: `Medication ${status} successfully recorded by caregiver`,
      medicationLog,
      medication: {
        id: medication._id,
        name: medication.name,
        remainingQuantity: medication.remainingQuantity
      }
    });
  } catch (error) {
    logger.error('Error recording patient medication:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to record medication',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper functions

// Calculate age from date of birth
function calculateAge(dateOfBirth) {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
}

// Get medication summary for dashboard
async function getMedicationSummary(patientId) {
  // Get recent logs (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const logs = await MedicationLog.find({
    userId: patientId,
    createdAt: { $gte: sevenDaysAgo }
  }).populate('medicationId', 'name dosage');
  
  // Get active medications
  const medications = await Medication.find({
    userId: patientId,
    isActive: true,
    status: 'active'
  });
  
  // Calculate adherence stats
  const totalLogs = logs.length;
  const takenLogs = logs.filter(log => log.status === 'taken').length;
  const missedLogs = logs.filter(log => log.status === 'missed').length;
  const adherenceRate = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null;
  
  // Today's medications
  const today = new Date();
  const todayLogs = logs.filter(log => {
    const logDate = new Date(log.createdAt);
    return logDate.setHours(0, 0, 0, 0) === today.setHours(0, 0, 0, 0);
  });
  
  const todayTotal = todayLogs.length;
  const todayTaken = todayLogs.filter(log => log.status === 'taken').length;
  const todayMissed = todayLogs.filter(log => log.status === 'missed').length;
  
  // Medication-specific stats
  const medicationStats = [];
  
  for (const medication of medications) {
    const medLogs = logs.filter(log => 
      log.medicationId && log.medicationId._id.toString() === medication._id.toString()
    );
    
    const medTotal = medLogs.length;
    const medTaken = medLogs.filter(log => log.status === 'taken').length;
    const medAdherenceRate = medTotal > 0 ? Math.round((medTaken / medTotal) * 100) : null;
    
    // Today's status for this medication
    const medTodayLogs = todayLogs.filter(log => 
      log.medicationId && log.medicationId._id.toString() === medication._id.toString()
    );
    
    medicationStats.push({
      medicationId: medication._id,
      name: medication.name,
      dosage: medication.dosage,
      totalLogs: medTotal,
      takenLogs: medTaken,
      adherenceRate: medAdherenceRate,
      remainingQuantity: medication.remainingQuantity,
      refillNeeded: medication.remainingQuantity < 7,
      todayStatus: medTodayLogs.length > 0 ? 
        (medTodayLogs.some(log => log.status === 'taken') ? 'taken' : 'missed') : 
        'pending'
    });
  }
  
  return {
    adherenceRate,
    totalLogs,
    takenLogs,
    missedLogs,
    today: {
      total: todayTotal,
      taken: todayTaken,
      missed: todayMissed,
      pending: todayTotal - todayTaken - todayMissed
    },
    medications: medicationStats
  };
}

// Get latest vital signs for dashboard
async function getLatestVitalSigns(patientId) {
  // Get the latest reading of each type
  const vitalTypes = ['bloodPressure', 'glucose', 'weight', 'temperature', 'heartRate', 'oxygenLevel'];
  const latestVitals = {};
  
  for (const type of vitalTypes) {
    const reading = await VitalSign.findOne({
      userId: patientId,
      type
    }).sort({ timestamp: -1 }).limit(1);
    
    if (reading) {
      latestVitals[type] = {
        timestamp: reading.timestamp,
        values: reading.values,
        isNormal: reading.isNormal
      };
    }
  }
  
  // Count abnormal readings in the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const recentReadings = await VitalSign.find({
    userId: patientId,
    timestamp: { $gte: sevenDaysAgo }
  });
  
  const abnormalCount = recentReadings.filter(reading => !reading.isNormal).length;
  
  return {
    latestReadings: latestVitals,
    recentStats: {
      totalReadings: recentReadings.length,
      abnormalReadings: abnormalCount,
      abnormalPercentage: recentReadings.length > 0 ? 
        Math.round((abnormalCount / recentReadings.length) * 100) : 0
    }
  };
}

// Get recent symptoms for dashboard
async function getRecentSymptoms(patientId) {
  // Get check-ins from last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const checkIns = await HealthCheckIn.find({
    userId: patientId,
    createdAt: { $gte: sevenDaysAgo }
  }).sort({ createdAt: -1 });
  
  // Extract symptoms
  const symptoms = [];
  
  checkIns.forEach(checkIn => {
    if (checkIn.symptoms && checkIn.symptoms.length > 0) {
      checkIn.symptoms.forEach(symptom => {
        symptoms.push({
          name: symptom.name,
          severity: symptom.severity || 3,
          bodyLocation: symptom.bodyLocation,
          reportedAt: checkIn.createdAt,
          feeling: checkIn.feeling
        });
      });
    }
  });
  
  // Count occurrences of each symptom
  const symptomCounts = {};
  symptoms.forEach(symptom => {
    if (!symptomCounts[symptom.name]) {
      symptomCounts[symptom.name] = {
        count: 0,
        totalSeverity: 0,
        occurrences: []
      };
    }
    
    symptomCounts[symptom.name].count++;
    symptomCounts[symptom.name].totalSeverity += symptom.severity;
    symptomCounts[symptom.name].occurrences.push({
      severity: symptom.severity,
      reportedAt: symptom.reportedAt
    });
  });
  
  // Format results
  const symptomSummary = Object.keys(symptomCounts).map(name => ({
    name,
    count: symptomCounts[name].count,
    averageSeverity: Math.round((symptomCounts[name].totalSeverity / symptomCounts[name].count) * 10) / 10,
    lastReported: symptomCounts[name].occurrences.sort((a, b) => 
      new Date(b.reportedAt) - new Date(a.reportedAt))[0].reportedAt
  })).sort((a, b) => b.count - a.count);
  
  return {
    recentSymptomCount: symptoms.length,
    uniqueSymptomCount: symptomSummary.length,
    checkInWithSymptomsCount: checkIns.filter(c => 
      c.symptoms && c.symptoms.length > 0
    ).length,
    mostFrequentSymptoms: symptomSummary.slice(0, 5),
    recentSymptoms: symptoms.slice(0, 10)
  };
}

// Get critical alerts for dashboard
async function getCriticalAlerts(patientId) {
  const alerts = [];
  
  // 1. Check for medications with low adherence in past 3 days
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
  const recentLogs = await MedicationLog.find({
    userId: patientId,
    createdAt: { $gte: threeDaysAgo }
  }).populate('medicationId', 'name');
  
  // Group by medication
  const medicationLogs = {};
  recentLogs.forEach(log => {
    if (log.medicationId) {
      const medId = log.medicationId._id.toString();
      if (!medicationLogs[medId]) {
        medicationLogs[medId] = {
          name: log.medicationId.name,
          logs: []
        };
      }
      medicationLogs[medId].logs.push(log);
    }
  });
  
  // Check adherence for each medication
  Object.values(medicationLogs).forEach(med => {
    const totalLogs = med.logs.length;
    const takenLogs = med.logs.filter(log => log.status === 'taken').length;
    const adherenceRate = Math.round((takenLogs / totalLogs) * 100);
    
    if (totalLogs >= 3 && adherenceRate < 50) {
      alerts.push({
        type: 'medication_adherence',
        severity: 'warning',
        title: `Low adherence for ${med.name}`,
        message: `Only ${adherenceRate}% of doses taken in the last 3 days`,
        timestamp: new Date(),
        details: {
          medicationName: med.name,
          adherenceRate,
          missedDoses: totalLogs - takenLogs
        }
      });
    }
  });
  
  // 2. Check for abnormal vital signs in last 24 hours
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  
  const recentVitals = await VitalSign.find({
    userId: patientId,
    timestamp: { $gte: oneDayAgo },
    isNormal: false
  });
  
  recentVitals.forEach(vital => {
    let readingDescription = '';
    
    switch(vital.type) {
      case 'bloodPressure':
        readingDescription = `${vital.values.systolic}/${vital.values.diastolic} mmHg`;
        break;
      case 'heartRate':
        readingDescription = `${vital.values.heartRate} bpm`;
        break;
      case 'glucose':
        readingDescription = `${vital.values.glucoseLevel} mg/dL`;
        break;
      default:
        readingDescription = JSON.stringify(vital.values);
    }
    
    alerts.push({
      type: 'abnormal_vitals',
      severity: 'warning',
      title: `Abnormal ${vital.type} reading`,
      message: `Reading of ${readingDescription} is outside normal range`,
      timestamp: vital.timestamp,
      details: {
        vitalType: vital.type,
        values: vital.values,
        time: vital.timestamp
      }
    });
  });
  
  // 3. Check for severe symptoms in last 24 hours
  const recentCheckIns = await HealthCheckIn.find({
    userId: patientId,
    createdAt: { $gte: oneDayAgo }
  });
  
  recentCheckIns.forEach(checkIn => {
    if (checkIn.symptoms && checkIn.symptoms.length > 0) {
      const severeSymptoms = checkIn.symptoms.filter(s => (s.severity || 3) >= 4);
      
      if (severeSymptoms.length > 0) {
        alerts.push({
          type: 'severe_symptoms',
          severity: 'warning',
          title: `Severe symptoms reported`,
          message: `${severeSymptoms.length} severe symptoms including ${severeSymptoms[0].name}`,
          timestamp: checkIn.createdAt,
          details: {
            symptoms: severeSymptoms,
            feeling: checkIn.feeling
          }
        });
      }
    }
    
    // Check for high risk assessment
    if (checkIn.aiAssessment && checkIn.aiAssessment.riskLevel === 'high') {
      alerts.push({
        type: 'high_risk_assessment',
        severity: 'critical',
        title: 'High risk health assessment',
        message: 'AI assessment indicates high risk health status',
        timestamp: checkIn.createdAt,
        details: {
          feeling: checkIn.feeling,
          symptoms: checkIn.symptoms,
          recommendations: checkIn.aiAssessment.recommendations
        }
      });
    }
  });
  
  // Sort alerts by recency
  return alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}