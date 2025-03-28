// routes/caregiverRoutes.js
const express = require('express');
const router = express.Router();
const caregiverController = require('../controllers/caregiverController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// Caregiver management routes
router.post('/invite', caregiverController.sendCaregiverInvitation);
router.get('/caregivers', caregiverController.getCaregivers);
router.get('/care-recipients', caregiverController.getCaregiverPatients);
router.post('/invitations/:id/respond', caregiverController.respondToInvitation);

// Patient data access routes
router.get('/patients/:patientId/dashboard', caregiverController.getPatientDashboard);
router.get('/patients/:patientId/medications', caregiverController.getPatientMedicationLogs);
router.get('/patients/:patientId/vitals', caregiverController.getPatientVitalSigns);
router.get('/patients/:patientId/health-checkins', caregiverController.getPatientHealthCheckIns);

// Medication recording
router.post('/patients/:patientId/medications/:medicationId/log', caregiverController.recordPatientMedication);

// Caregiver reports
router.get('/patients/:patientId/reports', caregiverController.getCaregiverReports);

// Notification preferences
router.put('/relationships/:relationshipId/notifications', caregiverController.updateNotificationPreferences);

module.exports = router;