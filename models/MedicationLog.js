const mongoose = require('mongoose');

const MedicationLogSchema = new mongoose.Schema(
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
    scheduledTime: {
      type: Date,
      index: true
    },
    takenTime: {
      type: Date
    },
    status: {
      type: String,
      enum: ['taken', 'missed', 'skipped'],
      required: true,
      index: true
    },
    dosage: {
      type: String // In case dosage differs from prescribed
    },
    notes: {
      type: String
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User' // Can be the patient or a caregiver
    },
    recordedAt: {
      type: Date,
      default: Date.now
    },
    reminderSent: {
      type: Boolean,
      default: false
    },
    quantityAdjustment: {
      type: Number,
      default: -1 // Typically -1 for taken
    }
  },
  {
    timestamps: true,
  }
);

// Create indexes for common queries
MedicationLogSchema.index({ userId: 1, status: 1 });
MedicationLogSchema.index({ medicationId: 1, takenTime: -1 });
MedicationLogSchema.index({ userId: 1, takenTime: -1 });

module.exports = mongoose.model('MedicationLog', MedicationLogSchema);