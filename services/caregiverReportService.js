// services/caregiverReportService.js
const cron = require('node-cron');
const CaregiverRelationship = require('../models/CaregiverRelationship');
const CaregiverReport = require('../models/CaregiverReport');
const MedicationLog = require('../models/MedicationLog');
const { VitalSign, HealthCheckIn } = require('../models/healthModel');
const Medication = require('../models/medicationModel');
const User = require('../models/userModel');
const { sendPushNotification } = require('./notificationService');
const { sendReportEmail } = require('../utils/emailService');
const { sendReportSMS } = require('../utils/smsService');
const logger = require('../utils/logger');

/**
 * Start the caregiver report scheduler.
 * This generates and sends daily reports to caregivers.
 */
function startCaregiverReportScheduler() {
  // Run daily at 8:00 PM
  cron.schedule('0 20 * * *', async () => {
    try {
      logger.info('Caregiver Report Scheduler: Starting daily report generation');
      await generateDailyReports();
      logger.info('Caregiver Report Scheduler: Daily report generation completed');
    } catch (error) {
      logger.error('Error in caregiver report scheduler:', error);
    }
  });

  // Also schedule weekly reports (Sundays at 8:00 PM)
  cron.schedule('0 20 * * 0', async () => {
    try {
      logger.info('Caregiver Report Scheduler: Starting weekly report generation');
      await generateWeeklyReports();
      logger.info('Caregiver Report Scheduler: Weekly report generation completed');
    } catch (error) {
      logger.error('Error in weekly caregiver report scheduler:', error);
    }
  });

  logger.info('Caregiver Report Scheduler started');
}

/**
 * Generate daily reports for all caregivers.
 */
async function generateDailyReports() {
  try {
    // Get active caregiver relationships with daily reporting
    const relationships = await CaregiverRelationship.find({
      status: 'active',
      'notificationPreferences.reportFrequency': 'daily',
      'notificationPreferences.receiveReports': true
    });

    logger.info(`Found ${relationships.length} relationships requiring daily reports`);

    // Generate report for each relationship
    for (const relationship of relationships) {
      try {
        // Check if a report already exists for today for this relationship
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const existingReport = await CaregiverReport.findOne({
          caregiverId: relationship.caregiverId,
          patientId: relationship.patientId,
          reportDate: {
            $gte: today,
            $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
          },
          reportType: 'daily'
        });

        if (existingReport) {
          logger.info(`Daily report already exists for relationship ${relationship._id}`);
          continue;
        }

        // Generate the report
        await generateAndSendReport(relationship, 'daily');
      } catch (error) {
        logger.error(`Error generating daily report for relationship ${relationship._id}:`, error);
      }
    }
  } catch (error) {
    logger.error('Error generating daily reports:', error);
    throw error;
  }
}

/**
 * Generate weekly reports for all caregivers who want them.
 */
async function generateWeeklyReports() {
  try {
    // Get active caregiver relationships with weekly reporting
    const relationships = await CaregiverRelationship.find({
      status: 'active',
      'notificationPreferences.reportFrequency': 'weekly',
      'notificationPreferences.receiveReports': true
    });

    logger.info(`Found ${relationships.length} relationships requiring weekly reports`);

    // Generate report for each relationship
    for (const relationship of relationships) {
      try {
        // Check if a weekly report already exists for this week
        const today = new Date();
        const startOfWeek = new Date(today);
        // Set to previous Sunday
        startOfWeek.setDate(today.getDate() - today.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        
        const existingReport = await CaregiverReport.findOne({
          caregiverId: relationship.caregiverId,
          patientId: relationship.patientId,
          reportDate: {
            $gte: startOfWeek,
            $lt: new Date()
          },
          reportType: 'weekly'
        });

        if (existingReport) {
          logger.info(`Weekly report already exists for relationship ${relationship._id}`);
          continue;
        }

        // Generate the report
        await generateAndSendReport(relationship, 'weekly');
      } catch (error) {
        logger.error(`Error generating weekly report for relationship ${relationship._id}:`, error);
      }
    }
  } catch (error) {
    logger.error('Error generating weekly reports:', error);
    throw error;
  }
}

/**
 * Generate and send a report for a specific caregiver-patient relationship.
 * 
 * @param {Object} relationship - The caregiver relationship document
 * @param {String} reportType - Type of report ('daily' or 'weekly')
 */
async function generateAndSendReport(relationship, reportType = 'daily') {
  try {
    // Determine date range
    const endDate = new Date();
    let startDate;
    
    if (reportType === 'daily') {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0); // Beginning of the day
    } else if (reportType === 'weekly') {
      startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 7);
    } else {
      throw new Error(`Invalid report type: ${reportType}`);
    }

    // Get patient information
    const patient = await User.findById(relationship.patientId);
    
    if (!patient) {
      logger.error(`Patient ${relationship.patientId} not found`);
      return;
    }

    // Create basic report structure
    const report = new CaregiverReport({
      caregiverId: relationship.caregiverId,
      patientId: relationship.patientId,
      reportDate: new Date(),
      reportType,
      medicationSummary: {
        medications: []
      },
      vitalSignsSummary: {
        vitals: []
      },
      symptomsSummary: {
        symptoms: []
      },
      criticalAlerts: [],
      recommendations: [],
      reportStatus: {
        generated: true,
        delivered: false
      }
    });

    // Collect medication data if permitted
    if (relationship.permissions.viewMedications) {
      const medicationSummary = await getMedicationSummary(relationship.patientId, startDate, endDate);
      report.medicationSummary = medicationSummary;
    }

    // Collect vital signs data if permitted
    if (relationship.permissions.viewVitals) {
      const vitalSummary = await getVitalSignsSummary(relationship.patientId, startDate, endDate);
      report.vitalSignsSummary = vitalSummary;
    }

    // Collect symptom data if permitted
    if (relationship.permissions.viewSymptoms) {
      const symptomSummary = await getSymptomsSummary(relationship.patientId, startDate, endDate);
      report.symptomsSummary = symptomSummary;
    }

    // Collect critical alerts if any
    if (relationship.permissions.receiveAlerts) {
      const criticalAlerts = await getCriticalAlerts(relationship.patientId, startDate, endDate);
      report.criticalAlerts = criticalAlerts;
    }

    // Generate recommendations
    report.recommendations = generateRecommendations(report);

    // Save the report
    await report.save();

    // Send the report to the caregiver
    await sendReportToCaregiver(report, relationship);

    logger.info(`${reportType.charAt(0).toUpperCase() + reportType.slice(1)} report generated for caregiver ${relationship.caregiverId} and patient ${relationship.patientId}`);
    
    return report;
  } catch (error) {
    logger.error(`Error generating ${reportType} report:`, error);
    throw error;
  }
}

/**
 * Get medication summary for the report.
 */
async function getMedicationSummary(patientId, startDate, endDate) {
  // Get medication logs for the period
  const logs = await MedicationLog.find({
    userId: patientId,
    createdAt: { $gte: startDate, $lte: endDate }
  }).populate('medicationId', 'name dosage');

  // Get active medications
  const medications = await Medication.find({
    userId: patientId,
    isActive: true
  });

  // Calculate overall adherence
  const totalLogs = logs.length;
  const takenLogs = logs.filter(log => log.status === 'taken').length;
  const missedLogs = logs.filter(log => log.status === 'missed').length;
  const skippedLogs = logs.filter(log => log.status === 'skipped').length;

  const adherenceRate = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null;

  // Medication-specific stats
  const medicationStats = [];

  for (const medication of medications) {
    const medLogs = logs.filter(log => 
      log.medicationId && log.medicationId._id.toString() === medication._id.toString()
    );
    
    if (medLogs.length > 0) {
      const medTakenLogs = medLogs.filter(log => log.status === 'taken').length;
      const medMissedLogs = medLogs.filter(log => log.status === 'missed').length;
      const medAdherenceRate = Math.round((medTakenLogs / medLogs.length) * 100);

      medicationStats.push({
        medicationId: medication._id,
        name: medication.name,
        adherenceRate: medAdherenceRate,
        missedDoses: medMissedLogs
      });
    }
  }

  // Sort by adherence rate (ascending - worst first)
  medicationStats.sort((a, b) => a.adherenceRate - b.adherenceRate);

  return {
    adherenceRate,
    totalDoses: totalLogs,
    takenDoses: takenLogs,
    missedDoses: missedLogs,
    skippedDoses: skippedLogs,
    medications: medicationStats
  };
}

/**
 * Get vital signs summary for the report.
 */
async function getVitalSignsSummary(patientId, startDate, endDate) {
  // Get vital sign readings for the period
  const readings = await VitalSign.find({
    userId: patientId,
    timestamp: { $gte: startDate, $lte: endDate }
  }).sort({ timestamp: -1 });

  // Count normal/abnormal readings
  const totalReadings = readings.length;
  const abnormalReadings = readings.filter(reading => !reading.isNormal).length;

  // Format vital signs for the report
  const formattedVitals = readings.map(reading => {
    let value;
    
    switch(reading.type) {
      case 'bloodPressure':
        value = `${reading.values.systolic}/${reading.values.diastolic} mmHg`;
        break;
      case 'glucose':
        value = `${reading.values.glucoseLevel} mg/dL`;
        break;
      case 'heartRate':
        value = `${reading.values.heartRate} bpm`;
        break;
      case 'oxygenLevel':
        value = `${reading.values.oxygenLevel}%`;
        break;
      case 'temperature':
        value = `${reading.values.temperature}°F`;
        break;
      case 'weight':
        value = `${reading.values.weight} ${reading.unit || 'kg'}`;
        break;
      default:
        value = JSON.stringify(reading.values);
    }
    
    return {
      type: reading.type,
      value,
      isNormal: reading.isNormal,
      timestamp: reading.timestamp
    };
  });

  return {
    readings: totalReadings,
    abnormalReadings,
    vitals: formattedVitals
  };
}

/**
 * Get symptoms summary for the report.
 */
async function getSymptomsSummary(patientId, startDate, endDate) {
  // Get health check-ins for the period
  const checkIns = await HealthCheckIn.find({
    userId: patientId,
    createdAt: { $gte: startDate, $lte: endDate }
  }).sort({ createdAt: -1 });

  // Extract symptoms
  const allSymptoms = [];
  let hasSymptoms = false;

  checkIns.forEach(checkIn => {
    if (checkIn.symptoms && checkIn.symptoms.length > 0) {
      hasSymptoms = true;
      checkIn.symptoms.forEach(symptom => {
        allSymptoms.push({
          name: symptom.name,
          severity: symptom.severity || 3,
          reportedAt: checkIn.createdAt
        });
      });
    }
  });

  // Sort by severity (highest first) then by recency
  allSymptoms.sort((a, b) => {
    if (b.severity !== a.severity) {
      return b.severity - a.severity;
    }
    return new Date(b.reportedAt) - new Date(a.reportedAt);
  });

  return {
    reported: hasSymptoms,
    symptoms: allSymptoms
  };
}

/**
 * Get critical alerts for the period.
 */
async function getCriticalAlerts(patientId, startDate, endDate) {
  const alerts = [];

  // 1. Check for missed critical medications
  const medicationLogs = await MedicationLog.find({
    userId: patientId,
    createdAt: { $gte: startDate, $lte: endDate },
    status: 'missed'
  }).populate('medicationId', 'name purpose');

  // Group by medication
  const missedMeds = {};
  medicationLogs.forEach(log => {
    if (log.medicationId) {
      const medId = log.medicationId._id.toString();
      if (!missedMeds[medId]) {
        missedMeds[medId] = {
          name: log.medicationId.name,
          purpose: log.medicationId.purpose,
          count: 0,
          logs: []
        };
      }
      missedMeds[medId].count++;
      missedMeds[medId].logs.push(log);
    }
  });

  // Add critical alerts for medications missed multiple times
  Object.values(missedMeds).forEach(med => {
    if (med.count >= 2) {
      alerts.push({
        alertType: 'missed_critical_medication',
        severity: 'critical',
        message: `${med.name} was missed ${med.count} times in this period`,
        timestamp: med.logs[0].createdAt
      });
    }
  });

  // 2. Check for severely abnormal vital signs
  const abnormalVitals = await VitalSign.find({
    userId: patientId,
    timestamp: { $gte: startDate, $lte: endDate },
    isNormal: false
  });

  // Add alerts for abnormal vital signs
  abnormalVitals.forEach(vital => {
    let readingDescription = '';
    let isSevere = false;
    
    switch(vital.type) {
      case 'bloodPressure':
        readingDescription = `${vital.values.systolic}/${vital.values.diastolic} mmHg`;
        // Check if severely abnormal (example thresholds)
        if (vital.values.systolic > 160 || vital.values.systolic < 90 || 
            vital.values.diastolic > 100 || vital.values.diastolic < 60) {
          isSevere = true;
        }
        break;
      case 'glucose':
        readingDescription = `${vital.values.glucoseLevel} mg/dL`;
        if (vital.values.glucoseLevel > 250 || vital.values.glucoseLevel < 60) {
          isSevere = true;
        }
        break;
      case 'heartRate':
        readingDescription = `${vital.values.heartRate} bpm`;
        if (vital.values.heartRate > 120 || vital.values.heartRate < 50) {
          isSevere = true;
        }
        break;
      case 'oxygenLevel':
        readingDescription = `${vital.values.oxygenLevel}%`;
        if (vital.values.oxygenLevel < 90) {
          isSevere = true;
        }
        break;
      default:
        readingDescription = JSON.stringify(vital.values);
    }
    
    if (isSevere) {
      alerts.push({
        alertType: 'abnormal_vitals',
        severity: 'warning',
        message: `Abnormal ${vital.type} reading: ${readingDescription}`,
        timestamp: vital.timestamp
      });
    }
  });

  // 3. Check for severe symptoms
  const healthCheckIns = await HealthCheckIn.find({
    userId: patientId,
    createdAt: { $gte: startDate, $lte: endDate },
    'symptoms.severity': { $gte: 4 }
  });

  healthCheckIns.forEach(checkIn => {
    const severeSymptoms = checkIn.symptoms.filter(s => (s.severity || 0) >= 4);
    
    if (severeSymptoms.length > 0) {
      alerts.push({
        alertType: 'severe_symptoms',
        severity: 'warning',
        message: `Severe symptoms reported: ${severeSymptoms.map(s => s.name).join(', ')}`,
        timestamp: checkIn.createdAt
      });
    }

    // Add alert for high risk assessment
    if (checkIn.aiAssessment && checkIn.aiAssessment.riskLevel === 'high') {
      alerts.push({
        alertType: 'high_risk_assessment',
        severity: 'critical',
        message: 'AI assessment indicated high health risk',
        timestamp: checkIn.createdAt
      });
    }
  });

  // Sort alerts by timestamp (recent first)
  return alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * Generate recommendations based on the report data.
 */
function generateRecommendations(report) {
  const recommendations = [];

  // Medication adherence recommendations
  if (report.medicationSummary && report.medicationSummary.adherenceRate !== null) {
    if (report.medicationSummary.adherenceRate < 70) {
      recommendations.push(`Consider discussing medication adherence with the patient. Overall adherence is ${report.medicationSummary.adherenceRate}%, which is below the recommended 80%.`);
      
      // Add medication-specific recommendations
      const lowAdherenceMeds = report.medicationSummary.medications
        .filter(med => med.adherenceRate < 70)
        .slice(0, 2); // Limit to top 2 problem medications
      
      if (lowAdherenceMeds.length > 0) {
        lowAdherenceMeds.forEach(med => {
          recommendations.push(`${med.name} has particularly low adherence (${med.adherenceRate}%). Consider checking if there are specific issues with this medication.`);
        });
      }
    }
  }

  // Vital signs recommendations
  if (report.vitalSignsSummary && report.vitalSignsSummary.abnormalReadings > 0) {
    const abnormalPercent = Math.round((report.vitalSignsSummary.abnormalReadings / report.vitalSignsSummary.readings) * 100);
    
    if (abnormalPercent > 30) {
      recommendations.push(`${abnormalPercent}% of vital sign readings were abnormal. Consider following up on these readings with the patient or their healthcare provider.`);
    }
  }

  // Symptom recommendations
  if (report.symptomsSummary && report.symptomsSummary.reported) {
    const severeSymptoms = report.symptomsSummary.symptoms.filter(s => s.severity >= 4);
    
    if (severeSymptoms.length > 0) {
      const symptomNames = [...new Set(severeSymptoms.map(s => s.name))];
      recommendations.push(`Patient reported severe symptoms: ${symptomNames.join(', ')}. Consider checking on their current status and whether they've consulted a healthcare provider.`);
    }
  }

  // Add general recommendation for critical alerts
  if (report.criticalAlerts && report.criticalAlerts.length > 0) {
    recommendations.push(`There were ${report.criticalAlerts.length} critical alerts during this period. Please review them and consider appropriate follow-up actions.`);
  }

  // Add a general positive recommendation if things are going well
  if (recommendations.length === 0) {
    recommendations.push("The patient is doing well with their health management. Continue the current level of support and monitoring.");
  }

  return recommendations;
}

/**
 * Send the report to the caregiver through their preferred channels.
 */
async function sendReportToCaregiver(report, relationship) {
  try {
    // Get caregiver and patient
    const caregiver = await User.findById(relationship.caregiverId);
    const patient = await User.findById(relationship.patientId);
    
    if (!caregiver || !patient) {
      logger.error(`Could not find caregiver ${relationship.caregiverId} or patient ${relationship.patientId}`);
      return;
    }

    // Track delivery status
    let delivered = false;

    // 1. Send push notification
    if (relationship.notificationPreferences.notificationChannels.app) {
      try {
        await sendPushNotification(
          caregiver._id,
          `Health Report for ${patient.fullName}`,
          getReportSummary(report),
          {
            reportId: report._id.toString(),
            reportType: report.reportType,
            patientId: patient._id.toString()
          }
        );
        delivered = true;
      } catch (error) {
        logger.error(`Error sending push notification to caregiver ${caregiver._id}:`, error);
      }
    }

    // 2. Send email if configured
    if (relationship.notificationPreferences.notificationChannels.email && caregiver.email) {
      try {
        await sendReportEmail(
          caregiver.email,
          caregiver.fullName,
          patient.fullName,
          formatReportForEmail(report)
        );
        delivered = true;
      } catch (error) {
        logger.error(`Error sending email to caregiver ${caregiver._id}:`, error);
      }
    }

    // 3. Send SMS if configured
    if (relationship.notificationPreferences.notificationChannels.sms) {
      try {
        await sendReportSMS(
          caregiver.phoneNumber,
          `Health Report for ${patient.fullName}: ${getReportSummary(report)}`
        );
        delivered = true;
      } catch (error) {
        logger.error(`Error sending SMS to caregiver ${caregiver._id}:`, error);
      }
    }

    // Update report delivery status
    if (delivered) {
      await CaregiverReport.findByIdAndUpdate(report._id, {
        'reportStatus.delivered': true,
        'reportStatus.deliveredAt': new Date()
      });
    }

    return delivered;
  } catch (error) {
    logger.error(`Error sending report to caregiver:`, error);
    return false;
  }
}

/**
 * Get a brief summary of the report for notifications.
 */
function getReportSummary(report) {
  const reportType = report.reportType === 'daily' ? 'Daily' : 'Weekly';
  let summary = `${reportType} Health Report: `;

  // Add medication adherence
  if (report.medicationSummary && report.medicationSummary.adherenceRate !== null) {
    summary += `Medication adherence: ${report.medicationSummary.adherenceRate}%. `;
  }

  // Add vital sign info
  if (report.vitalSignsSummary && report.vitalSignsSummary.readings > 0) {
    const abnormalCount = report.vitalSignsSummary.abnormalReadings;
    if (abnormalCount > 0) {
      summary += `${abnormalCount} abnormal vital sign readings. `;
    }
  }

  // Add critical alerts count
  if (report.criticalAlerts && report.criticalAlerts.length > 0) {
    summary += `${report.criticalAlerts.length} critical alerts. `;
  }

  return summary;
}

/**
 * Format the report for email delivery.
 */
function formatReportForEmail(report) {
  // This would normally generate HTML content for the email
  // For now, we'll return a simplified structure
  return {
    title: `${report.reportType === 'daily' ? 'Daily' : 'Weekly'} Health Report`,
    adherenceRate: report.medicationSummary?.adherenceRate,
    medications: report.medicationSummary?.medications || [],
    vitalSigns: report.vitalSignsSummary?.vitals || [],
    abnormalReadingsCount: report.vitalSignsSummary?.abnormalReadings || 0,
    symptoms: report.symptomsSummary?.symptoms || [],
    criticalAlerts: report.criticalAlerts || [],
    recommendations: report.recommendations || []
  };
}

/**
 * Generate a one-time report for a caregiver.
 */
async function generateOnDemandReport(caregiverId, patientId) {
  try {
    // Verify caregiver relationship
    const relationship = await CaregiverRelationship.findOne({
      caregiverId,
      patientId,
      status: 'active'
    });
    
    if (!relationship) {
      throw new Error('Caregiver relationship not found or not active');
    }

    // Generate the report
    const report = await generateAndSendReport(relationship, 'daily');
    return report;
  } catch (error) {
    logger.error('Error generating on-demand report:', error);
    throw error;
  }
}

module.exports = {
  startCaregiverReportScheduler,
  generateDailyReports,
  generateWeeklyReports,
  generateOnDemandReport
};