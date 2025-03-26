// controllers/prescriptionController.js
const mongoose = require('mongoose');
const Prescription = require('../models/Prescription');
const Medication = require('../models/medicationModel');
const { uploadFile, getFileAccess, deleteFile } = require('../utils/s3Service');
const { extractTextFromImage } = require('../services/ocrService');
const { parsePrescription } = require('../utils/prescriptionParser');
const logger = require('../utils/logger');



const getFetch = async () => {
    const { default: fetch } = await import('node-fetch');
    return fetch;
  };


/**
 * Upload a new prescription
 * @route POST /api/prescriptions/upload
 */
exports.uploadPrescription = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No prescription image provided'
      });
    }

    // Upload the prescription image
    const uploadResult = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // Create a new prescription record
    const prescription = new Prescription({
      userId: req.user._id,
      prescribedBy: req.body.prescribedBy || '',
      prescribedDate: req.body.prescribedDate || new Date(),
      expiryDate: req.body.expiryDate,
      imagePath: uploadResult.key,
      status: 'active',
      processingStatus: 'pending',
      verificationStatus: 'unverified',
      pharmacy: {
        name: req.body.pharmacyName,
        address: req.body.pharmacyAddress,
        phone: req.body.pharmacyPhone
      },
      notes: req.body.notes
    });

    await prescription.save();

    res.status(201).json({
      status: 'success',
      message: 'Prescription uploaded successfully',
      prescription: {
        id: prescription._id,
        prescribedBy: prescription.prescribedBy,
        prescribedDate: prescription.prescribedDate,
        status: prescription.status,
        processingStatus: prescription.processingStatus
      }
    });
  } catch (error) {
    logger.error('Error uploading prescription:', error);
    res.status(500).json({
        // controllers/prescriptionController.js (continued)
      status: 'error',
      message: 'Failed to upload prescription',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get user prescriptions with filtering options
 * @route GET /api/prescriptions
 */
exports.getUserPrescriptions = async (req, res) => {
  try {
    const { status, sort = 'prescribedDate', order = 'desc', page = 1, limit = 10 } = req.query;
    
    // Build query
    const query = { userId: req.user._id };
    
    // Add status filter if provided
    if (status) query.status = status;
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Determine sort order
    const sortOption = {};
    sortOption[sort] = order === 'desc' ? -1 : 1;
    
    // Get prescriptions with pagination and sorting
    const prescriptions = await Prescription.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit));
      
    // Get total count for pagination
    const total = await Prescription.countDocuments(query);
    
    // Generate signed URLs for prescription images
    const prescriptionsWithUrls = await Promise.all(prescriptions.map(async (prescription) => {
      const prescriptionObj = prescription.toObject();
      if (prescriptionObj.imagePath) {
        prescriptionObj.imageUrl = await getFileAccess(prescriptionObj.imagePath);
      }
      return prescriptionObj;
    }));
    
    res.status(200).json({
      status: 'success',
      count: prescriptions.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      prescriptions: prescriptionsWithUrls
    });
  } catch (error) {
    logger.error('Error getting user prescriptions:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get prescriptions',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get prescription details
 * @route GET /api/prescriptions/:id
 */
exports.getPrescriptionDetails = async (req, res) => {
  try {
    const prescription = await Prescription.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!prescription) {
      return res.status(404).json({
        status: 'error',
        message: 'Prescription not found'
      });
    }
    
    // Get signed URL for prescription image
    const prescriptionObj = prescription.toObject();
    if (prescriptionObj.imagePath) {
      prescriptionObj.imageUrl = await getFileAccess(prescriptionObj.imagePath);
    }
    
    // If there are linked medications, populate them
    if (prescription.linkedMedications && prescription.linkedMedications.length > 0) {
      const medications = await Medication.find({
        _id: { $in: prescription.linkedMedications }
      });
      
      prescriptionObj.medications = medications;
    }
    
    res.status(200).json({
      status: 'success',
      prescription: prescriptionObj
    });
  } catch (error) {
    logger.error('Error getting prescription details:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get prescription details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Process prescription with OCR
 * @route POST /api/prescriptions/:id/process
 */
exports.processPrescription = async (req, res) => {
  try {
    const prescription = await Prescription.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!prescription) {
      return res.status(404).json({
        status: 'error',
        message: 'Prescription not found'
      });
    }
    
    // Update processing status
    prescription.processingStatus = 'processing';
    await prescription.save();
    
    // Get file access
    const fileUrl = await getFileAccess(prescription.imagePath);
    
    // Fetch the image
    let imageBuffer;
    if (process.env.NODE_ENV === 'production') {
        const fetch = await getFetch();
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      imageBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      // For development, read from local file system
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, '..', 'uploads', prescription.imagePath);
      imageBuffer = await fs.promises.readFile(filePath);
    }
    
    // Extract text using OCR
    const extractedText = await extractTextFromImage(imageBuffer);
    
    // Parse the extracted text
    const extractedMedications = await parsePrescription(extractedText);
    
    // Update prescription with OCR results
    prescription.ocrText = extractedText;
    prescription.extractedMedications = extractedMedications;
    prescription.processingStatus = 'processed';
    
    await prescription.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Prescription processed successfully',
      prescription: {
        id: prescription._id,
        ocrText: prescription.ocrText,
        extractedMedications: prescription.extractedMedications,
        processingStatus: prescription.processingStatus
      }
    });
  } catch (error) {
    logger.error('Error processing prescription:', error);
    
    // Update prescription status to error
    try {
      await Prescription.findByIdAndUpdate(req.params.id, {
        processingStatus: 'error'
      });
    } catch (updateError) {
      logger.error('Error updating prescription status:', updateError);
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to process prescription',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Create medications from prescription
 * @route POST /api/prescriptions/:id/medications
 */
exports.createMedicationsFromPrescription = async (req, res) => {
  try {
    const prescription = await Prescription.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!prescription) {
      return res.status(404).json({
        status: 'error',
        message: 'Prescription not found'
      });
    }
    
    // Check if the prescription has been processed
    if (prescription.processingStatus !== 'processed') {
      return res.status(400).json({
        status: 'error',
        message: 'Prescription has not been processed with OCR yet'
      });
    }
    
    // Get the medications to create
    const medicationsToCreate = req.body.medications || prescription.extractedMedications;
    
    if (!medicationsToCreate || medicationsToCreate.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No medications to create'
      });
    }
    
    // Create medications
    const createdMedications = [];
    const failedMedications = [];
    
    for (const med of medicationsToCreate) {
      try {
        // Parse the dosage to get strength and form
        let strength = null;
        let dosageForm = 'other';
        
        if (med.dosage) {
          // Try to extract strength (e.g., "10mg" -> "10")
          const strengthMatch = med.dosage.match(/(\d+)/);
          if (strengthMatch) {
            strength = {
              value: parseInt(strengthMatch[1]),
              unit: med.dosage.replace(strengthMatch[1], '').trim()
            };
          }
          
          // Try to determine dosage form
          if (med.dosage.toLowerCase().includes('tablet') || med.dosage.toLowerCase().includes('tab')) {
            dosageForm = 'tablet';
          } else if (med.dosage.toLowerCase().includes('capsule') || med.dosage.toLowerCase().includes('cap')) {
            dosageForm = 'capsule';
          } else if (med.dosage.toLowerCase().includes('ml') || med.dosage.toLowerCase().includes('liquid')) {
            dosageForm = 'liquid';
          } else if (med.dosage.toLowerCase().includes('injection') || med.dosage.toLowerCase().includes('inj')) {
            dosageForm = 'injection';
          } else if (med.dosage.toLowerCase().includes('cream') || med.dosage.toLowerCase().includes('ointment')) {
            dosageForm = 'topical';
          }
        }
        
        // Parse instructions to get frequency
        let frequency = {
          timesPerDay: 1,
          instructions: med.instructions
        };
        
        // Try to determine frequency from instructions
        if (med.instructions) {
          if (med.instructions.toLowerCase().includes('twice daily') || med.instructions.toLowerCase().includes('two times a day')) {
            frequency.timesPerDay = 2;
          } else if (med.instructions.toLowerCase().includes('three times a day') || med.instructions.toLowerCase().includes('thrice daily')) {
            frequency.timesPerDay = 3;
          } else if (med.instructions.toLowerCase().includes('four times a day')) {
            frequency.timesPerDay = 4;
          } else if (med.instructions.toLowerCase().includes('as needed') || med.instructions.toLowerCase().includes('prn')) {
            frequency.asNeeded = true;
          }
        }
        
        // Create the medication
        const medication = new Medication({
          userId: req.user._id,
          name: med.name,
          genericName: med.name, // Assume generic name is the same for now
          dosage: med.dosage,
          dosageForm: dosageForm,
          strength: strength,
          frequency: frequency,
          instructions: med.instructions,
          startDate: new Date(),
          status: 'active',
          category: 'prescription',
          remainingQuantity: med.quantity,
          totalQuantity: med.quantity,
          refillReminder: true,
          refillReminderDays: 7,
          originalPrescription: prescription._id,
          isActive: true
        });
        
        await medication.save();
        
        createdMedications.push(medication);
      } catch (medError) {
        logger.error(`Error creating medication ${med.name}:`, medError);
        failedMedications.push({
          name: med.name,
          error: medError.message
        });
      }
    }
    
    // Update prescription with linked medications
    prescription.linkedMedications = createdMedications.map(med => med._id);
    prescription.verificationStatus = 'verified';
    await prescription.save();
    
    res.status(201).json({
      status: 'success',
      message: `Created ${createdMedications.length} medications from prescription`,
      createdMedications,
      failedCount: failedMedications.length,
      failedMedications: process.env.NODE_ENV === 'development' ? failedMedications : undefined
    });
  } catch (error) {
    logger.error('Error creating medications from prescription:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create medications from prescription',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Update prescription details
 * @route PUT /api/prescriptions/:id
 */
exports.updatePrescription = async (req, res) => {
  try {
    const { 
      prescribedBy, 
      prescribedDate, 
      expiryDate, 
      status,
      pharmacyName,
      pharmacyAddress,
      pharmacyPhone,
      notes,
      extractedMedications
    } = req.body;
    
    // Create update object
    const updateData = {};
    if (prescribedBy) updateData.prescribedBy = prescribedBy;
    if (prescribedDate) updateData.prescribedDate = prescribedDate;
    if (expiryDate) updateData.expiryDate = expiryDate;
    if (status) updateData.status = status;
    if (notes) updateData.notes = notes;
    
    // Update pharmacy information
    if (pharmacyName || pharmacyAddress || pharmacyPhone) {
      updateData.pharmacy = {};
      if (pharmacyName) updateData['pharmacy.name'] = pharmacyName;
      if (pharmacyAddress) updateData['pharmacy.address'] = pharmacyAddress;
      if (pharmacyPhone) updateData['pharmacy.phone'] = pharmacyPhone;
    }
    
    // Update extracted medications
    if (extractedMedications) {
      updateData.extractedMedications = extractedMedications;
      updateData.verificationStatus = 'partially_verified';
    }
    
    // Update prescription
    const prescription = await Prescription.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true }
    );
    
    if (!prescription) {
      return res.status(404).json({
        status: 'error',
        message: 'Prescription not found'
      });
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Prescription updated successfully',
      prescription
    });
  } catch (error) {
    logger.error('Error updating prescription:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update prescription',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Delete prescription
 * @route DELETE /api/prescriptions/:id
 */
exports.deletePrescription = async (req, res) => {
  try {
    const prescription = await Prescription.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!prescription) {
      return res.status(404).json({
        status: 'error',
        message: 'Prescription not found'
      });
    }
    
    // If hard delete is requested, delete the image file
    if (req.query.hard === 'true') {
      if (prescription.imagePath) {
        await deleteFile(prescription.imagePath);
      }
      
      await Prescription.findByIdAndDelete(req.params.id);
      
      return res.status(200).json({
        status: 'success',
        message: 'Prescription permanently deleted'
      });
    }
    
    // Soft delete (mark as cancelled)
    prescription.status = 'cancelled';
    await prescription.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Prescription marked as cancelled'
    });
  } catch (error) {
    logger.error('Error deleting prescription:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete prescription',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};