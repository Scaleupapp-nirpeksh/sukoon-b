// routes/symptomCorrelationRoutes.js
const express = require('express');
const router = express.Router();
const symptomCorrelationController = require('../controllers/SymptomCorrelationController');
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// Rate limiting for AI endpoints
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many AI requests, please try again later'
});

// Apply authentication middleware to all routes
router.use(protect);

// Get all symptom correlations
router.get('/symptom-correlations', aiLimiter, symptomCorrelationController.getSymptomCorrelations);

// Get detailed analysis for specific medication-symptom pair
router.get('/symptom-correlations/detailed', aiLimiter, symptomCorrelationController.getDetailedCorrelation);

// Get symptom network data
router.get('/symptom-network', symptomCorrelationController.getSymptomNetwork);

module.exports = router;