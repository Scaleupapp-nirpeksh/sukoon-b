const mongoose = require('mongoose');

const MedicationSideEffectSchema = new mongoose.Schema(
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
    effect: {
      type: String,
      required: true
    },
    severity: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    onset: {
      type: Date,
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'resolved', 'intermittent'],
      default: 'active',
      index: true
    },
    resolution: {
      type: String
    },
    resolutionDate: {
      type: Date
    },
    bodyLocation: {
      type: String
    },
    characteristics: [{
      type: String
    }],
    interferesWith: [{
      type: String,
      enum: ['sleep', 'work', 'exercise', 'eating', 'social', 'mood', 'other']
    }],
    description: {
      type: String
    },
    notes: {
      type: String
    }
  },
  {
    timestamps: true,
  }
);

MedicationSideEffectSchema.index({ userId: 1, medicationId: 1, effect: 1 });

module.exports = mongoose.model('MedicationSideEffect', MedicationSideEffectSchema);