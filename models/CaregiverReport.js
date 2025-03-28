// models/CaregiverReport.js
const mongoose = require('mongoose');

const CaregiverReportSchema = new mongoose.Schema(
  {
    caregiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    reportDate: {
      type: Date,
      required: true,
      index: true
    },
    reportType: {
      type: String,
      enum: ['daily', 'weekly', 'critical_alert'],
      default: 'daily'
    },
    medicationSummary: {
      adherenceRate: { type: Number },
      totalDoses: { type: Number },
      takenDoses: { type: Number },
      missedDoses: { type: Number },
      skippedDoses: { type: Number },
      medications: [{
        medicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medication' },
        name: { type: String },
        adherenceRate: { type: Number },
        missedDoses: { type: Number }
      }]
    },
    vitalSignsSummary: {
      readings: { type: Number },
      abnormalReadings: { type: Number },
      vitals: [{
        type: { type: String },
        value: { type: mongoose.Schema.Types.Mixed },
        isNormal: { type: Boolean },
        timestamp: { type: Date }
      }]
    },
    symptomsSummary: {
      reported: { type: Boolean },
      symptoms: [{
        name: { type: String },
        severity: { type: Number },
        reportedAt: { type: Date }
      }]
    },
    criticalAlerts: [{
      alertType: { 
        type: String, 
        enum: ['missed_medication', 'missed_critical_medication', 'abnormal_vitals', 'severe_symptoms', 'low_adherence', 'other'] 
      },
      severity: { 
        type: String, 
        enum: ['info', 'warning', 'critical'] 
      },
      message: { type: String },
      timestamp: { type: Date }
    }],
    recommendations: [{
      type: String
    }],
    reportStatus: {
      generated: { type: Boolean, default: true },
      delivered: { type: Boolean, default: false },
      viewed: { type: Boolean, default: false },
      deliveredAt: { type: Date },
      viewedAt: { type: Date }
    }
  },
  {
    timestamps: true,
  }
);

// Create compound index for date-based lookups
CaregiverReportSchema.index({ caregiverId: 1, patientId: 1, reportDate: -1 });

module.exports = mongoose.model('CaregiverReport', CaregiverReportSchema);