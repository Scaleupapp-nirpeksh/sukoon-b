const mongoose = require('mongoose');
const MedicationLog = require('../models/MedicationLog');
const Medication = require('../models/medicationModel');
const MedicationSchedule = require('../models/MedicationSchedule');
const MedicationReminder = require('../models/MedicationReminder');
const logger = require('../utils/logger');

/**
 * Record medication taken/skipped/missed
 * @route POST /api/medications/logs
 */
exports.recordMedicationEvent = async (req, res) => {
  try {
    const { medicationId, scheduledTime, status, takenTime, dosage, notes } = req.body;
    
    // Validate required fields
    if (!medicationId || !status) {
      return res.status(400).json({
        status: 'error',
        message: 'Medication ID and status are required'
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
    
    // Check if medication exists and belongs to user
    const medication = await Medication.findOne({
      _id: medicationId,
      $or: [
        { userId: req.user._id }, // User's own medication
        { sharedWith: req.user._id } // Medication shared with user
      ]
    });
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found or you do not have access to it'
      });
    }
    
    // Create medication log
    const medicationLog = new MedicationLog({
      userId: medication.userId, // Always use the medication owner's ID
      medicationId,
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
      takenTime: status === 'taken' ? (takenTime ? new Date(takenTime) : new Date()) : null,
      status,
      dosage,
      notes,
      recordedBy: req.user._id,
      recordedAt: new Date(),
      quantityAdjustment: status === 'taken' ? -1 : 0
    });
    
    await medicationLog.save();
    
    // Update medication remaining quantity if taken
    if (status === 'taken' && medication.remainingQuantity !== undefined) {
      medication.remainingQuantity = Math.max(0, medication.remainingQuantity - 1);
      
      // Update the adherence rate (recalculate based on recent logs)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentLogs = await MedicationLog.find({
        medicationId,
        createdAt: { $gte: thirtyDaysAgo }
      });
      
      const totalLogs = recentLogs.length;
      const takenLogs = recentLogs.filter(log => log.status === 'taken').length;
      
      if (totalLogs > 0) {
        medication.adherenceRate = Math.round((takenLogs / totalLogs) * 100);
      }
      
      await medication.save();
    }
    
    // Update any associated reminders
    if (scheduledTime) {
      await MedicationReminder.updateMany(
        {
          medicationId,
          reminderTime: {
            $gte: new Date(scheduledTime).setMinutes(0, 0, 0),
            $lte: new Date(scheduledTime).setMinutes(59, 59, 999)
          },
          status: { $in: ['pending', 'sent', 'snoozed'] }
        },
        {
          status: 'acknowledged',
          responseAction: status,
          acknowledgedAt: new Date()
        }
      );
    }
    
    res.status(201).json({
      status: 'success',
      message: `Medication ${status} successfully recorded`,
      medicationLog,
      medication: {
        id: medication._id,
        name: medication.name,
        remainingQuantity: medication.remainingQuantity,
        adherenceRate: medication.adherenceRate
      }
    });
  } catch (error) {
    logger.error('Error recording medication event:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to record medication event',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
 };
 
 /**
 * Get medication logs with filtering options
 * @route GET /api/medications/logs
 */
 exports.getMedicationLogs = async (req, res) => {
  try {
    const { 
      medicationId, 
      status,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;
    
    // Check if user has access to the medication
    if (medicationId) {
      const medication = await Medication.findOne({
        _id: medicationId,
        $or: [
          { userId: req.user._id },
          { sharedWith: req.user._id }
        ]
      });
      
      if (!medication) {
        return res.status(404).json({
          status: 'error',
          message: 'Medication not found or you do not have access to it'
        });
      }
    }
    
    // Build query
    const query = {};
    
    // User can see their own logs or logs of medications shared with them
    const userMedications = await Medication.find({
      $or: [
        { userId: req.user._id },
        { sharedWith: req.user._id }
      ]
    }).select('_id');
    
    const medicationIds = userMedications.map(med => med._id);
    
    query.medicationId = medicationId ? medicationId : { $in: medicationIds };
    
    if (status) query.status = status;
    
    // Date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get total for pagination
    const total = await MedicationLog.countDocuments(query);
    
    // Get logs with medication details
    const logs = await MedicationLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('medicationId', 'name dosage dosageForm')
      .populate('recordedBy', 'fullName');
    
    // Get adherence stats
    let adherenceStats = null;
    
    if (medicationId) {
      // Calculate adherence stats for specific medication
      adherenceStats = await calculateMedicationAdherence(medicationId);
    } else {
      // Calculate overall adherence stats
      adherenceStats = await calculateOverallAdherence(req.user._id, medicationIds);
    }
    
    res.status(200).json({
      status: 'success',
      count: logs.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      logs,
      adherenceStats
    });
  } catch (error) {
    logger.error('Error getting medication logs:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medication logs',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
 };
 
 /**
 * Get adherence statistics for a specific time period
 * @route GET /api/medications/logs/adherence
 */
 exports.getAdherenceStats = async (req, res) => {
  try {
    const { medicationId, period = '30days' } = req.query;
    
    // Determine date range
    const endDate = new Date();
    let startDate = new Date();
    
    switch(period) {
      case '7days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '6months':
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      case '1year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    let adherenceStats;
    
    if (medicationId) {
      // Verify user has access to this medication
      const medication = await Medication.findOne({
        _id: medicationId,
        $or: [
          { userId: req.user._id },
          { sharedWith: req.user._id }
        ]
      });
      
      if (!medication) {
        return res.status(404).json({
          status: 'error',
          message: 'Medication not found or you do not have access to it'
        });
      }
      
      // Get adherence for specific medication
      adherenceStats = await calculateMedicationAdherence(medicationId, startDate, endDate);
    } else {
      // Get user's medications
      const userMedications = await Medication.find({
        $or: [
          { userId: req.user._id },
          { sharedWith: req.user._id }
        ],
        isActive: true
      }).select('_id');
      
      const medicationIds = userMedications.map(med => med._id);
      
      // Calculate overall adherence
      adherenceStats = await calculateOverallAdherence(req.user._id, medicationIds, startDate, endDate);
    }
    
    // Add time-based trends
    const adherenceTrends = await calculateAdherenceTrends(
      medicationId || null,
      req.user._id,
      startDate,
      endDate
    );
    
    res.status(200).json({
      status: 'success',
      period,
      dateRange: {
        start: startDate,
        end: endDate
      },
      adherenceStats,
      adherenceTrends
    });
  } catch (error) {
    logger.error('Error getting adherence stats:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get adherence statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
 };
 
 /**
 * Calculate adherence statistics for a specific medication
 */
 async function calculateMedicationAdherence(medicationId, startDate = null, endDate = null) {
  try {
    // Build query
    const query = { medicationId };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }
    
    // Get logs
    const logs = await MedicationLog.find(query);
    
    // Calculate stats
    const totalLogs = logs.length;
    const takenLogs = logs.filter(log => log.status === 'taken').length;
    const skippedLogs = logs.filter(log => log.status === 'skipped').length;
    const missedLogs = logs.filter(log => log.status === 'missed').length;
    
    const adherenceRate = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null;
    
    // Get streak information
    const { currentStreak, longestStreak } = calculateAdherenceStreaks(logs);
    
    return {
      totalLogs,
      takenLogs,
      skippedLogs,
      missedLogs,
      adherenceRate,
      currentStreak,
      longestStreak
    };
  } catch (error) {
    logger.error('Error calculating medication adherence:', error);
    throw error;
  }
 }
 
 /**
 * Calculate overall adherence statistics for multiple medications
 */
 async function calculateOverallAdherence(userId, medicationIds, startDate = null, endDate = null) {
  try {
    // Build query
    const query = {
      medicationId: { $in: medicationIds }
    };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }
    
    // Get logs
    const logs = await MedicationLog.find(query);
    
    // Calculate stats
    const totalLogs = logs.length;
    const takenLogs = logs.filter(log => log.status === 'taken').length;
    const skippedLogs = logs.filter(log => log.status === 'skipped').length;
    const missedLogs = logs.filter(log => log.status === 'missed').length;
    
    const adherenceRate = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null;
    
    // Get adherence by medication
    const adherenceByMedication = [];
    
    for (const medId of medicationIds) {
      const medLogs = logs.filter(log => log.medicationId.toString() === medId.toString());
      
      if (medLogs.length > 0) {
        const medTakenLogs = medLogs.filter(log => log.status === 'taken').length;
        const medAdherenceRate = Math.round((medTakenLogs / medLogs.length) * 100);
        
        const medication = await Medication.findById(medId).select('name dosage');
        
        if (medication) {
          adherenceByMedication.push({
            medicationId: medId,
            name: medication.name,
            dosage: medication.dosage,
            logsCount: medLogs.length,
            adherenceRate: medAdherenceRate
          });
        }
      }
    }
    
    // Sort by adherence rate (ascending)
    adherenceByMedication.sort((a, b) => a.adherenceRate - b.adherenceRate);
    
    return {
      totalLogs,
      takenLogs,
      skippedLogs,
      missedLogs,
      adherenceRate,
      adherenceByMedication
    };
  } catch (error) {
    logger.error('Error calculating overall adherence:', error);
    throw error;
  }
 }
 
 /**
 * Calculate time-based adherence trends
 */
 async function calculateAdherenceTrends(medicationId, userId, startDate, endDate) {
  try {
    // Build query
    const query = {};
    
    if (medicationId) {
      query.medicationId = medicationId;
    } else {
      // Get medications the user has access to
      const userMedications = await Medication.find({
        $or: [
          { userId },
          { sharedWith: userId }
        ]
      }).select('_id');
      
      query.medicationId = { $in: userMedications.map(med => med._id) };
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }
    
    // Get logs
    const logs = await MedicationLog.find(query).sort({ createdAt: 1 });
    
    // Analyze time of day trends
    const timeOfDayTrends = analyzeTimeOfDayTrends(logs);
    
    // Analyze day of week trends
    const dayOfWeekTrends = analyzeDayOfWeekTrends(logs);
    
    // Analyze weekly trends
    const weeklyTrends = analyzeWeeklyTrends(logs);
    
    return {
      timeOfDayTrends,
      dayOfWeekTrends,
      weeklyTrends
    };
  } catch (error) {
    logger.error('Error calculating adherence trends:', error);
    throw error;
  }
 }
 
 /**
 * Analyze time of day adherence trends
 */
 function analyzeTimeOfDayTrends(logs) {
  // Define time periods
  const periods = {
    morning: { start: 5, end: 11, total: 0, taken: 0 },
    afternoon: { start: 12, end: 16, total: 0, taken: 0 },
    evening: { start: 17, end: 20, total: 0, taken: 0 },
    night: { start: 21, end: 4, total: 0, taken: 0 }
  };
  
  // Count logs by period
  logs.forEach(log => {
    const hour = log.scheduledTime ? new Date(log.scheduledTime).getHours() : 
               (log.takenTime ? new Date(log.takenTime).getHours() : 
               new Date(log.createdAt).getHours());
    
    let period;
    if (hour >= periods.morning.start && hour <= periods.morning.end) {
      period = 'morning';
    } else if (hour >= periods.afternoon.start && hour <= periods.afternoon.end) {
      period = 'afternoon';
    } else if (hour >= periods.evening.start && hour <= periods.evening.end) {
      period = 'evening';
    } else {
      period = 'night';
    }
    
    periods[period].total++;
    if (log.status === 'taken') {
      periods[period].taken++;
    }
  });
  
  // Calculate adherence rates
  Object.keys(periods).forEach(key => {
    periods[key].adherenceRate = periods[key].total > 0 ? 
      Math.round((periods[key].taken / periods[key].total) * 100) : null;
  });
  
  // Find most problematic period
  let lowestAdherence = { period: null, rate: 100 };
  
  Object.keys(periods).forEach(key => {
    if (periods[key].total >= 5 && periods[key].adherenceRate !== null && 
        periods[key].adherenceRate < lowestAdherence.rate) {
      lowestAdherence = { period: key, rate: periods[key].adherenceRate };
    }
  });
  
  return {
    periods,
    mostProblematicPeriod: lowestAdherence.period ? {
      period: lowestAdherence.period,
      adherenceRate: lowestAdherence.rate
    } : null
  };
}


/*
* Analyze day of week adherence trends
*/
function analyzeDayOfWeekTrends(logs) {
// Define days
const days = {
  sunday: { total: 0, taken: 0 },
  monday: { total: 0, taken: 0 },
  tuesday: { total: 0, taken: 0 },
  wednesday: { total: 0, taken: 0 },
  thursday: { total: 0, taken: 0 },
  friday: { total: 0, taken: 0 },
  saturday: { total: 0, taken: 0 }
};

// Day names for mapping day number to name
const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Count logs by day
logs.forEach(log => {
  const date = log.scheduledTime ? new Date(log.scheduledTime) : 
             (log.takenTime ? new Date(log.takenTime) : 
             new Date(log.createdAt));
  
  const day = dayNames[date.getDay()];
  
  days[day].total++;
  if (log.status === 'taken') {
    days[day].taken++;
  }
});

// Calculate adherence rates
Object.keys(days).forEach(key => {
  days[key].adherenceRate = days[key].total > 0 ? 
    Math.round((days[key].taken / days[key].total) * 100) : null;
});

// Find most problematic day
let lowestAdherence = { day: null, rate: 100 };

Object.keys(days).forEach(key => {
  if (days[key].total >= 3 && days[key].adherenceRate !== null && 
      days[key].adherenceRate < lowestAdherence.rate) {
    lowestAdherence = { day: key, rate: days[key].adherenceRate };
  }
});

// Check for weekday vs weekend pattern
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const weekend = ['saturday', 'sunday'];

let weekdayTotal = 0, weekdayTaken = 0;
let weekendTotal = 0, weekendTaken = 0;

weekdays.forEach(day => {
  weekdayTotal += days[day].total;
  weekdayTaken += days[day].taken;
});

weekend.forEach(day => {
  weekendTotal += days[day].total;
  weekendTaken += days[day].taken;
});

const weekdayRate = weekdayTotal > 0 ? Math.round((weekdayTaken / weekdayTotal) * 100) : null;
const weekendRate = weekendTotal > 0 ? Math.round((weekendTaken / weekendTotal) * 100) : null;

return {
  days,
  mostProblematicDay: lowestAdherence.day ? {
    day: lowestAdherence.day,
    adherenceRate: lowestAdherence.rate
  } : null,
  weekdayVsWeekend: {
    weekday: { total: weekdayTotal, taken: weekdayTaken, adherenceRate: weekdayRate },
    weekend: { total: weekendTotal, taken: weekendTaken, adherenceRate: weekendRate },
    difference: weekdayRate !== null && weekendRate !== null ? weekdayRate - weekendRate : null
  }
};
}

/**
* Analyze weekly adherence trends
*/
function analyzeWeeklyTrends(logs) {
if (logs.length === 0) return { weeks: [] };

// Group logs by week
const weeks = {};

logs.forEach(log => {
  const date = log.scheduledTime ? new Date(log.scheduledTime) : 
             (log.takenTime ? new Date(log.takenTime) : 
             new Date(log.createdAt));
  
  // Get week number (ISO week)
  const weekKey = getWeekKey(date);
  
  if (!weeks[weekKey]) {
    weeks[weekKey] = {
      week: weekKey,
      startDate: getWeekStartDate(date),
      total: 0,
      taken: 0
    };
  }
  
  weeks[weekKey].total++;
  if (log.status === 'taken') {
    weeks[weekKey].taken++;
  }
});

// Calculate adherence rates and convert to array
const weeksArray = Object.values(weeks).map(week => {
  return {
    ...week,
    adherenceRate: week.total > 0 ? Math.round((week.taken / week.total) * 100) : null
  };
});

// Sort by date
weeksArray.sort((a, b) => a.startDate - b.startDate);

// Calculate trend (improving, declining, stable)
let trend = 'stable';

if (weeksArray.length >= 3) {
  const firstWeeks = weeksArray.slice(0, Math.ceil(weeksArray.length / 2));
  const lastWeeks = weeksArray.slice(-Math.ceil(weeksArray.length / 2));
  
  const firstWeeksAvg = firstWeeks.reduce((sum, week) => sum + (week.adherenceRate || 0), 0) / firstWeeks.length;
  const lastWeeksAvg = lastWeeks.reduce((sum, week) => sum + (week.adherenceRate || 0), 0) / lastWeeks.length;
  
  const difference = lastWeeksAvg - firstWeeksAvg;
  
  if (difference >= 5) {
    trend = 'improving';
  } else if (difference <= -5) {
    trend = 'declining';
  } else {
    trend = 'stable';
  }
}

return {
  weeks: weeksArray,
  trend,
  currentWeekRate: weeksArray.length > 0 ? weeksArray[weeksArray.length - 1].adherenceRate : null
};
}

/**
* Calculate adherence streaks
*/
function calculateAdherenceStreaks(logs) {
if (logs.length === 0) {
  return { currentStreak: 0, longestStreak: 0 };
}

// Sort logs chronologically (newest first)
const sortedLogs = [...logs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

// Calculate current streak
let currentStreak = 0;
for (const log of sortedLogs) {
  if (log.status === 'taken') {
    currentStreak++;
  } else {
    break;
  }
}

// Calculate longest streak
let longestStreak = 0;
let currentRun = 0;

for (const log of [...logs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
  if (log.status === 'taken') {
    currentRun++;
    longestStreak = Math.max(longestStreak, currentRun);
  } else {
    currentRun = 0;
  }
}

return { currentStreak, longestStreak };
}

/**
* Get week identifier (YYYY-WW)
*/
function getWeekKey(date) {
const d = new Date(date);
const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
const pastDaysOfYear = (d - firstDayOfYear) / 86400000;
const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
return `${d.getFullYear()}-${weekNumber.toString().padStart(2, '0')}`;
}

/**
* Get the start date of a week containing the given date
*/
function getWeekStartDate(date) {
const d = new Date(date);
const day = d.getDay();
const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
return new Date(d.setDate(diff));
}