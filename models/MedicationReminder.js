const mongoose = require('mongoose');

const MedicationReminderSchema = new mongoose.Schema(
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
      required: true
    },
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicationSchedule'
    },
    reminderTime: {
      type: Date,
      required: true,
      index: true
    },
    offset: {
      type: Number, // Minutes before scheduled time
      default: 10
    },
    enabled: {
      type: Boolean,
      default: true
    },
    channels: [{
      type: String,
      enum: ['push', 'sms', 'whatsapp', 'email'],
    }],
    message: {
      type: String
    },
    reminderType: {
      type: String,
      enum: ['dose', 'refill', 'appointment'],
      default: 'dose'
    },
    smartReminder: {
      enabled: { type: Boolean, default: false },
      maxReminders: { type: Number, default: 3 },
      reminderInterval: { type: Number, default: 10 } // Minutes between reminders
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'acknowledged', 'snoozed', 'missed'],
      default: 'pending',
      index: true
    },
    responseAction: {
      type: String,
      enum: ['taken', 'skipped', 'snoozed', 'none'],
      default: 'none'
    },
    sentAt: {
      type: Date
    },
    acknowledgedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
  }
);

MedicationReminderSchema.index({ reminderTime: 1, status: 1 });
MedicationReminderSchema.index({ userId: 1, status: 1, reminderTime: 1 });

module.exports = mongoose.model('MedicationReminder', MedicationReminderSchema);