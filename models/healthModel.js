const mongoose = require('mongoose');

const VitalSignSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['bloodPressure', 'glucose', 'weight', 'temperature', 'heartRate', 'oxygenLevel', 'other'],
      required: true,
    },
    values: {
      systolic: { type: Number }, // for blood pressure
      diastolic: { type: Number }, // for blood pressure
      glucoseLevel: { type: Number }, // for glucose
      weight: { type: Number }, // for weight
      temperature: { type: Number }, // for temperature
      heartRate: { type: Number }, // for heart rate
      oxygenLevel: { type: Number }, // for oxygen saturation
      customValue: { type: Number } // for other
    },
    unit: { type: String },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    notes: { type: String },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isNormal: { type: Boolean },
    followupRequired: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const HealthCheckInSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    feeling: {
      type: String,
      enum: ['good', 'fair', 'poor'],
      required: true,
    },
    symptoms: [
      {
        name: { type: String },
        severity: { type: Number, min: 1, max: 5 },
        bodyLocation: { type: String },
        startTime: { type: Date }
      },
    ],
    notes: { type: String },
    aiAssessment: {
      riskLevel: { type: String, enum: ['low', 'medium', 'high'] },
      recommendations: [{ type: String }],
      followUpRequired: { type: Boolean, default: false }
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

const VitalSign = mongoose.model('VitalSign', VitalSignSchema);
const HealthCheckIn = mongoose.model('HealthCheckIn', HealthCheckInSchema);

module.exports = { VitalSign, HealthCheckIn };