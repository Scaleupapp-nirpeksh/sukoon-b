const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// Rate limiting for AI endpoints
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: 'Too many AI requests, please try again later'
});

// Apply authentication middleware to all routes
router.use(protect);

// Vital signs routes
router.post('/vitals', healthController.recordVitalSign);
router.get('/vitals', healthController.getUserVitalSigns);

// Health check-in routes
router.post('/checkins', healthController.submitHealthCheckIn);
router.get('/checkins', healthController.getUserHealthCheckIns);
router.post('/checkins/follow-up', healthController.submitFollowUpResponses);

// Follow-up routes
router.get('/follow-ups', healthController.getPendingFollowUps);

// Dashboard route
router.get('/dashboard', aiLimiter, healthController.getHealthDashboard);

module.exports = router;