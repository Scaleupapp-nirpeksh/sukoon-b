// controllers/MedicationAnalyticsController.js
const mongoose = require('mongoose');
const Medication = require('../models/medicationModel');
const MedicationLog = require('../models/MedicationLog');
const MedicationSchedule = require('../models/MedicationSchedule');
const { VitalSign, HealthCheckIn } = require('../models/healthModel');
const logger = require('../utils/logger');
const { OpenAI } = require('openai');

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Get detailed adherence analytics
 * @route GET /api/medications/analytics/adherence
 */
exports.getAdherenceAnalytics = async (req, res) => {
  try {
    const { period = '30days', medicationId, includeChartData = 'true' } = req.query;
    
    // Determine date range based on period
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
    
    // Build query
    const query = { 
      userId: req.user._id,
      createdAt: { $gte: startDate, $lte: endDate }
    };

/**
 * Get adherence improvement recommendations
 * @route GET /api/medications/analytics/recommendations
 */
exports.getAdherenceRecommendations = async (req, res) => {
  try {
    // Get the user's adherence data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Get medication logs
    const logs = await MedicationLog.find({
      userId: req.user._id,
      createdAt: { $gte: thirtyDaysAgo }
    }).populate('medicationId', 'name genericName dosage frequency');
    
    // Calculate adherence stats
    const totalLogs = logs.length;
    const takenLogs = logs.filter(log => log.status === 'taken').length;
    const missedLogs = logs.filter(log => log.status === 'missed').length;
    const adherenceRate = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null;
    
    // Skip calculation if too few logs
    if (totalLogs < 5) {
      return res.status(200).json({
        status: 'success',
        message: 'Insufficient data for recommendations',
        recommendations: [
          {
            type: 'general',
            priority: 'medium',
            recommendation: 'Continue logging your medications to receive personalized adherence recommendations.'
          }
        ]
      });
    }
    
    // Calculate missed dose patterns
    const missedDosePatterns = analyzeMissedDosePatterns(logs);
    
    // Generate recommendations based on patterns
    const recommendations = generateAdherenceRecommendations(logs, missedDosePatterns, adherenceRate);
    
    res.status(200).json({
      status: 'success',
      adherenceRate,
      logsAnalyzed: totalLogs,
      recommendations: recommendations.sort((a, b) => {
        const priorityRank = { high: 1, medium: 2, low: 3 };
        return priorityRank[a.priority] - priorityRank[b.priority];
      })
    });
  } catch (error) {
    logger.error('Error getting adherence recommendations:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get adherence recommendations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper functions

/**
 * Calculate adherence streaks from medication logs
 */
function calculateAdherenceStreaks(logs) {
  if (!logs || logs.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }
  
  // Sort logs by date (newest first)
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
  
  // Sort logs chronologically for longest streak calculation
  const chronologicalLogs = [...logs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  
  for (const log of chronologicalLogs) {
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
 * Analyze missed dose patterns
 */
function analyzeMissedDosePatterns(logs) {
  if (!logs || logs.length === 0) {
    return { byDayOfWeek: {}, byTimeOfDay: {}, byMedication: {} };
  }
  
  // Filter for missed or skipped doses
  const missedLogs = logs.filter(log => log.status === 'missed' || log.status === 'skipped');
  
  // Initialize results
  const byDayOfWeek = {
    sunday: 0, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0
  };
  
  const byTimeOfDay = {
    morning: 0, afternoon: 0, evening: 0, night: 0
  };
  
  const byMedication = {};
  
  // Count missed doses by day of week
  missedLogs.forEach(log => {
    // By day of week
    const dayOfWeek = new Date(log.createdAt).getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    byDayOfWeek[dayNames[dayOfWeek]]++;
    
    // By time of day
    const hour = new Date(log.scheduledTime || log.createdAt).getHours();
    if (hour >= 5 && hour < 12) {
      byTimeOfDay.morning++;
    } else if (hour >= 12 && hour < 17) {
      byTimeOfDay.afternoon++;
    } else if (hour >= 17 && hour < 21) {
      byTimeOfDay.evening++;
    } else {
      byTimeOfDay.night++;
    }
    
    // By medication
    const medId = log.medicationId && typeof log.medicationId === 'object' 
      ? log.medicationId._id.toString()
      : (log.medicationId ? log.medicationId.toString() : 'unknown');
    
    if (!byMedication[medId]) {
      byMedication[medId] = {
        medicationId: medId,
        name: log.medicationId?.name || 'Unknown Medication',
        missedCount: 0,
        totalLogs: 0,
        missRate: 0
      };
    }
    
    byMedication[medId].missedCount++;
  });
  
  // Calculate total logs per medication for miss rate
  logs.forEach(log => {
    const medId = log.medicationId && typeof log.medicationId === 'object'
      ? log.medicationId._id.toString()
      : (log.medicationId ? log.medicationId.toString() : 'unknown');
    
    if (byMedication[medId]) {
      byMedication[medId].totalLogs++;
      byMedication[medId].missRate = Math.round((byMedication[medId].missedCount / byMedication[medId].totalLogs) * 100);
    }
  });
  
  // Find worst day of week
  const worstDay = Object.entries(byDayOfWeek)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count > 0)[0];
  
  // Find worst time of day
  const worstTime = Object.entries(byTimeOfDay)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count > 0)[0];
  
  // Find worst medication
  const worstMedication = Object.values(byMedication)
    .sort((a, b) => b.missRate - a.missRate)
    .filter(med => med.missRate > 0)[0];
  
  return {
    byDayOfWeek,
    byTimeOfDay,
    byMedication: Object.values(byMedication),
    worstDay: worstDay ? { day: worstDay[0], count: worstDay[1] } : null,
    worstTime: worstTime ? { timeOfDay: worstTime[0], count: worstTime[1] } : null,
    worstMedication: worstMedication || null
  };
}

/**
 * Generate insights based on adherence data
 */
function generateAdherenceInsights(data) {
  const insights = [];
  
  // Only generate insights if we have data
  if (!data) return insights;
  
  // Overall adherence insight
  if (data.adherenceRate !== null) {
    if (data.adherenceRate >= 90) {
      insights.push({
        type: 'overall',
        insight: `Your overall medication adherence is excellent at ${data.adherenceRate}%. Keep up the great work!`
      });
    } else if (data.adherenceRate >= 80) {
      insights.push({
        type: 'overall',
        insight: `Your overall medication adherence is good at ${data.adherenceRate}%. There's still room for improvement.`
      });
    } else if (data.adherenceRate >= 70) {
      insights.push({
        type: 'overall',
        insight: `Your overall medication adherence is fair at ${data.adherenceRate}%. Consider setting reminders to improve.`
      });
    } else {
      insights.push({
        type: 'overall',
        insight: `Your overall medication adherence is ${data.adherenceRate}%, which could be improved. Consider discussing barriers with your healthcare provider.`
      });
    }
  }
  
  // Streak insights
  if (data.currentStreak && data.currentStreak > 3) {
    insights.push({
      type: 'streak',
      insight: `You're on a ${data.currentStreak}-day streak of taking your medications! Great consistency.`
    });
  }
  
  if (data.longestStreak && data.longestStreak > 7) {
    insights.push({
      type: 'streak',
      insight: `Your longest streak of taking medications consistently is ${data.longestStreak} days. That's impressive!`
    });
  }
  
  // Day of week insights
  if (data.dayOfWeekAdherence) {
    // Find best and worst days
    const bestDay = [...data.dayOfWeekAdherence]
      .filter(day => day.total >= 3)
      .sort((a, b) => b.adherenceRate - a.adherenceRate)[0];
    
    const worstDay = [...data.dayOfWeekAdherence]
      .filter(day => day.total >= 3)
      .sort((a, b) => a.adherenceRate - b.adherenceRate)[0];
    
    if (bestDay && worstDay && bestDay.adherenceRate - worstDay.adherenceRate > 20) {
      insights.push({
        type: 'dayOfWeek',
        insight: `Your adherence is best on ${bestDay.name}s (${bestDay.adherenceRate}%) and lowest on ${worstDay.name}s (${worstDay.adherenceRate}%). Consider additional reminders on ${worstDay.name}s.`
      });
    }
  }
  
  // Time of day insights
  if (data.timeOfDayAdherence) {
    // Find best and worst times
    const bestTime = [...data.timeOfDayAdherence]
      .filter(time => time.total >= 3)
      .sort((a, b) => b.adherenceRate - a.adherenceRate)[0];
    
    const worstTime = [...data.timeOfDayAdherence]
      .filter(time => time.total >= 3)
      .sort((a, b) => a.adherenceRate - b.adherenceRate)[0];
    
    if (bestTime && worstTime && bestTime.adherenceRate - worstTime.adherenceRate > 20) {
      insights.push({
        type: 'timeOfDay',
        insight: `You're most consistent with ${bestTime.timeOfDay} medications (${bestTime.adherenceRate}%) and least consistent with ${worstTime.timeOfDay} medications (${worstTime.adherenceRate}%).`
      });
    }
  }
  
  // Medication-specific insights
  if (data.medicationAdherence && data.medicationAdherence.length > 0) {
    // Get medications with lowest adherence
    const lowestAdherenceMeds = data.medicationAdherence
      .filter(med => med.total >= 5)
      .slice(0, 2);
    
    if (lowestAdherenceMeds.length > 0 && lowestAdherenceMeds[0].adherenceRate < 70) {
      insights.push({
        type: 'medication',
        insight: `${lowestAdherenceMeds[0].name} has the lowest adherence rate (${lowestAdherenceMeds[0].adherenceRate}%). Consider discussing any issues with this medication with your healthcare provider.`
      });
    }
  }
  
  // Missed dose pattern insights
  if (data.missedDosePatterns) {
    if (data.missedDosePatterns.worstDay) {
      insights.push({
        type: 'missedDoses',
        insight: `You most frequently miss doses on ${data.missedDosePatterns.worstDay.day}s. Setting up additional reminders for this day could help.`
      });
    }
    
    if (data.missedDosePatterns.worstTime) {
      insights.push({
        type: 'missedDoses',
        insight: `${data.missedDosePatterns.worstTime.timeOfDay} doses are missed most often. Try linking these medications to a consistent daily activity.`
      });
    }
  }
  
  return insights;
}

/**
 * Generate adherence recommendations
 */
function generateAdherenceRecommendations(logs, missedDosePatterns, adherenceRate) {
  const recommendations = [];
  
  // Add general recommendations based on adherence rate
  if (adherenceRate === null || adherenceRate < 50) {
    recommendations.push({
      type: 'general',
      priority: 'high',
      recommendation: 'Consider discussing medication adherence challenges with your healthcare provider to develop personalized strategies.'
    });
  }
  
  if (adherenceRate !== null && adherenceRate < 80) {
    recommendations.push({
      type: 'reminder',
      priority: 'high',
      recommendation: 'Set up medication reminders for all your medications to receive timely notifications.'
    });
  }
  
  // Add recommendations based on missed dose patterns
  if (missedDosePatterns.worstDay) {
    recommendations.push({
      type: 'schedule',
      priority: 'medium',
      recommendation: `You tend to miss doses more on ${missedDosePatterns.worstDay.day}s. Consider setting additional reminders or alarms specifically for this day.`
    });
  }
  
  if (missedDosePatterns.worstTime) {
    const timeRecommendation = getTimeOfDayRecommendation(missedDosePatterns.worstTime.timeOfDay);
    recommendations.push({
      type: 'routine',
      priority: 'medium',
      recommendation: timeRecommendation
    });
  }
  
  if (missedDosePatterns.worstMedication) {
    recommendations.push({
      type: 'medication',
      priority: 'high',
      recommendation: `You have trouble remembering to take ${missedDosePatterns.worstMedication.name} (${missedDosePatterns.worstMedication.missRate}% missed). Try placing this medication in a visible location or setting specific reminders for it.`,
      medicationId: missedDosePatterns.worstMedication.medicationId
    });
  }
  
  // Check for weekend vs weekday patterns
  let weekdayMissed = 0;
  let weekendMissed = 0;
  
  if (missedDosePatterns.byDayOfWeek) {
    weekdayMissed = 
      missedDosePatterns.byDayOfWeek.monday + 
      missedDosePatterns.byDayOfWeek.tuesday + 
      missedDosePatterns.byDayOfWeek.wednesday + 
      missedDosePatterns.byDayOfWeek.thursday + 
      missedDosePatterns.byDayOfWeek.friday;
    
    weekendMissed = 
      missedDosePatterns.byDayOfWeek.saturday + 
      missedDosePatterns.byDayOfWeek.sunday;
    
    const avgWeekdayMissed = weekdayMissed / 5;
    const avgWeekendMissed = weekendMissed / 2;
    
    if (avgWeekendMissed > avgWeekdayMissed * 1.5) {
      recommendations.push({
        type: 'schedule',
        priority: 'medium',
        recommendation: 'You miss more doses on weekends than weekdays. Consider setting up a weekend routine or additional weekend reminders.'
      });
    }
  }
  
  // Add general improvement strategies based on log data
  const takenLogs = logs.filter(log => log.status === 'taken');
  const skippedLogs = logs.filter(log => log.status === 'skipped');
  const missedLogs = logs.filter(log => log.status === 'missed');
  
  if (skippedLogs.length > takenLogs.length * 0.2) {
    recommendations.push({
      type: 'engagement',
      priority: 'medium',
      recommendation: 'You frequently skip doses. Consider discussing with your healthcare provider whether your medication schedule could be simplified.'
    });
  }
  
  if (logs.length > 0 && takenLogs.length === 0) {
    recommendations.push({
      type: 'engagement',
      priority: 'high',
      recommendation: 'It appears you haven\'t marked any medications as taken. Remember to log when you take your medications to track your adherence accurately.'
    });
  }
  
  // Add general recommendations if we don't have many specific ones
  if (recommendations.length < 2) {
    recommendations.push({
      type: 'routine',
      priority: 'medium',
      recommendation: 'Try to take your medications at the same time each day, and link them to daily activities like brushing your teeth or having meals.'
    });
    
    recommendations.push({
      type: 'organization',
      priority: 'low',
      recommendation: 'Use a pill organizer to pre-sort your medications for the week, making it easier to remember and confirm you\'ve taken them.'
    });
  }
  
  return recommendations;
}

/**
 * Get specific recommendations based on time of day
 */
function getTimeOfDayRecommendation(timeOfDay) {
  switch (timeOfDay) {
    case 'morning':
      return 'You tend to miss morning medications. Try taking them right after waking up or with breakfast to build a consistent routine.';
    case 'afternoon':
      return 'You tend to miss afternoon medications. Consider setting an alarm for your lunch break or linking these doses to a mid-day activity.';
    case 'evening':
      return 'You tend to miss evening medications. Try taking them with dinner or as part of your evening routine to improve consistency.';
    case 'night':
      return 'You tend to miss night medications. Place these medications by your bed or bathroom sink as a visual reminder before sleep.';
    default:
      return 'Link your medications to specific daily activities to build a consistent routine.';
  }
}

/**
 * Format adherence data for AI analysis
 */
function formatAdherenceDataForAI(logs, schedules) {
  // Calculate adherence rate
  const totalLogs = logs.length;
  const takenLogs = logs.filter(log => log.status === 'taken').length;
  const adherenceRate = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null;
  
  // Analyze patterns
  const missedDosePatterns = analyzeMissedDosePatterns(logs);
  
  // Format medication schedules
  const medicationSchedules = schedules.map(schedule => ({
    medicationId: schedule.medicationId._id.toString(),
    medicationName: schedule.medicationId.name,
    scheduleType: schedule.scheduleType,
    times: schedule.times.map(time => `${time.hour}:${time.minute}`),
    daysOfWeek: schedule.daysOfWeek
  }));
  
  // Format data for AI
  return {
    adherenceRate,
    totalLogs,
    takenLogs,
    missedLogs: logs.filter(log => log.status === 'missed').length,
    skippedLogs: logs.filter(log => log.status === 'skipped').length,
    missedPatterns: {
      byDayOfWeek: missedDosePatterns.byDayOfWeek,
      byTimeOfDay: missedDosePatterns.byTimeOfDay,
      worstDay: missedDosePatterns.worstDay,
      worstTime: missedDosePatterns.worstTime,
      worstMedication: missedDosePatterns.worstMedication
    },
    medicationSchedules
  };
}

/**
 * Get predictive insights from AI
 */
async function getPredictiveInsightsFromAI(adherenceData) {
  try {
    const prompt = `
      Analyze this medication adherence data and provide 3-5 personalized, actionable insights to help improve adherence.
      Also identify the top risk factors for non-adherence and prioritize your suggestions based on impact.
      
      DATA:
      ${JSON.stringify(adherenceData, null, 2)}
      
      Return a JSON object with the following structure:
      {
        "insights": ["Insight 1", "Insight 2", "Insight 3"],
        "riskFactors": [
          {"factor": "Factor 1", "risk": "high/medium/low"},
          {"factor": "Factor 2", "risk": "high/medium/low"}
        ],
        "suggestionPriority": ["Most important suggestion", "Second most important", "Third most important"]
      }
    `;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a medication adherence expert providing accurate, personalized insights." },
        { role: "user", content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 600
    });
    
    const response = JSON.parse(completion.choices[0].message.content.trim());
    return response;
  } catch (error) {
    logger.error('Error getting AI insights:', error);
    return {
      insights: [
        "Based on your patterns, you would benefit from setting reminders for medications you frequently miss.",
        "Consider linking your medication times to daily activities like meals or brushing teeth.",
        "Your adherence could improve by using a pill organizer to visually track your doses."
      ],
      riskFactors: [
        { factor: "Inconsistent schedule", risk: "high" },
        { factor: "Multiple medications", risk: "medium" },
        { factor: "Complex dosing regimen", risk: "medium" }
      ],
      suggestionPriority: [
        "Set up automated reminders for all medications",
        "Use a pill organizer for visual tracking",
        "Create a consistent daily medication routine"
      ]
    };
  }
}

/**
 * Calculate adherence vs feeling correlation
 */
function calculateAdherenceFeelingCorrelation(combinedData) {
  // Filter data points that have both adherence and feeling
  const dataPoints = combinedData.filter(d => d.adherence !== null && d.feeling !== null);
  
  if (dataPoints.length < 5) return null; // Not enough data
  
  // Convert feelings to numeric values
  const num
    
    // Add medicationId if provided
    if (medicationId) {
      // Verify user has access to the medication
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
      
      query.medicationId = medicationId;
    } else {
      // Get all medications the user has access to
      const medications = await Medication.find({
        $or: [
          { userId: req.user._id },
          { sharedWith: req.user._id }
        ],
        isActive: true
      }).select('_id');
      
      query.medicationId = { $in: medications.map(med => med._id) };
    }
    
    // Get logs with the query
    const logs = await MedicationLog.find(query)
      .sort({ createdAt: 1 })
      .populate('medicationId', 'name genericName dosage frequency');
    
    // Calculate overall adherence metrics
    const totalLogs = logs.length;
    const takenLogs = logs.filter(log => log.status === 'taken').length;
    const skippedLogs = logs.filter(log => log.status === 'skipped').length;
    const missedLogs = logs.filter(log => log.status === 'missed').length;
    
    const adherenceRate = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null;
    
    // Calculate adherence by medication
    const medicationMap = {};
    logs.forEach(log => {
      const medId = log.medicationId?._id?.toString() || 'unknown';
      if (!medicationMap[medId]) {
        medicationMap[medId] = {
          medicationId: medId,
          name: log.medicationId?.name || 'Unknown Medication',
          total: 0,
          taken: 0,
          skipped: 0,
          missed: 0,
          adherenceRate: 0
        };
      }
      
      medicationMap[medId].total++;
      if (log.status === 'taken') medicationMap[medId].taken++;
      if (log.status === 'skipped') medicationMap[medId].skipped++;
      if (log.status === 'missed') medicationMap[medId].missed++;
    });
    
    // Calculate adherence rates for each medication
    Object.values(medicationMap).forEach(med => {
      med.adherenceRate = med.total > 0 ? Math.round((med.taken / med.total) * 100) : null;
    });
    
    // Sort medications by adherence rate (ascending)
    const medicationAdherence = Object.values(medicationMap).sort((a, b) => a.adherenceRate - b.adherenceRate);
    
    // Calculate adherence by day of week
    const dayOfWeekMap = {
      0: { name: 'Sunday', total: 0, taken: 0 },
      1: { name: 'Monday', total: 0, taken: 0 },
      2: { name: 'Tuesday', total: 0, taken: 0 },
      3: { name: 'Wednesday', total: 0, taken: 0 },
      4: { name: 'Thursday', total: 0, taken: 0 },
      5: { name: 'Friday', total: 0, taken: 0 },
      6: { name: 'Saturday', total: 0, taken: 0 }
    };
    
    logs.forEach(log => {
      const dayOfWeek = new Date(log.createdAt).getDay();
      dayOfWeekMap[dayOfWeek].total++;
      if (log.status === 'taken') dayOfWeekMap[dayOfWeek].taken++;
    });
    
    // Calculate adherence rates for each day of week
    const dayOfWeekAdherence = Object.values(dayOfWeekMap).map(day => ({
      ...day,
      adherenceRate: day.total > 0 ? Math.round((day.taken / day.total) * 100) : null
    }));
    
    // Calculate adherence by time of day
    const timeOfDayMap = {
      morning: { total: 0, taken: 0 },
      afternoon: { total: 0, taken: 0 },
      evening: { total: 0, taken: 0 },
      night: { total: 0, taken: 0 }
    };
    
    logs.forEach(log => {
      let timeOfDay;
      const hour = new Date(log.createdAt).getHours();
      
      if (hour >= 5 && hour < 12) timeOfDay = 'morning';
      else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
      else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
      else timeOfDay = 'night';
      
      timeOfDayMap[timeOfDay].total++;
      if (log.status === 'taken') timeOfDayMap[timeOfDay].taken++;
    });
    
    // Calculate adherence rates for each time of day
    const timeOfDayAdherence = Object.entries(timeOfDayMap).map(([timeOfDay, data]) => ({
      timeOfDay,
      total: data.total,
      taken: data.taken,
      adherenceRate: data.total > 0 ? Math.round((data.taken / data.total) * 100) : null
    }));
    
    // Calculate adherence trends over time
    const adherenceTrends = {};
    
    if (includeChartData === 'true') {
      // Group by day
      const dailyMap = {};
      
      logs.forEach(log => {
        const date = new Date(log.createdAt);
        const dateString = date.toISOString().split('T')[0];
        
        if (!dailyMap[dateString]) {
          dailyMap[dateString] = { date: dateString, total: 0, taken: 0 };
        }
        
        dailyMap[dateString].total++;
        if (log.status === 'taken') dailyMap[dateString].taken++;
      });
      
      // Convert to array and calculate rates
      adherenceTrends.days = Object.values(dailyMap).map(day => ({
        ...day,
        adherenceRate: day.total > 0 ? Math.round((day.taken / day.total) * 100) : null
      })).sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // Group by week
      const weeklyMap = {};
      
      logs.forEach(log => {
        const date = new Date(log.createdAt);
        const weekNum = getWeekNumber(date);
        const weekKey = `${date.getFullYear()}-W${weekNum}`;
        
        if (!weeklyMap[weekKey]) {
          weeklyMap[weekKey] = { 
            week: weekKey, 
            weekStart: getFirstDayOfWeek(date).toISOString().split('T')[0],
            total: 0, 
            taken: 0 
          };
        }
        
        weeklyMap[weekKey].total++;
        if (log.status === 'taken') weeklyMap[weekKey].taken++;
      });
      
      // Convert to array and calculate rates
      adherenceTrends.weeks = Object.values(weeklyMap).map(week => ({
        ...week,
        adherenceRate: week.total > 0 ? Math.round((week.taken / week.total) * 100) : null
      })).sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart));
      
      // Group by month
      const monthlyMap = {};
      
      logs.forEach(log => {
        const date = new Date(log.createdAt);
        const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
        
        if (!monthlyMap[monthKey]) {
          monthlyMap[monthKey] = { 
            month: monthKey, 
            monthName: date.toLocaleString('default', { month: 'long' }),
            year: date.getFullYear(),
            total: 0, 
            taken: 0 
          };
        }
        
        monthlyMap[monthKey].total++;
        if (log.status === 'taken') monthlyMap[monthKey].taken++;
      });
      
      // Convert to array and calculate rates
      adherenceTrends.months = Object.values(monthlyMap).map(month => ({
        ...month,
        adherenceRate: month.total > 0 ? Math.round((month.taken / month.total) * 100) : null
      })).sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return parseInt(a.month.split('-')[1]) - parseInt(b.month.split('-')[1]);
      });
    }
    
    // Calculate streaks
    const { currentStreak, longestStreak } = calculateAdherenceStreaks(logs);
    
    // Calculate missed dose patterns
    const missedDosePatterns = analyzeMissedDosePatterns(logs);
    
    // Generate insights if enough data
    let insights = [];
    if (totalLogs > 10) {
      insights = generateAdherenceInsights({
        adherenceRate,
        medicationAdherence,
        dayOfWeekAdherence,
        timeOfDayAdherence,
        currentStreak,
        longestStreak,
        missedDosePatterns
      });
    }
    
    res.status(200).json({
      status: 'success',
      period,
      dateRange: {
        start: startDate,
        end: endDate
      },
      overview: {
        totalLogs,
        takenLogs,
        skippedLogs,
        missedLogs,
        adherenceRate,
        currentStreak,
        longestStreak
      },
      medicationAdherence,
      dayOfWeekAdherence,
      timeOfDayAdherence,
      missedDosePatterns,
      adherenceTrends: includeChartData === 'true' ? adherenceTrends : null,
      insights
    });
  } catch (error) {
    logger.error('Error getting adherence analytics:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get adherence analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get medication consumption patterns
 * @route GET /api/medications/analytics/consumption
 */
exports.getMedicationConsumptionPatterns = async (req, res) => {
  try {
    const { period = '90days', medicationId } = req.query;
    
    // Determine date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    switch(period) {
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
        startDate.setDate(startDate.getDate() - 90);
    }
    
    // Build query for medication logs
    const logsQuery = {
      userId: req.user._id,
      status: 'taken', // Only consider taken medications for consumption analysis
      createdAt: { $gte: startDate, $lte: endDate }
    };
    
    if (medicationId) {
      // Verify medication access
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
      
      logsQuery.medicationId = medicationId;
    }
    
    // Get logs
    const logs = await MedicationLog.find(logsQuery)
      .sort({ createdAt: 1 })
      .populate('medicationId', 'name genericName dosage frequency');
    
    // Group logs by medication
    const medicationMap = {};
    
    logs.forEach(log => {
      const medId = log.medicationId?._id?.toString() || 'unknown';
      
      if (!medicationMap[medId]) {
        medicationMap[medId] = {
          medicationId: medId,
          name: log.medicationId?.name || 'Unknown Medication',
          logs: [],
          dosesCount: 0,
          consumptionByTimeOfDay: {
            morning: 0,  // 5am - 12pm
            afternoon: 0, // 12pm - 5pm
            evening: 0, // 5pm - 9pm
            night: 0 // 9pm - 5am
          },
          consumptionByDayOfWeek: {
            sunday: 0,
            monday: 0,
            tuesday: 0,
            wednesday: 0,
            thursday: 0,
            friday: 0,
            saturday: 0
          },
          averageTimeBetweenDoses: null,
          intervalVariance: null
        };
      }
      
      medicationMap[medId].logs.push(log);
      medicationMap[medId].dosesCount++;
      
      // Count by time of day
      const hour = new Date(log.takenTime || log.createdAt).getHours();
      if (hour >= 5 && hour < 12) {
        medicationMap[medId].consumptionByTimeOfDay.morning++;
      } else if (hour >= 12 && hour < 17) {
        medicationMap[medId].consumptionByTimeOfDay.afternoon++;
      } else if (hour >= 17 && hour < 21) {
        medicationMap[medId].consumptionByTimeOfDay.evening++;
      } else {
        medicationMap[medId].consumptionByTimeOfDay.night++;
      }
      
      // Count by day of week
      const dayOfWeek = new Date(log.takenTime || log.createdAt).getDay();
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      medicationMap[medId].consumptionByDayOfWeek[dayNames[dayOfWeek]]++;
    });
    
    // Calculate time intervals between doses for each medication
    Object.values(medicationMap).forEach(med => {
      if (med.logs.length < 2) return;
      
      // Sort logs by taken time
      const sortedLogs = [...med.logs].sort((a, b) => 
        new Date(a.takenTime || a.createdAt) - new Date(b.takenTime || b.createdAt)
      );
      
      // Calculate time intervals
      const intervals = [];
      for (let i = 1; i < sortedLogs.length; i++) {
        const prevTime = new Date(sortedLogs[i-1].takenTime || sortedLogs[i-1].createdAt);
        const currentTime = new Date(sortedLogs[i].takenTime || sortedLogs[i].createdAt);
        
        const intervalHours = (currentTime - prevTime) / (1000 * 60 * 60);
        intervals.push(intervalHours);
      }
      
      // Calculate average interval
      const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
      med.averageTimeBetweenDoses = Math.round(avgInterval * 10) / 10; // Round to 1 decimal
      
      // Calculate variance
      const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
      med.intervalVariance = Math.round(Math.sqrt(variance) * 10) / 10; // Round to 1 decimal
      
      // Check for double dosing instances (doses taken too close together)
      med.doubleDosing = {
        count: intervals.filter(interval => interval < 8).length,
        instances: []
      };
      
      for (let i = 1; i < sortedLogs.length; i++) {
        const prevTime = new Date(sortedLogs[i-1].takenTime || sortedLogs[i-1].createdAt);
        const currentTime = new Date(sortedLogs[i].takenTime || sortedLogs[i].createdAt);
        
        const intervalHours = (currentTime - prevTime) / (1000 * 60 * 60);
        if (intervalHours < 8) {
          med.doubleDosing.instances.push({
            firstDose: prevTime,
            secondDose: currentTime,
            intervalHours: Math.round(intervalHours * 10) / 10
          });
        }
      }
      
      // Remove the logs to reduce response size
      delete med.logs;
    });
    
    // Sort medications by doses count
    const medicationPatterns = Object.values(medicationMap).sort((a, b) => b.dosesCount - a.dosesCount);
    
    // Generate insights for each medication
    const insights = [];
    
    medicationPatterns.forEach(med => {
      // Find preferred time of day
      const timeOfDay = Object.entries(med.consumptionByTimeOfDay)
        .sort((a, b) => b[1] - a[1])[0];
      
      const preferredTime = timeOfDay[0];
      const preferredTimePercentage = Math.round((timeOfDay[1] / med.dosesCount) * 100);
      
      if (preferredTimePercentage > 50) {
        insights.push({
          medicationId: med.medicationId,
          medicationName: med.name,
          insight: `You take ${med.name} most consistently in the ${preferredTime} (${preferredTimePercentage}% of doses).`
        });
      }
      
      // Check for double dosing
      if (med.doubleDosing && med.doubleDosing.count > 0) {
        insights.push({
          medicationId: med.medicationId,
          medicationName: med.name,
          insight: `There were ${med.doubleDosing.count} instances where ${med.name} was taken twice in a short period. Consider setting reminders to avoid double dosing.`,
          type: 'warning'
        });
      }
      
      // Check for weekend vs weekday patterns
      const weekdayCount = med.consumptionByDayOfWeek.monday + 
                          med.consumptionByDayOfWeek.tuesday + 
                          med.consumptionByDayOfWeek.wednesday + 
                          med.consumptionByDayOfWeek.thursday + 
                          med.consumptionByDayOfWeek.friday;
      
      const weekendCount = med.consumptionByDayOfWeek.saturday + med.consumptionByDayOfWeek.sunday;
      
      const avgWeekdayDoses = weekdayCount / 5;
      const avgWeekendDoses = weekendCount / 2;
      
      if (avgWeekdayDoses > avgWeekendDoses * 1.5) {
        insights.push({
          medicationId: med.medicationId,
          medicationName: med.name,
          insight: `You're more consistent taking ${med.name} on weekdays than weekends. Consider setting additional weekend reminders.`,
          type: 'suggestion'
        });
      }
    });
    
    res.status(200).json({
      status: 'success',
      period,
      dateRange: {
        start: startDate,
        end: endDate
      },
      totalDoses: logs.length,
      medicationPatterns,
      insights
    });
  } catch (error) {
    logger.error('Error getting medication consumption patterns:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medication consumption patterns',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get predictive adherence insights
 * @route GET /api/medications/analytics/predictive
 */
exports.getPredictiveAdherenceInsights = async (req, res) => {
  try {
    // Skip AI processing in development mode to save API calls
    if (process.env.NODE_ENV === 'development') {
      return res.status(200).json({
        status: 'success',
        message: 'Development mode - skipping AI processing',
        predictions: [
          "Based on your patterns, you're most likely to miss doses on weekends. Consider setting additional reminders for Saturday and Sunday.",
          "You typically have better adherence in the morning. For medications scheduled later in the day, consider linking them to regular evening activities.",
          "Your adherence tends to decrease when you have multiple medications scheduled at the same time. Consider staggering your medication times when possible."
        ],
        riskFactors: [
          { factor: "Weekend doses", risk: "high" },
          { factor: "Evening medication times", risk: "medium" },
          { factor: "Multiple concurrent medications", risk: "medium" }
        ]
      });
    }
    
    // Get adherence data
    const logs = await MedicationLog.find({ 
      userId: req.user._id,
      createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // Last 90 days
    }).populate('medicationId', 'name genericName dosage frequency');
    
    // Get schedule data
    const schedules = await MedicationSchedule.find({
      userId: req.user._id,
      active: true
    }).populate('medicationId', 'name genericName dosage frequency');
    
    // Format data for the AI
    const adherenceData = formatAdherenceDataForAI(logs, schedules);
    
    // Get predictive insights from OpenAI
    const predictions = await getPredictiveInsightsFromAI(adherenceData);
    
    res.status(200).json({
      status: 'success',
      predictions: predictions.insights,
      riskFactors: predictions.riskFactors,
      suggestionPriority: predictions.suggestionPriority
    });
  } catch (error) {
    logger.error('Error getting predictive adherence insights:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get predictive adherence insights',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Analyze correlations between medication adherence and health outcomes
 * @route GET /api/medications/analytics/health-correlations
 */
exports.getHealthCorrelations = async (req, res) => {
  try {
    const { period = '90days', medicationId, includeChartData = 'true' } = req.query;
    
    // Determine date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    switch(period) {
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
        startDate.setDate(startDate.getDate() - 90);
    }
    
    // Verify medication access if medicationId provided
    let medication = null;
    if (medicationId) {
      medication = await Medication.findOne({
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
    
    // Get medication logs
    const logsQuery = { 
      userId: req.user._id,
      createdAt: { $gte: startDate, $lte: endDate }
    };
    
    if (medicationId) {
      logsQuery.medicationId = medicationId;
    }
    
    const logs = await MedicationLog.find(logsQuery)
      .sort({ createdAt: 1 })
      .populate('medicationId', 'name genericName');
    
    // Group logs by date for correlation analysis
    const logsByDate = {};
    logs.forEach(log => {
      const dateKey = new Date(checkin.createdAt).toISOString().split('T')[0];
      
      if (!healthByDate[dateKey]) {
        healthByDate[dateKey] = {
          date: dateKey,
          feeling: checkin.feeling,
          symptoms: checkin.symptoms || []
        };
      } else {
        // If multiple check-ins on same day, prioritize worse feeling
        const feelingRank = { good: 3, fair: 2, poor: 1 };
        if (feelingRank[checkin.feeling] < feelingRank[healthByDate[dateKey].feeling]) {
          healthByDate[dateKey].feeling = checkin.feeling;
        }
        
        // Combine symptoms
        if (checkin.symptoms && checkin.symptoms.length > 0) {
          healthByDate[dateKey].symptoms = [...healthByDate[dateKey].symptoms, ...checkin.symptoms];
        }
      }
    });
    
    // Combine data for correlation analysis
    const combinedData = [];
    
    // Get all dates from the period
    const allDates = new Set([
      ...Object.keys(logsByDate),
      ...Object.keys(vitalsByDate),
      ...Object.keys(healthByDate)
    ].sort());
    
    // Create combined dataset
    allDates.forEach(date => {
      const dataPoint = {
        date,
        adherence: logsByDate[date] ? 
          (logsByDate[date].totalLogs > 0 ? logsByDate[date].takenLogs / logsByDate[date].totalLogs : null) : null,
        medications: logsByDate[date]?.medications || {},
        vitals: vitalsByDate[date]?.vitals || {},
        feeling: healthByDate[date]?.feeling || null,
        symptoms: healthByDate[date]?.symptoms || []
      };
      
      combinedData.push(dataPoint);
    });
    
    // Calculate correlations
    const correlations = [];
    
    // Only perform correlation analysis if we have sufficient data
    if (combinedData.length >= 7) {
      // 1. Medication adherence vs. feeling
      const adherenceVsFeeling = calculateAdherenceFeelingCorrelation(combinedData);
      if (adherenceVsFeeling) {
        correlations.push(adherenceVsFeeling);
      }
      
      // 2. Medication adherence vs. specific symptoms
      const adherenceVsSymptoms = calculateAdherenceSymptomCorrelations(combinedData);
      correlations.push(...adherenceVsSymptoms);
      
      // 3. Medication adherence vs. vital signs
      const adherenceVsVitals = calculateAdherenceVitalCorrelations(combinedData);
      correlations.push(...adherenceVsVitals);
      
      // 4. If specific medication, check its unique effects
      if (medicationId && medication) {
        const specificMedicationCorrelations = calculateSpecificMedicationCorrelations(
          combinedData, 
          medicationId, 
          medication.name
        );
        correlations.push(...specificMedicationCorrelations);
      }
    }
    
    // Generate insights based on correlations
    const insights = generateHealthCorrelationInsights(correlations, medication);
    
    // Prepare chart data if requested
    let chartData = null;
    if (includeChartData === 'true') {
      chartData = prepareCorrelationChartData(combinedData, medicationId);
    }
    
    res.status(200).json({
      status: 'success',
      period,
      dateRange: {
        start: startDate,
        end: endDate
      },
      dataPoints: combinedData.length,
      correlations: correlations.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength)),
      insights,
      chartData
    });
  } catch (error) {
    logger.error('Error getting health correlations:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get health correlations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};(vital.timestamp).toISOString().split('T')[0];
      
      if (!vitalsByDate[dateKey]) {
        vitalsByDate[dateKey] = {
          date: dateKey,
          vitals: {}
        };
      }
      
      // Add this vital sign reading
      if (!vitalsByDate[dateKey].vitals[vital.type]) {
        vitalsByDate[dateKey].vitals[vital.type] = [];
      }
      
      vitalsByDate[dateKey].vitals[vital.type].push({
        id: vital._id,
        timestamp: vital.timestamp,
        values: vital.values,
        isNormal: vital.isNormal
      });
    });
    
    // Get health check-ins
    const healthCheckins = await HealthCheckIn.find({
      userId: req.user._id,
      createdAt: { $gte: startDate, $lte: endDate }
    }).sort({ createdAt: 1 });
    
    // Group health check-ins by date
    const healthByDate = {};
    healthCheckins.forEach(checkin => {
      const dateKey = new Date(log.createdAt).toISOString().split('T')[0];
      
      if (!logsByDate[dateKey]) {
        logsByDate[dateKey] = {
          date: dateKey,
          totalLogs: 0,
          takenLogs: 0,
          medications: {}
        };
      }
      
      logsByDate[dateKey].totalLogs++;
      if (log.status === 'taken') {
        logsByDate[dateKey].takenLogs++;
      }
      
      // Track by medication
      const medId = log.medicationId?._id?.toString();
      if (medId) {
        if (!logsByDate[dateKey].medications[medId]) {
          logsByDate[dateKey].medications[medId] = {
            id: medId,
            name: log.medicationId?.name || 'Unknown',
            taken: 0,
            total: 0
          };
        }
        
        logsByDate[dateKey].medications[medId].total++;
        if (log.status === 'taken') {
          logsByDate[dateKey].medications[medId].taken++;
        }
      }
    });
    
    // Get vital signs
    const vitalSigns = await VitalSign.find({
      userId: req.user._id,
      timestamp: { $gte: startDate, $lte: endDate }
    }).sort({ timestamp: 1 });
    
    // Group vital signs by date
    const vitalsByDate = {};
    vitalSigns.forEach(vital => {
      const dateKey = new Date