const express = require('express');
const router = express.Router();
const caregiverController = require('../controllers/caregiverController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// Caregiver routes
router.post('/invite', caregiverController.sendCaregiverInvitation);
router.get('/caregivers', caregiverController.getCaregivers);
router.get('/care-recipients', caregiverController.getCareRecipients);

module.exports = router;