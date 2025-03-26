const mongoose = require('mongoose');

const MedicationScheduleSchema = new mongoose.Schema(
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
    scheduleType: {
      type: String,
      enum: ['regular', 'as_needed', 'cycle'],
      default: 'regular'
    },
    times: [{
      hour: { type: Number, min: 0, max: 23 },
      minute: { type: Number, min: 0, max: 59 },
      dose: { type: String },
      label: { type: String } // e.g., "Morning", "With dinner"
    }],
    daysOfWeek: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }],
    cyclePattern: {
      daysOn: { type: Number }, // For medications taken for X days
      daysOff: { type: Number }, // Then off for Y days
      currentDay: { type: Number },
      cycleStartDate: { type: Date }
    },
    flexibility: {
      type: Number, // Minutes of flexibility allowed
      default: 30
    },
    instructions: {
      type: String // e.g., "Take with food"
    },
    active: {
      type: Boolean,
      default: true,
      index: true
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date
    }
  },
  {
    timestamps: true,
  }
);

MedicationScheduleSchema.index({ userId: 1, active: 1 });

module.exports = mongoose.model('MedicationSchedule', MedicationScheduleSchema);