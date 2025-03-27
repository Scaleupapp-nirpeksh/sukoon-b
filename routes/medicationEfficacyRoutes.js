const express = require('express');
const router = express.Router();
const medicationEfficacyController = require('../controllers/MedicationEfficacyController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// Record efficacy for a specific medication
router.post('/medications/:id/efficacy', medicationEfficacyController.recordEfficacy);

// Get efficacy history for a specific medication
router.get('/medications/:id/efficacy', medicationEfficacyController.getEfficacyHistory);

// Get efficacy summary for a specific medication
router.get('/medications/:id/efficacy/summary', medicationEfficacyController.getEfficacySummary);

// Get AI-generated insights about medication efficacy
router.get('/medications/:id/efficacy/insights', medicationEfficacyController.getEfficacyInsights);

// Get side effects data with severity trends
router.get('/medications/:id/efficacy/side-effects', medicationEfficacyController.getSideEffects);

// Get contextual factors that may affect efficacy
router.get('/medications/:id/efficacy/context', medicationEfficacyController.getEfficacyContext);

// Compare efficacy across multiple medications
router.get('/medications/efficacy/compare', medicationEfficacyController.compareEfficacy);

module.exports = router;