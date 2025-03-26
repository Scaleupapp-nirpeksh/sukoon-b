const mongoose = require('mongoose');

const MedicationSharingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    caregiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    medicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medication',
      required: true
    },
    permissions: {
      canView: { type: Boolean, default: true },
      canRecordDoses: { type: Boolean, default: false },
      canRecordRefills: { type: Boolean, default: false },
      canEdit: { type: Boolean, default: false }
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'revoked'],
      default: 'active',
      index: true
    },
    notifyOnMissedDoses: {
      type: Boolean,
      default: true
    },
    notifyOnRefills: {
      type: Boolean,
      default: false
    },
    expiresAt: {
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

MedicationSharingSchema.index({ userId: 1, caregiverId: 1 });
MedicationSharingSchema.index({ caregiverId: 1, status: 1 });

module.exports = mongoose.model('MedicationSharing', MedicationSharingSchema);