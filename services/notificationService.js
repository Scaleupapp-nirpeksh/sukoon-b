const User = require('../models/userModel');
const logger = require('../utils/logger');

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function sendPushNotification(userId, title, body, data = {}) {
  try {
    // Get user FCM tokens
    const user = await User.findById(userId);
    
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
      throw new Error('User has no FCM tokens registered');
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

module.exports = {
  sendPushNotification
};
