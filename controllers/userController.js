const User = require('../models/userModel');

// Get user profile
exports.getUserProfile = async (req, res) => {
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

// Update user profile
exports.updateUserProfile = async (req, res) => {
  try {
    const { fullName, language, userType } = req.body;
    
    // Find user and update
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { 
        fullName: fullName || req.user.fullName,
        language: language || req.user.language,
        userType: userType || req.user.userType
      },
      { new: true }
    );
    
    if (!updatedUser) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      user: {
        _id: updatedUser._id,
        fullName: updatedUser.fullName,
        phoneNumber: updatedUser.phoneNumber,
        language: updatedUser.language,
        userType: updatedUser.userType
      },
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update profile',
    });
  }
};

// Add emergency contact
exports.addEmergencyContact = async (req, res) => {
  try {
    const { name, relationship, phoneNumber } = req.body;
    
    // Validate required fields
    if (!name || !relationship || !phoneNumber) {
      return res.status(400).json({
        status: 'error',
        message: 'All fields are required',
      });
    }
    
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }
    
    // Add new emergency contact
    user.emergencyContacts.push({
      name,
      relationship,
      phoneNumber
    });
    
    await user.save();
    
    res.status(201).json({
      status: 'success',
      message: 'Emergency contact added successfully',
      emergencyContacts: user.emergencyContacts
    });
  } catch (error) {
    console.error('Error adding emergency contact:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to add emergency contact',
    });
  }
};

// Get emergency contacts
exports.getEmergencyContacts = async (req, res) => {
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
      emergencyContacts: user.emergencyContacts
    });
  } catch (error) {
    console.error('Error getting emergency contacts:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get emergency contacts',
    });
  }
};

// Remove emergency contact
exports.removeEmergencyContact = async (req, res) => {
  try {
    const contactId = req.params.id;
    
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }
    
    // Remove the contact
    user.emergencyContacts = user.emergencyContacts.filter(
      contact => contact._id.toString() !== contactId
    );
    
    await user.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Emergency contact removed successfully',
      emergencyContacts: user.emergencyContacts
    });
  } catch (error) {
    console.error('Error removing emergency contact:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to remove emergency contact',
    });
  }
};