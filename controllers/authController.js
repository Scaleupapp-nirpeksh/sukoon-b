const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Otp = require('../models/otpModel');
const twilio = require('twilio');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY || '24h',
  });
};

// Generate a random 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP via Twilio SMS
const sendSMS = async (phoneNumber, message) => {
  try {
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: phoneNumber
    });
    return true;
  } catch (error) {
    console.error('Error sending SMS:', error);
    return false;
  }
};

// Send OTP for authentication
exports.sendOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        status: 'error',
        message: 'Phone number is required',
      });
    }
    
    // Generate a new OTP
    const otp = process.env.NODE_ENV === 'development' ? '123456' : generateOTP();
    
    // Store OTP in database
    // First, delete any existing OTPs for this phone number
    await Otp.deleteMany({ phoneNumber });
    
    // Create new OTP document
    await Otp.create({
      phoneNumber,
      otp
    });
    
    // In production, send OTP via SMS
    if (process.env.NODE_ENV === 'production') {
      const message = `Your Sukoon Saarthi verification code is: ${otp}`;
      const sent = await sendSMS(phoneNumber, message);
      
      if (!sent) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to send OTP via SMS',
        });
      }
    }
    
    res.status(200).json({
      status: 'success',
      message: 'OTP sent successfully',
      // Only include OTP in response during development
      ...(process.env.NODE_ENV === 'development' && { otp }),
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send OTP',
    });
  }
};

// Verify OTP and authenticate user
exports.verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    
    if (!phoneNumber || !otp) {
      return res.status(400).json({
        status: 'error',
        message: 'Phone number and OTP are required',
      });
    }
    
    // In development, accept the fixed code
    if (process.env.NODE_ENV === 'development' && otp === '123456') {
      // Skip OTP verification in development
    } else {
      // Verify OTP from database
      const otpRecord = await Otp.findOne({ phoneNumber, otp });
      
      if (!otpRecord) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid OTP or OTP has expired',
        });
      }
      
      // Delete the OTP record once verified
      await Otp.deleteOne({ _id: otpRecord._id });
    }
    
    // Check if user exists
    let user = await User.findOne({ phoneNumber });
    let isNewUser = false;
    
    if (!user) {
      // This is a new user - they need to complete registration
      isNewUser = true;
    }
    
    // Generate JWT token
    const token = generateToken(user ? user._id : null);
    
    res.status(200).json({
      status: 'success',
      message: 'OTP verified successfully',
      token,
      isNewUser,
      user: user ? {
        _id: user._id,
        fullName: user.fullName,
        userType: user.userType,
        phoneNumber: user.phoneNumber
      } : null,
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to verify OTP',
    });
  }
};

// Register a new user
exports.registerUser = async (req, res) => {
  try {
    const { phoneNumber, fullName, dateOfBirth, gender, userType, emergencyContacts } = req.body;
    
    // Validate required fields
    if (!phoneNumber || !fullName || !dateOfBirth || !gender || !userType) {
      return res.status(400).json({
        status: 'error',
        message: 'All fields are required',
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      return res.status(400).json({
        status: 'error',
        message: 'User with this phone number already exists',
      });
    }
    
    // Create new user
    const user = new User({
      phoneNumber,
      fullName,
      dateOfBirth,
      gender,
      userType,
      emergencyContacts: emergencyContacts || []
    });
    
    await user.save();
    
    // Generate JWT token
    const token = generateToken(user._id);
    
    res.status(201).json({
      status: 'success',
      message: 'User registered successfully',
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        userType: user.userType,
        phoneNumber: user.phoneNumber
      },
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to register user',
      error: error.message
    });
  }
};

// Get current user profile
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }
    
    res.status(200).json({
      status: 'success',
      user: {
        _id: user._id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        language: user.language,
        userType: user.userType,
        emergencyContacts: user.emergencyContacts,
        createdAt: user.createdAt
      },
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get user profile',
    });
  }
};