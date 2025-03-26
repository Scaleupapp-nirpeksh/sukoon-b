// routes/prescriptionRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const prescriptionController = require('../controllers/prescriptionController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected
router.use(protect);

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});



// Prescription routes
router.post('/upload', upload.single('prescriptionImage'), prescriptionController.uploadPrescription);
router.get('/', prescriptionController.getUserPrescriptions);
router.get('/:id', prescriptionController.getPrescriptionDetails);
router.post('/:id/process', prescriptionController.processPrescription);
router.post('/:id/medications', prescriptionController.createMedicationsFromPrescription);
router.put('/:id', prescriptionController.updatePrescription);
router.delete('/:id', prescriptionController.deletePrescription);

module.exports = router;