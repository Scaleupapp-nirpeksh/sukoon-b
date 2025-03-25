const cron = require('node-cron');
const FollowUp = require('../models/followUpModel');
const { sendPushNotification } = require('./notificationService');
const logger = require('../utils/logger');

// Schedule different follow-up intervals based on risk level
const followUpIntervals = {
  emergency: 6,     // 6 hours for emergency cases
  high: 24,         // 24 hours (1 day) for high risk
  medium: 48,       // 48 hours (2 days) for medium risk
  low: 72           // 72 hours (3 days) for low risk
};

// Maximum number of follow-ups for each risk level
const maxFollowUps = {
  emergency: 3,     // Up to 3 follow-ups for emergency
  high: 3,          // Up to 3 follow-ups for high risk
  medium: 2,        // Up to 2 follow-ups for medium risk
  low: 1            // Only 1 follow-up for low risk
};

// Function to schedule a follow-up
async function scheduleFollowUp(userId, checkInId, symptoms = [], riskLevel = 'medium', followUpType = 'health_check', followUpCount = 1) {
  try {
    // Check if this would exceed the maximum follow-ups for this risk level
    if (followUpCount > (maxFollowUps[riskLevel] || 1)) {
      logger.info(`Maximum follow-ups (${maxFollowUps[riskLevel]}) reached for risk level ${riskLevel}`);
      return null;
    }
    
    // Get the hours for follow-up based on risk level
    const hoursLater = followUpIntervals[riskLevel] || followUpIntervals.medium;
    
    // Calculate follow-up time
    const followUpTime = new Date();
    followUpTime.setHours(followUpTime.getHours() + hoursLater);
    
    // Create a new follow-up record
    const followUp = new FollowUp({
      userId,
      originalCheckInId: checkInId,
      scheduledTime: followUpTime,
      symptoms,
      status: 'pending',
      riskLevel,
      followUpType,
      followUpCount,
      notes: `Automated follow-up #${followUpCount} scheduled for ${riskLevel} risk level health check-in.`
    });
    
    await followUp.save();
    
    logger.info(`Follow-up #${followUpCount} scheduled for user ${userId} at ${followUpTime} (${riskLevel} risk level)`);
    
    return followUp;
  } catch (error) {
    logger.error('Error scheduling follow-up:', error);
    throw error;
  }
}

// Start the follow-up check scheduler
function startScheduler() {
  // Check for follow-ups every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      
      // Find follow-ups that are due and not yet sent
      const dueFollowUps = await FollowUp.find({
        scheduledTime: { $lte: now },
        status: 'pending',
        notificationSent: false
      }).populate('userId');
      
      logger.info(`Found ${dueFollowUps.length} follow-ups due for processing`);
      
      // Process each due follow-up
      for (const followUp of dueFollowUps) {
        try {
          // Send notification to the user
          await sendFollowUpNotification(followUp);
          
          // Update the follow-up record
          followUp.notificationSent = true;
          await followUp.save();
          
          logger.info(`Follow-up notification sent for user ${followUp.userId._id}`);
        } catch (error) {
          logger.error(`Error processing follow-up ${followUp._id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error in follow-up scheduler:', error);
    }
  });
  
  logger.info('Follow-up scheduler started');
}

// Send follow-up notification via push notification
async function sendFollowUpNotification(followUp) {
  try {
    // Prepare notification content based on follow-up type and risk level
    let title, body;
    
    if (followUp.followUpType === 'health_check') {
      if (followUp.riskLevel === 'emergency' || followUp.riskLevel === 'high') {
        title = 'Important Health Follow-up';
        body = 'Please check in with your health status. How are you feeling now?';
      } else {
        title = 'Health Follow-up';
        body = 'Time for your scheduled health check-in. How are you feeling today?';
      }
    } else if (followUp.followUpType === 'vital_sign') {
      title = 'Vital Sign Check';
      body = 'Time to record your vital signs. Please open the app to take a new reading.';
    } else {
      title = 'Health Reminder';
      body = 'You have a follow-up reminder from Sukoon Saarthi. Please open the app.';
    }
    
    // Send push notification
    await sendPushNotification(
      followUp.userId._id,
      title,
      body,
      { 
        followUpId: followUp._id.toString(),
        followUpType: followUp.followUpType,
        riskLevel: followUp.riskLevel
      }
    );
    
    return true;
  } catch (error) {
    logger.error('Error sending follow-up notification:', error);
    return false;
  }
}

// Mark a follow-up as completed
async function completeFollowUp(followUpId, responseCheckInId) {
  try {
    const followUp = await FollowUp.findById(followUpId);
    
    if (!followUp) {
      throw new Error('Follow-up not found');
    }
    
    followUp.status = 'completed';
    followUp.completedAt = new Date();
    followUp.responseCheckInId = responseCheckInId;
    
    await followUp.save();
    
    logger.info(`Follow-up ${followUpId} marked as completed`);
    
    return followUp;
  } catch (error) {
    logger.error('Error completing follow-up:', error);
    throw error;
  }
}

// Get pending follow-ups for a user
async function getPendingFollowUps(userId) {
  try {
    return await FollowUp.find({
      userId,
      status: 'pending'
    }).sort({ scheduledTime: 1 });
  } catch (error) {
    logger.error('Error getting pending follow-ups:', error);
    throw error;
  }
}

module.exports = {
  scheduleFollowUp,
  startScheduler,
  sendFollowUpNotification,
  completeFollowUp,
  getPendingFollowUps,
  followUpIntervals,
  maxFollowUps
};