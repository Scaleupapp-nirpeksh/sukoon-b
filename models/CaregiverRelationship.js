// models/CaregiverRelationship.js
const mongoose = require('mongoose');

const CaregiverRelationshipSchema = new mongoose.Schema(
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
    relationship: {
      type: String,
      enum: ['family', 'friend', 'professional', 'other'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'rejected', 'revoked'],
      default: 'pending',
      index: true
    },
    permissions: {
      viewMedications: { type: Boolean, default: true },
      recordMedications: { type: Boolean, default: false },
      viewVitals: { type: Boolean, default: true },
      viewSymptoms: { type: Boolean, default: true },
      receiveAlerts: { type: Boolean, default: true },
      receiveReports: { type: Boolean, default: true }
    },
    notificationPreferences: {
      missedMedications: { type: Boolean, default: true },
      lowAdherence: { type: Boolean, default: true },
      abnormalVitals: { type: Boolean, default: true },
      reportFrequency: { 
        type: String, 
        enum: ['daily', 'weekly', 'critical_only'], 
        default: 'daily' 
      },
      reportTime: { type: String, default: '20:00' }, // Time in 24hr format
      notificationChannels: {
        app: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: false }
      }
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    invitationAcceptedAt: {
      type: Date
    },
    notes: {
      type: String
    }
  },
  {
    timestamps: true,
  }
);

// Create compound index for uniqueness
CaregiverRelationshipSchema.index({ caregiverId: 1, patientId: 1 }, { unique: true });

module.exports = mongoose.model('CaregiverRelationship', CaregiverRelationshipSchema);