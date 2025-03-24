const User = require('../models/userModel');
const twilio = require('twilio');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Trigger emergency
exports.triggerEmergency = async (req, res) => {
  try {
    const { location } = req.body;
    
    // Get user data
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }
    
    // Check if user has emergency contacts
    if (!user.emergencyContacts || user.emergencyContacts.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No emergency contacts found',
      });
    }
    
    // In a real implementation, you would:
    // 1. Create an emergency record in the database
    // 2. Send SMS/WhatsApp messages to all emergency contacts
    // 3. Track the status of the emergency
    
    // For now, we'll just simulate the emergency notification
    
    // Format location for the message
    const locationText = location ? `Location: ${location.latitude}, ${location.longitude}` : 'Location not available';
    
    // Create emergency message
    const message = `EMERGENCY ALERT: ${user.fullName} has triggered an emergency alert. ${locationText}. Please contact them immediately.`;
    
    // In production, send alerts to all emergency contacts
    if (process.env.NODE_ENV === 'production') {
      for (const contact of user.emergencyContacts) {
        try {
          await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: contact.phoneNumber
          });
        } catch (err) {
          console.error(`Failed to send emergency alert to ${contact.phoneNumber}:`, err);
        }
      }
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Emergency triggered successfully',
      notifiedContacts: user.emergencyContacts.map(contact => ({
        name: contact.name,
        phoneNumber: contact.phoneNumber
      }))
    });
  } catch (error) {
    console.error('Error triggering emergency:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to trigger emergency',
    });
  }
};

// Resolve emergency
exports.resolveEmergency = async (req, res) => {
  try {
    // In a real implementation, you would:
    // 1. Update the emergency record in the database
    // 2. Optionally notify emergency contacts that the situation is resolved
    
    res.status(200).json({
      status: 'success',
      message: 'Emergency resolved successfully'
    });
  } catch (error) {
    console.error('Error resolving emergency:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to resolve emergency',
    });
  }
};