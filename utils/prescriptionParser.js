// utils/prescriptionParser.js
const { OpenAI } = require('openai');
const logger = require('./logger');

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Parse prescription text using AI to extract structured medication information
 * @param {string} ocrText - Raw OCR text from a prescription
 * @returns {Promise<Array>} - Array of extracted medications
 */
async function parsePrescriptionWithAI(ocrText) {
  try {
    logger.info('Parsing prescription text with AI');
    
    const prompt = `
      Analyze the following prescription text and extract medication information in a structured format. 
      If you cannot confidently extract a value, use null.
      
      Prescription text:
      ${ocrText}
      
      Return only a JSON array in the following format, with no additional text:
      [
        {
          "name": "Medication name",
          "dosage": "Dosage (e.g., 10mg, 5ml)",
          "instructions": "Instructions (e.g., Take twice daily with food)",
          "quantity": 30,
          "refills": 2
        }
      ]
    `;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a precise medical assistant that extracts medication details from prescriptions." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });
    
    const responseText = completion.choices[0].message.content;
    const medications = JSON.parse(responseText).medications || [];
    
    logger.info(`Extracted ${medications.length} medications from prescription`);
    return medications;
  } catch (error) {
    logger.error('Error parsing prescription with AI:', error);
    
    // Return empty array on failure
    return [];
  }
}

/**
 * Basic rule-based parsing of prescription text
 * This is a fallback in case AI parsing fails
 * @param {string} ocrText - Raw OCR text from a prescription
 * @returns {Array} - Array of extracted medications
 */
function basicPrescriptionParsing(ocrText) {
  // A simple rule-based approach to extract medication information
  const medications = [];
  const lines = ocrText.split('\n').filter(line => line.trim().length > 0);
  
  let currentMedication = null;
  
  for (const line of lines) {
    // Check if this line likely starts a new medication
    if (line.match(/^[A-Za-z]+[\w\s-]+\d+\s*(mg|mcg|g|ml)/i)) {
      // If we were tracking a medication, push it to the array
      if (currentMedication) {
        medications.push(currentMedication);
      }
      
      // Extract name and dosage
      const match = line.match(/^([A-Za-z]+[\w\s-]+)(\d+\s*(mg|mcg|g|ml))/i);
      
      if (match) {
        currentMedication = {
          name: match[1].trim(),
          dosage: match[2].trim(),
          instructions: '',
          quantity: null,
          refills: null
        };
      } else {
        currentMedication = {
          name: line.trim(),
          dosage: '',
          instructions: '',
          quantity: null,
          refills: null
        };
      }
    } else if (currentMedication) {
      // Add this line to the instructions of the current medication
      if (currentMedication.instructions) {
        currentMedication.instructions += ' ' + line.trim();
      } else {
        currentMedication.instructions = line.trim();
      }
      
      // Try to extract quantity
      const quantityMatch = line.match(/qty:?\s*(\d+)/i);
      if (quantityMatch) {
        currentMedication.quantity = parseInt(quantityMatch[1]);
      }
      
      // Try to extract refills
      const refillMatch = line.match(/refills:?\s*(\d+)/i);
      if (refillMatch) {
        currentMedication.refills = parseInt(refillMatch[1]);
      }
    }
  }
  
  // Don't forget to add the last medication
  if (currentMedication) {
    medications.push(currentMedication);
  }
  
  return medications;
}

/**
 * Parse prescription text to extract medication information
 * @param {string} ocrText - Raw OCR text from a prescription
 * @returns {Promise<Array>} - Array of extracted medications
 */
async function parsePrescription(ocrText) {
  try {
    // First try with AI-based parsing
    const aiMedications = await parsePrescriptionWithAI(ocrText);
    
    if (aiMedications && aiMedications.length > 0) {
      return aiMedications;
    }
    
    // Fall back to rule-based parsing if AI fails
    logger.info('AI parsing returned no results, falling back to rule-based parsing');
    return basicPrescriptionParsing(ocrText);
  } catch (error) {
    logger.error('Error in prescription parsing:', error);
    // Fall back to rule-based parsing if AI fails
    return basicPrescriptionParsing(ocrText);
  }
}

module.exports = {
  parsePrescription,
  parsePrescriptionWithAI,
  basicPrescriptionParsing
};