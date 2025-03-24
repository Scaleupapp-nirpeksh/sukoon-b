const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// Vital sign routes
router.post('/vitals', healthController.recordVitalSign);
router.get('/vitals', healthController.getUserVitalSigns);

// Health check-in routes
router.post('/checkins', healthController.submitHealthCheckIn);
router.get('/checkins', healthController.getUserHealthCheckIns);

module.exports = router;