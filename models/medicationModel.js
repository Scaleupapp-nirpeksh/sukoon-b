const mongoose = require('mongoose');

const MedicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
    },
    genericName: {
      type: String // Important for drug interaction checking
    },
    brandName: {
      type: String // For brand-name medications
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
    strength: {
      value: { type: Number },
      unit: { type: String }
    },
    doseSize: {
      type: Number, // Number of units per dose (e.g., 2 tablets)
      default: 1
    },
    frequency: {
      timesPerDay: { type: Number, required: true },
      specificTimes: [{ type: String }],
      daysOfWeek: [{ 
        type: String, 
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] 
      }],
      instructions: { type: String },
      asNeeded: { type: Boolean, default: false } // For PRN medications
    },
    purpose: { type: String },
    prescriber: { type: String },
    category: {
      type: String,
      enum: ['prescription', 'otc', 'supplement', 'herbal'],
      default: 'prescription'
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: { type: Date },
    status: {
      type: String,
      enum: ['active', 'completed', 'paused', 'discontinued'],
      default: 'active',
      index: true
    },
    discontinuationReason: {
      type: String
    },
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
    lastRefillDate: {
      type: Date
    },
    nextRefillDate: {
      type: Date
    },
    prescriptionImage: { type: String },
    originalPrescription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Prescription'
    },
    sideEffects: [{ 
      effect: { type: String },
      severity: { type: Number, min: 1, max: 5 },
      reported: { type: Date, default: Date.now }
    }],
    interactions: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DrugInteraction'
    },
    instructions: {
      type: String // Special instructions for taking this medication
    },
    warnings: [{
      type: String // Important warnings about this medication
    }],
    reminderIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicationReminder'
    }],
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    efficacyRating: {
      type: Number,
      min: 1,
      max: 5
    },
    adherenceRate: {
      type: Number, // Calculated field, percentage of doses taken
      min: 0,
      max: 100
    },
    tags: [{ type: String }], // For categorizing medications
    pharmacy: {
      name: { type: String },
      phone: { type: String },
      address: { type: String }
    },
    sharedWith: [{ 
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  {
    timestamps: true,
  }
);

// Add indexes for common queries
MedicationSchema.index({ userId: 1, isActive: 1 });
MedicationSchema.index({ userId: 1, refillReminder: 1, remainingQuantity: 1 });
MedicationSchema.index({ startDate: 1, endDate: 1 });
MedicationSchema.index({ name: 1, genericName: 1 }); // For drug interaction searches
MedicationSchema.index({ userId: 1, status: 1, category: 1 }); // For filtering active medications by type

module.exports = mongoose.model('Medication', MedicationSchema);