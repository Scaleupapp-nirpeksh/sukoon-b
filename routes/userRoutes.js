const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// User profile routes
router.get('/profile', userController.getUserProfile);
router.put('/profile', userController.updateUserProfile);

// Emergency contacts routes
router.get('/emergency-contacts', userController.getEmergencyContacts);
router.post('/emergency-contacts', userController.addEmergencyContact);
router.delete('/emergency-contacts/:id', userController.removeEmergencyContact);

module.exports = router;