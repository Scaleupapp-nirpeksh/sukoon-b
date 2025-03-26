const MedicationReminder = require('../models/MedicationReminder');
const Medication = require('../models/medicationModel');
const MedicationSchedule = require('../models/MedicationSchedule');
const MedicationLog = require('../models/MedicationLog');
const logger = require('../utils/logger');
const { sendPushNotification } = require('../services/notificationService');

/**
 * Get upcoming medication reminders
 * @route GET /api/medications/reminders
 */
exports.getUpcomingReminders = async (req, res) => {
  try {
    const { days = 1, medicationId } = req.query;
    
    // Calculate time range
    const startTime = new Date();
    const endTime = new Date();
    endTime.setDate(endTime.getDate() + parseInt(days));
    
    // Build query
    const query = {
      userId: req.user._id,
      enabled: true,
      status: { $in: ['pending', 'snoozed'] },
      reminderTime: {
        $gte: startTime,
        $lte: endTime
      }
    };
    
    if (medicationId) {
      query.medicationId = medicationId;
    }
    
    // Get reminders with medication details
    const reminders = await MedicationReminder.find(query)
      .sort({ reminderTime: 1 })
      .populate('medicationId', 'name dosage dosageForm')
      .populate('scheduleId', 'times daysOfWeek');
    
    res.status(200).json({
      status: 'success',
      count: reminders.length,
      reminders
    });
  } catch (error) {
    logger.error('Error getting upcoming reminders:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get upcoming reminders',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Update reminder settings
 * @route PUT /api/medications/reminders/:id
 */
exports.updateReminder = async (req, res) => {
  try {
    const { 
      enabled,
      reminderTime,
      offset,
      channels,
      message,
      smartReminder
    } = req.body;
    
    // Find reminder and check ownership
    const reminder = await MedicationReminder.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!reminder) {
      return res.status(404).json({
        status: 'error',
        message: 'Reminder not found or you do not have permission to update it'
      });
    }
    
    // Update fields
    if (enabled !== undefined) reminder.enabled = enabled;
    if (reminderTime) reminder.reminderTime = new Date(reminderTime);
    if (offset !== undefined) reminder.offset = offset;
    if (channels) reminder.channels = channels;
    if (message) reminder.message = message;
    if (smartReminder) {
      reminder.smartReminder = {
        ...reminder.smartReminder,
        ...smartReminder
      };
    }
    
    // If we're re-enabling a reminder, reset its status
    if (enabled && !reminder.enabled) {
      reminder.status = 'pending';
    }
    
    await reminder.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Reminder updated successfully',
      reminder
    });
  } catch (error) {
    logger.error('Error updating reminder:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update reminder',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Handle reminder response (taken, skipped, snoozed)
 * @route POST /api/medications/reminders/:id/respond
 */
exports.respondToReminder = async (req, res) => {
  try {
    const { action, snoozeMinutes, notes } = req.body;
    
    // Validate action
    const validActions = ['taken', 'skipped', 'snoozed'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }
    
    // Find reminder
    const reminder = await MedicationReminder.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!reminder) {
      return res.status(404).json({
        status: 'error',
        message: 'Reminder not found'
      });
    }
    
    // Handle action
    if (action === 'snoozed') {
      // Validate snooze minutes
      if (!snoozeMinutes || snoozeMinutes < 5 || snoozeMinutes > 120) {
        return res.status(400).json({
          status: 'error',
          message: 'Snooze time must be between 5 and 120 minutes'
        });
      }
      
      // Calculate new reminder time
      const newReminderTime = new Date();
      newReminderTime.setMinutes(newReminderTime.getMinutes() + parseInt(snoozeMinutes));
      
      // Update reminder
      reminder.status = 'snoozed';
      reminder.responseAction = 'snoozed';
      reminder.reminderTime = newReminderTime;
      reminder.acknowledgedAt = new Date();
      
      await reminder.save();
      
      res.status(200).json({
        status: 'success',
        message: `Reminder snoozed for ${snoozeMinutes} minutes`,
        reminder
      });
    } else {
      // Update reminder status
      reminder.status = 'acknowledged';
      reminder.responseAction = action;
      reminder.acknowledgedAt = new Date();
      
      await reminder.save();
      
      // Create medication log entry
      const medicationLog = new MedicationLog({
        userId: reminder.userId,
        medicationId: reminder.medicationId,
        scheduledTime: reminder.reminderTime,
        takenTime: action === 'taken' ? new Date() : null,
        status: action,
        notes,
        recordedBy: req.user._id,
        recordedAt: new Date(),
        quantityAdjustment: action === 'taken' ? -1 : 0
      });
      
      await medicationLog.save();
      
      // Update medication remaining quantity if taken
      if (action === 'taken') {
        const medication = await Medication.findById(reminder.medicationId);
        
        if (medication && medication.remainingQuantity !== undefined) {
          medication.remainingQuantity = Math.max(0, medication.remainingQuantity - 1);
          await medication.save();
        }
      }
      
      res.status(200).json({
        status: 'success',
        message: `Medication marked as ${action}`,
        reminder,
        message: `Medication marked as ${action}`,
       reminder,
       medicationLog
     });
   }
 } catch (error) {
   logger.error('Error responding to reminder:', error);
   res.status(500).json({
     status: 'error',
     message: 'Failed to process reminder response',
     error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
   });
 }
};

/**
* Create medication reminders
* @route POST /api/medications/:medicationId/reminders
*/
exports.createReminders = async (req, res) => {
 try {
   const { medicationId } = req.params;
   const { reminders } = req.body;
   
   // Check if medication exists and belongs to the user
   const medication = await Medication.findOne({
     _id: medicationId,
     userId: req.user._id
   });
   
   if (!medication) {
     return res.status(404).json({
       status: 'error',
       message: 'Medication not found or you do not have permission to update it'
     });
   }
   
   // Validate reminders array
   if (!reminders || !Array.isArray(reminders) || reminders.length === 0) {
     return res.status(400).json({
       status: 'error',
       message: 'At least one reminder configuration is required'
     });
   }
   
   // Process each reminder
   const createdReminders = [];
   const errors = [];
   
   for (const reminderConfig of reminders) {
     try {
       const reminder = new MedicationReminder({
         userId: req.user._id,
         medicationId,
         scheduleId: reminderConfig.scheduleId,
         reminderTime: reminderConfig.reminderTime,
         offset: reminderConfig.offset || 10,
         enabled: reminderConfig.enabled !== false,
         channels: reminderConfig.channels || ['push'],
         message: reminderConfig.message || `Time to take ${medication.name}`,
         reminderType: reminderConfig.reminderType || 'dose',
         smartReminder: reminderConfig.smartReminder || {
           enabled: true,
           maxReminders: 3,
           reminderInterval: 10
         },
         status: 'pending'
       });
       
       await reminder.save();
       createdReminders.push(reminder);
     } catch (err) {
       errors.push({
         reminderConfig,
         error: err.message
       });
     }
   }
   
   // Update medication with reminder IDs
   if (createdReminders.length > 0) {
     const reminderIds = medication.reminderIds || [];
     createdReminders.forEach(r => reminderIds.push(r._id));
     
     await Medication.findByIdAndUpdate(medicationId, {
       reminderIds
     });
   }
   
   res.status(201).json({
     status: 'success',
     message: `${createdReminders.length} reminders created successfully`,
     createdCount: createdReminders.length,
     reminders: createdReminders,
     errors: errors.length > 0 ? errors : undefined
   });
 } catch (error) {
   logger.error('Error creating reminders:', error);
   res.status(500).json({
     status: 'error',
     message: 'Failed to create reminders',
     error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
   });
 }
};

/**
* Delete a reminder
* @route DELETE /api/medications/reminders/:id
*/
exports.deleteReminder = async (req, res) => {
 try {
   // Find reminder and check ownership
   const reminder = await MedicationReminder.findOne({
     _id: req.params.id,
     userId: req.user._id
   });
   
   if (!reminder) {
     return res.status(404).json({
       status: 'error',
       message: 'Reminder not found or you do not have permission to delete it'
     });
   }
   
   // Get medication
   const medication = await Medication.findById(reminder.medicationId);
   
   // Delete reminder
   await MedicationReminder.findByIdAndDelete(req.params.id);
   
   // Update medication's reminder IDs if medication exists
   if (medication && medication.reminderIds && medication.reminderIds.length > 0) {
     medication.reminderIds = medication.reminderIds.filter(id => 
       id.toString() !== req.params.id.toString());
     
     await medication.save();
   }
   
   res.status(200).json({
     status: 'success',
     message: 'Reminder deleted successfully'
   });
 } catch (error) {
   logger.error('Error deleting reminder:', error);
   res.status(500).json({
     status: 'error',
     message: 'Failed to delete reminder',
     error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
   });
 }
};

