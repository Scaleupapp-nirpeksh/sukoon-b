const mongoose = require('mongoose');

const MedicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    dosage: {
      type: String,
      required: true,
    },
    dosageForm: {
      type: String,
      enum: ['tablet', 'capsule', 'liquid', 'injection', 'topical', 'other'],
      required: true,
    },
    frequency: {
      timesPerDay: { type: Number, required: true },
      specificTimes: [{ type: String }],
      daysOfWeek: [{ 
        type: String, 
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] 
      }],
      instructions: { type: String }
    },
    purpose: { type: String },
    prescriber: { type: String },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: { type: Date },
    remainingQuantity: { type: Number },
    totalQuantity: { type: Number },
    refillReminder: {
      type: Boolean,
      default: false,
    },
    refillReminderDays: {
      type: Number,
      default: 7,
    },
    prescriptionImage: { type: String },
    sideEffects: [{ type: String }],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Medication', MedicationSchema);