const express = require('express');
const router = express.Router();
const medicationController = require('../controllers/medicationController');
const drugInteractionController = require('../controllers/DrugInteractionController');
const medicationLogController = require('../controllers/MedicationLogController');
const medicationRefillController = require('../controllers/MedicationRefillController');
const medicationReminderController = require('../controllers/MedicationReminderController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// Basic Medication CRUD routes
router.post('/', medicationController.addMedication);
router.get('/', medicationController.getUserMedications);
router.get('/:id', medicationController.getMedicationDetails);
router.put('/:id', medicationController.updateMedication);
router.delete('/:id', medicationController.deleteMedication);
router.get('/refill-needed', medicationController.getMedicationsNeedingRefill);

// Drug Interaction routes
router.post('/interactions/check', drugInteractionController.checkDrugInteractions);
router.get('/:id/interactions', drugInteractionController.getMedicationInteractions);

// Medication Log routes
router.post('/logs', medicationLogController.recordMedicationEvent);
router.get('/logs', medicationLogController.getMedicationLogs);
router.get('/logs/adherence', medicationLogController.getAdherenceStats);

// Medication Refill routes
router.post('/:id/refill', medicationRefillController.recordRefill);
router.get('/:id/refills', medicationRefillController.getRefillHistory);

// Medication Reminder routes
router.get('/reminders', medicationReminderController.getUpcomingReminders);
router.put('/reminders/:id', medicationReminderController.updateReminder);
router.post('/reminders/:id/respond', medicationReminderController.respondToReminder);
router.post('/:medicationId/reminders', medicationReminderController.createReminders);
router.delete('/reminders/:id', medicationReminderController.deleteReminder);

module.exports = router;