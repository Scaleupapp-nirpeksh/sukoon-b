const mongoose = require('mongoose');

const MedicationEfficacySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    medicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medication',
      required: true,
      index: true
    },
    symptomRelief: {
      type: Number,
      min: 1,
      max: 5 // 1 = No relief, 5 = Complete relief
    },
    sideEffects: [{
      effect: { type: String },
      severity: { type: Number, min: 1, max: 5 },
      notes: { type: String }
    }],
    effectDuration: {
      type: Number // Duration in hours
    },
    timeToEffect: {
      type: Number // Time in minutes until noticeable effect
    },
    overallRating: {
      type: Number,
      min: 1,
      max: 5
    },
    notes: {
      type: String
    },
    recordedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    targetSymptoms: [{
      name: { type: String },
      improvementRating: { type: Number, min: 1, max: 5 }
    }]
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MedicationEfficacy', MedicationEfficacySchema);