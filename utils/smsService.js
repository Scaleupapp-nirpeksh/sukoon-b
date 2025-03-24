const twilio = require('twilio');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Send SMS message using Twilio
 * @param {string} to - Recipient phone number
 * @param {string} message - Message content
 * @returns {Promise<boolean>} - Success status
 */
exports.sendSMS = async (to, message) => {
  try {
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to
    });
    return true;
  } catch (error) {
    console.error('Error sending SMS:', error);
    return false;
  }
};

/**
 * Send WhatsApp message using Twilio
 * @param {string} to - Recipient phone number (must be in WhatsApp format)
 * @param {string} message - Message content
 * @returns {Promise<boolean>} - Success status
 */
exports.sendWhatsApp = async (to, message) => {
  try {
    await twilioClient.messages.create({
      body: message,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${to}`
    });
    return true;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return false;
  }
};