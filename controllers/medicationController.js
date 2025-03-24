const Medication = require('../models/medicationModel');

// Add medication
exports.addMedication = async (req, res) => {
  try {
    const {
      name,
      dosage,
      dosageForm,
      frequency,
      purpose,
      prescriber,
      startDate,
      endDate,
      remainingQuantity,
      totalQuantity,
      refillReminder,
      refillReminderDays,
      sideEffects
    } = req.body;
    
    // Validate required fields
    if (!name || !dosage || !dosageForm || !frequency || !startDate) {
      return res.status(400).json({
        status: 'error',
        message: 'Required fields missing',
      });
    }
    
    // Create new medication
    const medication = new Medication({
      userId: req.user._id,
      name,
      dosage,
      dosageForm,
      frequency,
      purpose,
      prescriber,
      startDate,
      endDate,
      remainingQuantity,
      totalQuantity,
      refillReminder: refillReminder || false,
      refillReminderDays: refillReminderDays || 7,
      sideEffects: sideEffects || []
    });
    
    await medication.save();
    
    res.status(201).json({
      status: 'success',
      message: 'Medication added successfully',
      medication
    });
  } catch (error) {
    console.error('Error adding medication:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to add medication',
      error: error.message
    });
  }
};

// Get user medications
exports.getUserMedications = async (req, res) => {
  try {
    const medications = await Medication.find({ 
      userId: req.user._id,
      isActive: true
    }).sort({ createdAt: -1 });
    
    res.status(200).json({
      status: 'success',
      count: medications.length,
      medications
    });
  } catch (error) {
    console.error('Error getting medications:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medications',
    });
  }
};

// Get medication details
exports.getMedicationDetails = async (req, res) => {
  try {
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
    
    res.status(200).json({
      status: 'success',
      medication
    });
  } catch (error) {
    console.error('Error getting medication details:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medication details',
    });
  }
};

// Update medication
exports.updateMedication = async (req, res) => {
  try {
    const {
      name,
      dosage,
      dosageForm,
      frequency,
      purpose,
      prescriber,
      startDate,
      endDate,
      remainingQuantity,
      totalQuantity,
      refillReminder,
      refillReminderDays,
      sideEffects
    } = req.body;
    
    const medication = await Medication.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        name,
        dosage,
        dosageForm,
        frequency,
        purpose,
        prescriber,
        startDate,
        endDate,
        remainingQuantity,
        totalQuantity,
        refillReminder,
        refillReminderDays,
        sideEffects
      },
      { new: true }
    );
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found',
      });
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Medication updated successfully',
      medication
    });
  } catch (error) {
    console.error('Error updating medication:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update medication',
    });
  }
};

// Delete medication (soft delete)
exports.deleteMedication = async (req, res) => {
  try {
    const medication = await Medication.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isActive: false },
      { new: true }
    );
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found',
      });
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Medication deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting medication:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete medication',
    });
  }
};