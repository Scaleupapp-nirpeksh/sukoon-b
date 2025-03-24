const express = require('express');
const router = express.Router();
const emergencyController = require('../controllers/emergencyController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// Emergency routes
router.post('/trigger', emergencyController.triggerEmergency);
router.post('/resolve', emergencyController.resolveEmergency);

module.exports = router;