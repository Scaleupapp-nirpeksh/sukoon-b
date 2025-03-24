const express = require('express');
const router = express.Router();
const medicationController = require('../controllers/medicationController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// Medication routes
router.post('/', medicationController.addMedication);
router.get('/', medicationController.getUserMedications);
router.get('/:id', medicationController.getMedicationDetails);
router.put('/:id', medicationController.updateMedication);
router.delete('/:id', medicationController.deleteMedication);

module.exports = router;