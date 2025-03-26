// services/notificationService.js

const User = require('../models/userModel');
const logger = require('../utils/logger');

// Create a mock notification service for development
if (process.env.NODE_ENV !== 'production') {
  module.exports = {
    sendPushNotification: async (userId, title, body, data = {}) => {
      logger.info(`[MOCK] Push notification sent to user ${userId}: ${title} - ${body}`, data);
      return true;
    }
  };
} else {
  // Only initialize Firebase Admin in production
  const admin = require('firebase-admin');

  try {
    // Try to parse the service account key
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    // Firebase notification service for production
    module.exports = {
      sendPushNotification: async (userId, title, body, data = {}) => {
        try {
          // Get user FCM tokens
          const user = await User.findById(userId);
          
          if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
            logger.warn(`User ${userId} has no FCM tokens registered`);
            return false;
          }
          
          // Create messages for each token
          const messages = user.fcmTokens.map(token => ({
            token,
            notification: {
              title,
              body,
            },
            data, // Optional: convert data values to strings if necessary
          }));
          
          const response = await admin.messaging().sendAll(messages);
          logger.info(`Push notification sent to user ${userId}: ${title} - ${body}`, response);
          
          return true;
        } catch (error) {
          logger.error('Error sending push notification:', error);
          return false;
        }
      }
    };
  } catch (error) {
    logger.error('Error initializing Firebase Admin:', error);
    // Fallback if Firebase initialization fails
    module.exports = {
      sendPushNotification: async (userId, title, body, data = {}) => {
        logger.info(`[FALLBACK] Push notification sent to user ${userId}: ${title} - ${body}`, data);
        return true;
      }
    };
  }
}