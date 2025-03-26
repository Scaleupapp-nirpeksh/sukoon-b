

const mongoose = require('mongoose');
const Medication = require('../models/medicationModel');
const MedicationLog = require('../models/MedicationLog');
const MedicationSchedule = require('../models/MedicationSchedule');
const MedicationSharing = require('../models/MedicationSharing');
const MedicationReminder = require('../models/MedicationReminder');
const logger = require('../utils/logger');

/**
 * Add new medication
 * @route POST /api/medications
 */

  exports.addMedication = async (req, res) => {
  try {
    const {
      name,
      genericName,
      brandName,
      dosage,
      dosageForm,
      strength,
      doseSize,
      frequency,
      purpose,
      prescriber,
      category,
      startDate,
      endDate,
      status,
      remainingQuantity,
      totalQuantity,
      refillReminder,
      refillReminderDays,
      prescriptionImage,
      instructions,
      warnings,
      sideEffects,
      pharmacy,
      tags
    } = req.body;
    
    // Validate required fields
    if (!name || !dosage || !dosageForm || !frequency || !startDate) {
      return res.status(400).json({
        status: 'error',
        message: 'Required fields missing: name, dosage, dosageForm, frequency, and startDate are required',
      });
    }
    
    // Validate frequency object
    if (!frequency.timesPerDay) {
      return res.status(400).json({
        status: 'error',
        message: 'Frequency must include timesPerDay',
      });
    }

    // Create new medication
    const medication = new Medication({
      userId: req.user._id,
      name,
      genericName: genericName || name,
      brandName,
      dosage,
      dosageForm,
      strength,
      doseSize: doseSize || 1,
      frequency,
      purpose,
      prescriber,
      category: category || 'prescription',
      startDate,
      endDate,
      status: status || 'active',
      remainingQuantity,
      totalQuantity,
      refillReminder: refillReminder || false,
      refillReminderDays: refillReminderDays || 7,
      prescriptionImage,
      instructions,
      warnings: warnings || [],
      sideEffects: sideEffects ? sideEffects.map(effect => {
        if (typeof effect === 'string') {
          return { effect, severity: 1, reported: new Date() };
        }
        return effect;
      }) : [],
      isActive: true,
      pharmacy,
      tags: tags || []
    });
    
    await medication.save();
    
    // If a medication schedule was provided, create it
    if (req.body.schedule) {
      await createMedicationSchedule(medication._id, req.user._id, req.body.schedule);
    } else {
      // Create a default schedule based on the frequency
      await createDefaultSchedule(medication._id, req.user._id, frequency);
    }
    
    // If reminders are enabled, create default reminders
    if (req.body.enableReminders) {
      await createDefaultReminders(medication._id, req.user._id);
    }
    
    // If this is a new prescription-type medication, check for interactions
    if (category === 'prescription' || !category) {
      // Queue a job to check for interactions with existing medications
      // This can be done asynchronously, so we don't need to wait for it
      checkMedicationInteractions(medication._id, req.user._id);
    }
    
    res.status(201).json({
      status: 'success',
      message: 'Medication added successfully',
      medication
    });
  } catch (error) {
    logger.error('Error adding medication:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to add medication',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get user medications with filtering options
 * @route GET /api/medications
 */
exports.getUserMedications = async (req, res) => {
  try {
    const { 
      status, 
      category, 
      search,
      sort = 'name',
      order = 'asc',
      page = 1,
      limit = 20,
      includeSchedule = false,
      includeAdherence = false
    } = req.query;
    
    const query = { 
      userId: req.user._id,
      isActive: true
    };
    
    // Add filters if provided
    if (status) query.status = status;
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } },
        { brandName: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Determine sort order
    const sortOption = {};
    sortOption[sort] = order === 'desc' ? -1 : 1;
    
    // Get medications with pagination and sorting
    let medicationsQuery = Medication.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit));
      
    // Count total for pagination
    const total = await Medication.countDocuments(query);
    
    // Execute query
    let medications = await medicationsQuery;
    
    // If requested, include medication schedules
    if (includeSchedule === 'true' || includeSchedule === true) {
      const medicationIds = medications.map(med => med._id);
      const schedules = await MedicationSchedule.find({
        medicationId: { $in: medicationIds },
        active: true
      });
      
      // Create map for quick lookup
      const scheduleMap = {};
      schedules.forEach(schedule => {
        scheduleMap[schedule.medicationId.toString()] = schedule;
      });
      
      // Add schedules to medications
      medications = medications.map(med => {
        const medObj = med.toObject();
        medObj.schedule = scheduleMap[med._id.toString()] || null;
        return medObj;
      });
    }
    
    // If requested, include adherence stats
    if (includeAdherence === 'true' || includeAdherence === true) {
      const medicationIds = medications.map(med => med._id);
      
      // Get adherence for each medication in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const adherenceLogs = await MedicationLog.aggregate([
        {
          $match: {
            medicationId: { $in: medicationIds.map(id => mongoose.Types.ObjectId(id)) },
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: '$medicationId',
            totalLogs: { $sum: 1 },
            takenCount: { 
              $sum: { 
                $cond: [{ $eq: ['$status', 'taken'] }, 1, 0] 
              } 
            }
          }
        }
      ]);
      
      // Create map for quick lookup
      const adherenceMap = {};
      adherenceLogs.forEach(log => {
        adherenceMap[log._id.toString()] = {
          rate: log.totalLogs > 0 ? Math.round((log.takenCount / log.totalLogs) * 100) : null,
          logsCount: log.totalLogs
        };
      });
      
      // Add adherence to medications
      medications = medications.map(med => {
        const medObj = typeof med.toObject === 'function' ? med.toObject() : med;
        medObj.adherence = adherenceMap[med._id.toString()] || { rate: null, logsCount: 0 };
        return medObj;
      });
    }
    
    res.status(200).json({
      status: 'success',
      count: medications.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      medications
    });
  } catch (error) {
    logger.error('Error getting medications:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medications',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get medication details with related data
 * @route GET /api/medications/:id
 */
exports.getMedicationDetails = async (req, res) => {
  try {
    const { includeSchedule, includeAdherence, includeLogs, includeRefills } = req.query;
    
    const medication = await Medication.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found',
      });
    }
    
    // Create result object
    const result = {
      medication: medication.toObject()
    };
    
    // Include schedule if requested
    if (includeSchedule === 'true') {
      const schedule = await MedicationSchedule.findOne({
        medicationId: medication._id,
        active: true
      });
      
      result.schedule = schedule;
    }
    
    // Include adherence if requested
    if (includeAdherence === 'true') {
      // Get adherence for last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const logs = await MedicationLog.find({
        medicationId: medication._id,
        createdAt: { $gte: thirtyDaysAgo }
      });
      
      // Calculate adherence
      const totalLogs = logs.length;
      const takenLogs = logs.filter(log => log.status === 'taken').length;
      
      result.adherence = {
        rate: totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : null,
        logsCount: totalLogs,
        lastTaken: logs.filter(log => log.status === 'taken')
          .sort((a, b) => b.takenTime - a.takenTime)[0]?.takenTime || null
      };
    }
    
    // Include recent logs if requested
    if (includeLogs === 'true') {
      const logs = await MedicationLog.find({
        medicationId: medication._id
      })
      .sort({ createdAt: -1 })
      .limit(10);
      
      result.recentLogs = logs;
    }
    
    // Include refill history if requested
    if (includeRefills === 'true') {
      const refills = await MedicationRefill.find({
        medicationId: medication._id
      })
      .sort({ refillDate: -1 });
      
      result.refills = refills;
    }
    
    res.status(200).json({
      status: 'success',
      ...result
    });
  } catch (error) {
    logger.error('Error getting medication details:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medication details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Update medication
 * @route PUT /api/medications/:id
 */
exports.updateMedication = async (req, res) => {
  try {
    const {
      name,
      genericName,
      brandName,
      dosage,
      dosageForm,
      strength,
      doseSize,
      frequency,
      purpose,
      prescriber,
      category,
      startDate,
      endDate,
      status,
      remainingQuantity,
      totalQuantity,
      refillReminder,
      refillReminderDays,
      prescriptionImage,
      instructions,
      warnings,
      sideEffects,
      pharmacy,
      tags
    } = req.body;
    
    // Find the medication first to check for changes
    const existingMedication = await Medication.findOne({
      _id: req.params.id, 
      userId: req.user._id
    });
    
    if (!existingMedication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found',
      });
    }
    
    // Check if name or frequency changed (important for schedules)
    const nameChanged = name && name !== existingMedication.name;
    const frequencyChanged = frequency && JSON.stringify(frequency) !== JSON.stringify(existingMedication.frequency);
    
    // Prepare update object with only the fields that are provided
    const updateData = {};
    if (name) updateData.name = name;
    if (genericName) updateData.genericName = genericName;
    if (brandName) updateData.brandName = brandName;
    if (dosage) updateData.dosage = dosage;
    if (dosageForm) updateData.dosageForm = dosageForm;
    if (strength) updateData.strength = strength;
    if (doseSize) updateData.doseSize = doseSize;
    if (frequency) updateData.frequency = frequency;
    if (purpose) updateData.purpose = purpose;
    if (prescriber) updateData.prescriber = prescriber;
    if (category) updateData.category = category;
    if (startDate) updateData.startDate = startDate;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (status) updateData.status = status;
    if (remainingQuantity !== undefined) updateData.remainingQuantity = remainingQuantity;
    if (totalQuantity !== undefined) updateData.totalQuantity = totalQuantity;
    if (refillReminder !== undefined) updateData.refillReminder = refillReminder;
    if (refillReminderDays) updateData.refillReminderDays = refillReminderDays;
    if (prescriptionImage) updateData.prescriptionImage = prescriptionImage;
    if (instructions) updateData.instructions = instructions;
    if (warnings) updateData.warnings = warnings;
    if (sideEffects) {
      updateData.sideEffects = sideEffects.map(effect => {
        if (typeof effect === 'string') {
          return { effect, severity: 1, reported: new Date() };
        }
        return effect;
      });
    }
    if (pharmacy) updateData.pharmacy = pharmacy;
    if (tags) updateData.tags = tags;
    
    // Update medication
    const medication = await Medication.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true }
    );
    
    // If name or frequency changed, update the schedule
   if (nameChanged || frequencyChanged) {
     if (req.body.schedule) {
       // Update with provided schedule
       await updateMedicationSchedule(medication._id, req.user._id, req.body.schedule);
     } else if (frequencyChanged) {
       // Update with default schedule based on new frequency
       await updateDefaultSchedule(medication._id, req.user._id, frequency);
     }
   }
   
   // If status changed to discontinued, update reminders
   if (status && status === 'discontinued' && existingMedication.status !== 'discontinued') {
     await disableMedicationReminders(medication._id);
   }
   
   // If medication was modified significantly, check for interactions
   if (nameChanged || genericName !== existingMedication.genericName) {
     checkMedicationInteractions(medication._id, req.user._id);
   }
   
   res.status(200).json({
     status: 'success',
     message: 'Medication updated successfully',
     medication
   });
 } catch (error) {
   logger.error('Error updating medication:', error);
   res.status(500).json({
     status: 'error',
     message: 'Failed to update medication',
     error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
   });
 }
};

/**
* Delete medication (soft delete)
* @route DELETE /api/medications/:id
*/
exports.deleteMedication = async (req, res) => {
 try {
   const medication = await Medication.findOneAndUpdate(
     { _id: req.params.id, userId: req.user._id },
     { 
       isActive: false,
       status: 'discontinued',
       discontinuationReason: req.body.reason || 'User deleted'
     },
     { new: true }
   );
   
   if (!medication) {
     return res.status(404).json({
       status: 'error',
       message: 'Medication not found',
     });
   }
   
   // Disable schedules and reminders
   await MedicationSchedule.updateMany(
     { medicationId: medication._id },
     { active: false }
   );
   
   await disableMedicationReminders(medication._id);
   
   res.status(200).json({
     status: 'success',
     message: 'Medication deleted successfully'
   });
 } catch (error) {
   logger.error('Error deleting medication:', error);
   res.status(500).json({
     status: 'error',
     message: 'Failed to delete medication',
     error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
   });
 }
};

/**
* Get medications that need refill
* @route GET /api/medications/refill-needed
*/
exports.getMedicationsNeedingRefill = async (req, res) => {
 try {
   // Get active medications with refill reminder enabled
   const medications = await Medication.find({
     userId: req.user._id,
     isActive: true,
     refillReminder: true,
     status: 'active'
   });
   
   // Filter medications that need refill based on remaining quantity or days of supply
   const medicationsNeedingRefill = medications.filter(med => {
     // If no remaining quantity is set, can't determine refill need
     if (med.remainingQuantity === undefined || med.remainingQuantity === null) return false;
     
     // If total quantity is set, check percentage remaining
     if (med.totalQuantity) {
       const percentRemaining = (med.remainingQuantity / med.totalQuantity) * 100;
       return percentRemaining <= 25; // Need refill if less than 25% remaining
     }
     
     // Otherwise, check if remaining quantity is below threshold
     const dailyDoses = med.frequency.timesPerDay || 1;
     const daysRemaining = med.remainingQuantity / dailyDoses;
     return daysRemaining <= (med.refillReminderDays || 7);
   });
   
   // Calculate days remaining for each medication
   const result = medicationsNeedingRefill.map(med => {
     const dailyDoses = med.frequency.timesPerDay || 1;
     const daysRemaining = Math.floor(med.remainingQuantity / dailyDoses);
     
     return {
       ...med.toObject(),
       daysRemaining,
       urgency: daysRemaining <= 3 ? 'high' : 'medium'
     };
   });
   
   // Sort by urgency (days remaining)
   result.sort((a, b) => a.daysRemaining - b.daysRemaining);
   
   res.status(200).json({
     status: 'success',
     count: result.length,
     medications: result
   });
 } catch (error) {
   logger.error('Error getting medications needing refill:', error);
   res.status(500).json({
     status: 'error',
     message: 'Failed to get medications needing refill',
     error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
   });
 }
};

// Helper functions

/**
* Create a default medication schedule based on frequency
*/
async function createDefaultSchedule(medicationId, userId, frequency) {
 try {
   // Create times array based on frequency.timesPerDay
   const times = [];
   const timesPerDay = frequency.timesPerDay || 1;
   
   if (frequency.specificTimes && frequency.specificTimes.length > 0) {
     // Use specific times if provided
     frequency.specificTimes.forEach(time => {
       const [hours, minutes] = time.split(':').map(Number);
       times.push({
         hour: hours,
         minute: minutes || 0,
         dose: '1 dose',
         label: getTimeLabel(hours)
       });
     });
   } else {
     // Generate evenly spaced times otherwise
     const startHour = 8; // 8 AM
     const endHour = 22; // 10 PM
     const interval = Math.floor((endHour - startHour) / (timesPerDay - 1 || 1));
     
     for (let i = 0; i < timesPerDay; i++) {
       const hour = startHour + (i * interval);
       times.push({
         hour,
         minute: 0,
         dose: '1 dose',
         label: getTimeLabel(hour)
       });
     }
   }
   
   // Create schedule
   const schedule = new MedicationSchedule({
     userId,
     medicationId,
     scheduleType: frequency.asNeeded ? 'as_needed' : 'regular',
     times,
     daysOfWeek: frequency.daysOfWeek || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
     instructions: frequency.instructions,
     active: true,
     startDate: new Date()
   });
   
   await schedule.save();
   return schedule;
 } catch (error) {
   logger.error('Error creating default schedule:', error);
   throw error;
 }
}

/**
* Update a medication schedule
*/
async function updateMedicationSchedule(medicationId, userId, scheduleData) {
 try {
   // Find existing schedule
   const existingSchedule = await MedicationSchedule.findOne({
     medicationId,
     userId,
     active: true
   });
   
   if (existingSchedule) {
     // Update existing schedule
     Object.assign(existingSchedule, {
       scheduleType: scheduleData.scheduleType || existingSchedule.scheduleType,
       times: scheduleData.times || existingSchedule.times,
       daysOfWeek: scheduleData.daysOfWeek || existingSchedule.daysOfWeek,
       cyclePattern: scheduleData.cyclePattern || existingSchedule.cyclePattern,
       flexibility: scheduleData.flexibility || existingSchedule.flexibility,
       instructions: scheduleData.instructions || existingSchedule.instructions,
       startDate: scheduleData.startDate || existingSchedule.startDate,
       endDate: scheduleData.endDate
     });
     
     await existingSchedule.save();
     return existingSchedule;
   } else {
     // Create new schedule
     const schedule = new MedicationSchedule({
       userId,
       medicationId,
       scheduleType: scheduleData.scheduleType || 'regular',
       times: scheduleData.times || [],
       daysOfWeek: scheduleData.daysOfWeek || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
       cyclePattern: scheduleData.cyclePattern,
       flexibility: scheduleData.flexibility || 30,
       instructions: scheduleData.instructions,
       active: true,
       startDate: scheduleData.startDate || new Date(),
       endDate: scheduleData.endDate
     });
     
     await schedule.save();
     return schedule;
   }
 } catch (error) {
   logger.error('Error updating medication schedule:', error);
   throw error;
 }
}

/**
* Update the default schedule based on new frequency
*/
async function updateDefaultSchedule(medicationId, userId, frequency) {
 try {
   // Deactivate existing schedule
   await MedicationSchedule.updateMany(
     { medicationId, userId, active: true },
     { active: false }
   );
   
   // Create new default schedule
   return await createDefaultSchedule(medicationId, userId, frequency);
 } catch (error) {
   logger.error('Error updating default schedule:', error);
   throw error;
 }
}

/**
* Create default reminders for a medication
*/
async function createDefaultReminders(medicationId, userId) {
 try {
   // Get the medication schedule
   const schedule = await MedicationSchedule.findOne({
     medicationId,
     userId,
     active: true
   });
   
   if (!schedule) return;
   
   // Create a reminder for each scheduled time
   const reminders = [];
   
   // Get the medication name for the reminder message
   const medication = await Medication.findById(medicationId);
   const medicationName = medication ? medication.name : 'your medication';
   
   for (const time of schedule.times) {
     // Create a default reminder 10 minutes before scheduled time
     const reminder = new MedicationReminder({
       userId,
       medicationId,
       scheduleId: schedule._id,
       reminderTime: new Date(), // Will be set correctly later
       offset: 10, // 10 minutes before scheduled time
       enabled: true,
       channels: ['push'],
       message: `Time to take ${medicationName} (${time.label})`,
       reminderType: 'dose',
       smartReminder: {
         enabled: true,
         maxReminders: 3,
         reminderInterval: 10
       },
       status: 'pending'
     });
     
     reminders.push(reminder);
   }
   
   await MedicationReminder.insertMany(reminders);
   
   // Update medication with reminder IDs
   await Medication.findByIdAndUpdate(medicationId, {
     reminderIds: reminders.map(r => r._id)
   });
   
   return reminders;
 } catch (error) {
   logger.error('Error creating default reminders:', error);
   throw error;
 }
}

/**
* Disable reminders for a medication
*/
async function disableMedicationReminders(medicationId) {
 try {
   await MedicationReminder.updateMany(
     { medicationId },
     { enabled: false }
   );
 } catch (error) {
   logger.error('Error disabling medication reminders:', error);
   throw error;
 }
}

/**
* Get a user-friendly label for a time of day
*/
function getTimeLabel(hour) {
 if (hour < 12) return 'Morning';
 if (hour < 17) return 'Afternoon';
 if (hour < 21) return 'Evening';
 return 'Bedtime';
}

/**
* Check for drug interactions with other medications
*/
async function checkMedicationInteractions(medicationId, userId) {
 try {
   // This would be implemented with drug interaction service
   // For now, we'll just log that we would check
   logger.info(`Would check interactions for medication ${medicationId} for user ${userId}`);
 } catch (error) {
   logger.error('Error checking drug interactions:', error);
   // Don't throw error as this is a background process
 }
}