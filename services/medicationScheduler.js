// services/medicationScheduler.js
const cron = require('node-cron');
const MedicationReminder = require('../models/MedicationReminder');
const Medication = require('../models/medicationModel');
const MedicationLog = require('../models/MedicationLog');
const { sendPushNotification } = require('./notificationService');
const logger = require('../utils/logger');

/**
 * Start the medication scheduler that processes due reminders.
 * This will run every 5 minutes.
 */
function startMedicationScheduler() {
  // Schedule the job to run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      logger.info(`Medication Scheduler: Checking for due reminders at ${now.toISOString()}`);

      // Find medication reminders that are due and still pending
      const dueReminders = await MedicationReminder.find({
        enabled: true,
        status: 'pending',
        reminderTime: { $lte: now }
      }).populate('medicationId');

      logger.info(`Medication Scheduler: Found ${dueReminders.length} due reminders`);

      // Process each due reminder
      for (const reminder of dueReminders) {
        try {
          // Optional: Check that the medication is still active
          if (!reminder.medicationId || !reminder.medicationId.isActive) {
            // If medication is not active, mark the reminder as missed
            await MedicationReminder.findByIdAndUpdate(reminder._id, {
              enabled: false,
              status: 'missed'
            });
            continue;
          }

          // Send push notification for the reminder
          await sendPushNotification(
            reminder.userId, // Assuming sendPushNotification accepts a user ID
            'Medication Reminder',
            reminder.message,
            {
              reminderId: reminder._id.toString(),
              medicationId: reminder.medicationId._id.toString(),
              medicationName: reminder.medicationId.name,
              reminderTime: reminder.reminderTime
            }
          );

          // Update the reminder status to "sent" with the current time
          await MedicationReminder.findByIdAndUpdate(reminder._id, {
            status: 'sent',
            sentAt: now
          });

          logger.info(`Medication Scheduler: Reminder ${reminder._id} processed successfully`);
        } catch (innerError) {
          logger.error(`Medication Scheduler: Failed to process reminder ${reminder._id}:`, innerError);
        }
      }
    } catch (error) {
      logger.error('Medication Scheduler: Error checking reminders:', error);
    }
  });

  logger.info('Medication Scheduler started and running every 5 minutes');
}

module.exports = { startMedicationScheduler };
