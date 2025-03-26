// routes/medicationAnalyticsRoutes.js
const express = require('express');
const router = express.Router();
const medicationAnalyticsController = require('../controllers/MedicationAnalyticsController');
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// Rate limiting for AI endpoints
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many AI requests, please try again later'
});

// All routes are protected
router.use(protect);

// Adherence analytics and insights
router.get('/adherence', medicationAnalyticsController.getAdherenceAnalytics);
router.get('/recommendations', medicationAnalyticsController.getAdherenceRecommendations);
router.get('/predictive', aiLimiter, medicationAnalyticsController.getPredictiveAdherenceInsights);
router.get('/consumption', medicationAnalyticsController.getMedicationConsumptionPatterns);
router.get('/health-correlations', medicationAnalyticsController.getHealthCorrelations);

module.exports = router;