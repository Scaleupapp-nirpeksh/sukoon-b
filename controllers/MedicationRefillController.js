const MedicationRefill = require('../models/MedicationRefill');
const Medication = require('../models/medicationModel');
const logger = require('../utils/logger');

/**
 * Record medication refill
 * @route POST /api/medications/:id/refill
 */
exports.recordRefill = async (req, res) => {
  try {
    const { quantityAdded, refillDate, pharmacy, prescriptionId, cost, notes } = req.body;
    
    // Validate required fields
    if (!quantityAdded || quantityAdded <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Quantity added must be greater than 0'
      });
    }
    
    // Find the medication
    const medication = await Medication.findOne({
      _id: req.params.id,
      $or: [
        { userId: req.user._id }, // User's own medication
        { sharedWith: req.user._id } // Medication shared with user (check if they have refill permission)
      ]
    });
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found or you do not have access to it'
      });
    }
    
    // If a caregiver is recording this, check permissions
    if (medication.userId.toString() !== req.user._id.toString()) {
      const sharing = await MedicationSharing.findOne({
        medicationId: medication._id,
        caregiverId: req.user._id,
        status: 'active'
      });
      
      if (!sharing || !sharing.permissions.canRecordRefills) {
        return res.status(403).json({
          status: 'error',
          message: 'You do not have permission to record refills for this medication'
        });
      }
    }
    
    // Create refill record
    const refill = new MedicationRefill({
      userId: medication.userId, // Always use medication owner's ID
      medicationId: medication._id,
      refillDate: refillDate ? new Date(refillDate) : new Date(),
      quantityAdded: parseInt(quantityAdded),
      previousQuantity: medication.remainingQuantity || 0,
      newQuantity: (medication.remainingQuantity || 0) + parseInt(quantityAdded),
      pharmacy,
      prescriptionId,
      cost,
      recordedBy: req.user._id,
      notes
    });
    
    await refill.save();
    
    // Update medication
    const previousQuantity = medication.remainingQuantity || 0;
    medication.remainingQuantity = previousQuantity + parseInt(quantityAdded);
    medication.lastRefillDate = refill.refillDate;
    
    // Calculate next refill date
    if (medication.totalQuantity && medication.frequency && medication.frequency.timesPerDay) {
      const dailyDoses = medication.frequency.timesPerDay;
      const daysSupply = Math.floor(medication.remainingQuantity / dailyDoses);
      
      const nextRefillDate = new Date(refill.refillDate);
      nextRefillDate.setDate(nextRefillDate.getDate() + daysSupply - (medication.refillReminderDays || 7));
      
      medication.nextRefillDate = nextRefillDate;
    }
    
    await medication.save();
    
    res.status(201).json({
      status: 'success',
      message: 'Refill recorded successfully',
      refill,
      medication: {
        id: medication._id,
        name: medication.name,
        previousQuantity,
        newQuantity: medication.remainingQuantity,
        lastRefillDate: medication.lastRefillDate,
        nextRefillDate: medication.nextRefillDate
      }
    });
  } catch (error) {
    logger.error('Error recording refill:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to record refill',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get refill history for a medication
 * @route GET /api/medications/:id/refills
 */
exports.getRefillHistory = async (req, res) => {
  try {
    // Find the medication
    const medication = await Medication.findOne({
      _id: req.params.id,
      $or: [
        { userId: req.user._id },
        { sharedWith: req.user._id }
      ]
    });
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found or you do not have access to it'
      });
    }
    
    // Get refill history
    const refills = await MedicationRefill.find({ medicationId: medication._id })
      .sort({ refillDate: -1 })
      .populate('recordedBy', 'fullName');
    
    // Calculate statistics
    const stats = {
      totalRefills: refills.length,
      totalQuantityAdded: refills.reduce((sum, refill) => sum + refill.quantityAdded, 0),
      averageRefillInterval: calculateAverageRefillInterval(refills),
      averageQuantityPerRefill: refills.length > 0 ? 
        Math.round(refills.reduce((sum, refill) => sum + refill.quantityAdded, 0) / refills.length) : 0
    };
    
    res.status(200).json({
      status: 'success',
      medication: {
        id: medication._id,
        name: medication.name,
        remainingQuantity: medication.remainingQuantity,
        lastRefillDate: medication.lastRefillDate,
        nextRefillDate: medication.nextRefillDate
      },
      refills,
      stats
    });
  } catch (error) {
    logger.error('Error getting refill history:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get refill history',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Calculate average interval between refills in days
 */
function calculateAverageRefillInterval(refills) {
  if (!refills || refills.length < 2) return null;
  
  // Sort refills by date (oldest first)
  const sortedRefills = [...refills].sort((a, b) => 
    new Date(a.refillDate) - new Date(b.refillDate));
  
  let totalDays = 0;
  let intervals = 0;
  
  for (let i = 1; i < sortedRefills.length; i++) {
    const currentDate = new Date(sortedRefills[i].refillDate);
    const previousDate = new Date(sortedRefills[i-1].refillDate);
    
    const daysDiff = Math.round((currentDate - previousDate) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > 0) {
      totalDays += daysDiff;
      intervals++;
    }
  }
  
  return intervals > 0 ? Math.round(totalDays / intervals) : null;
}