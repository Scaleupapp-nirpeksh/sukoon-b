// server.js (updated)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const medicationRoutes = require('./routes/medicationRoutes');
const healthRoutes = require('./routes/healthRoutes');
const caregiverRoutes = require('./routes/caregiverRoutes');
const emergencyRoutes = require('./routes/emergencyRoutes');
const prescriptionRoutes = require('./routes/prescriptionRoutes');
const medicationEfficacyRoutes = require('./routes/medicationEfficacyRoutes');
const symptomCorrelationRoutes = require('./routes/symptomCorrelationRoutes'); // New route

// Import schedulers with try/catch to make them optional
let startScheduler, startMedicationScheduler, startCaregiverReportScheduler;

try {
  const schedulerService = require('./services/schedulerService');
  startScheduler = schedulerService.startScheduler;
} catch (error) {
  console.log('Scheduler service not available:', error.message);
  startScheduler = () => console.log('Scheduler service disabled');
}

try {
  const medicationScheduler = require('./services/medicationScheduler');
  startMedicationScheduler = medicationScheduler.startMedicationScheduler;
} catch (error) {
  console.log('Medication scheduler not available:', error.message);
  startMedicationScheduler = () => console.log('Medication scheduler disabled');
}

try {
  const caregiverReportService = require('./services/caregiverReportService');
  startCaregiverReportScheduler = caregiverReportService.startCaregiverReportScheduler;
} catch (error) {
  console.log('Caregiver report service not available:', error.message);
  startCaregiverReportScheduler = () => console.log('Caregiver report service disabled');
}

// Import middleware
const { errorHandler } = require('./middleware/errorMiddleware');

// Initialize express app
const app = express();

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Serve static files (if needed)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/health', symptomCorrelationRoutes); // Add symptom correlation routes to health endpoint
app.use('/api/care', caregiverRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api', medicationEfficacyRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use(errorHandler);

// Connect to MongoDB and start server
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      // Start schedulers if available
      startScheduler();
      startMedicationScheduler();
      startCaregiverReportScheduler();
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });