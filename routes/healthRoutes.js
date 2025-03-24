const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// Apply rate limiting to AI-intensive endpoints
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: 'Too many health AI requests, please try again later'
});

// All routes are protected
router.use(protect);

// Vital sign routes
router.post('/vitals', healthController.recordVitalSign);
router.get('/vitals', healthController.getUserVitalSigns);

// Health check-in routes
router.post('/checkins', healthController.submitHealthCheckIn);
router.get('/checkins', healthController.getUserHealthCheckIns);

// Health dashboard with AI insights (rate limited)
router.get('/dashboard', aiLimiter, healthController.getHealthDashboard);

module.exports = router;