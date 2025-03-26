const mongoose = require('mongoose');

const MedicationRefillSchema = new mongoose.Schema(
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
    refillDate: {
      type: Date,
      default: Date.now,
      index: true
    },
    quantityAdded: {
      type: Number,
      required: true
    },
    previousQuantity: {
      type: Number
    },
    newQuantity: {
      type: Number
    },
    pharmacy: {
      name: { type: String },
      address: { type: String },
      phone: { type: String }
    },
    prescriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Prescription'
    },
    cost: {
      amount: { type: Number },
      currency: { type: String, default: 'INR' }
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: {
      type: String
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MedicationRefill', MedicationRefillSchema);