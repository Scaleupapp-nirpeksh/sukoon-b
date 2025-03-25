const mongoose = require('mongoose');

const FollowUpSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    originalCheckInId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HealthCheckIn',
      required: true
    },
    scheduledTime: {
      type: Date,
      required: true,
      index: true
    },
    symptoms: [{
      name: { type: String },
      severity: { type: Number, min: 1, max: 5 },
      bodyLocation: { type: String },
      startTime: { type: Date }
    }],
    status: {
      type: String,
      enum: ['pending', 'completed', 'missed', 'rescheduled'],
      default: 'pending',
      index: true
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'emergency'],
      required: true
    },
    completedAt: {
      type: Date
    },
    responseCheckInId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HealthCheckIn'
    },
    notificationSent: {
      type: Boolean,
      default: false
    },
    followUpType: {
      type: String,
      enum: ['health_check', 'vital_sign', 'medication_adherence'],
      default: 'health_check'
    },
    followUpCount: {
      type: Number,
      default: 1
    },
    notes: {
      type: String
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('FollowUp', FollowUpSchema);