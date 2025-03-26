const mongoose = require('mongoose');

const PrescriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    prescribedBy: {
      type: String
    },
    prescribedDate: {
      type: Date
    },
    expiryDate: {
      type: Date
    },
    imagePath: {
      type: String // Path to the stored prescription image
    },
    ocrText: {
      type: String // Raw text extracted from the prescription
    },
    extractedMedications: [{
      name: { type: String },
      dosage: { type: String },
      instructions: { type: String },
      quantity: { type: Number },
      refills: { type: Number }
    }],
    linkedMedications: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medication'
    }],
    notes: {
      type: String
    },
    status: {
      type: String,
      enum: ['active', 'filled', 'expired', 'cancelled'],
      default: 'active',
      index: true
    },
    pharmacy: {
      name: { type: String },
      address: { type: String },
      phone: { type: String }
    },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'processed', 'error'],
      default: 'pending'
    },
    verificationStatus: {
      type: String,
      enum: ['unverified', 'partially_verified', 'verified'],
      default: 'unverified'
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Prescription', PrescriptionSchema);