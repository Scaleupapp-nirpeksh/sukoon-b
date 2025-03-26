// utils/prescriptionParser.js
const { OpenAI } = require('openai');
const logger = require('./logger');

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Parse prescription text using AI to extract structured medication information.
 * This function sends a prompt to the OpenAI API (GPT‑3.5‑turbo) with the OCR text.
 * @param {string} ocrText - Raw OCR text from a prescription.
 * @returns {Promise<Array>} - An array of extracted medications.
 */
async function parsePrescriptionWithAI(ocrText) {
  try {
    logger.info('Parsing prescription text with AI');

    const prompt = `
Analyze the following prescription text and extract medication information in a structured format.
If you cannot confidently extract a value, use null.

Prescription text:
"""${ocrText}"""

Return only a JSON array in the following format, with no additional text:
[
  {
    "name": "Medication name",
    "dosage": "Dosage (e.g., 10mg, 5ml)",
    "instructions": "Usage instructions (e.g., Take twice daily with food)",
    "quantity": 30,
    "refills": 2
  }
]
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a precise medical assistant that extracts medication details from prescriptions."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content;
    // Attempt to parse the responseText as JSON
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      logger.error("Failed to parse AI response:", parseError);
      return [];
    }
    // If the parsed response is directly an array, use it; otherwise look for a medications key.
    const medications = Array.isArray(parsed) ? parsed : (parsed.medications || []);
    logger.info(`Extracted ${medications.length} medications from prescription`);
    return medications;
  } catch (error) {
    logger.error("Error parsing prescription with AI:", error);
    // On error, return an empty array so that the fallback is used
    return [];
  }
}

/**
 * Basic rule-based parsing of prescription text.
 * This is a fallback method in case the AI parser fails or returns no results.
 * @param {string} ocrText - Raw OCR text from a prescription.
 * @returns {Array} - Array of extracted medications.
 */
function basicPrescriptionParsing(ocrText) {
  const medications = [];
  // Split the OCR text into non-empty lines
  const lines = ocrText.split('\n').filter(line => line.trim().length > 0);
  let currentMedication = null;

  // Improved regex: looks for lines that include keywords like "Tablet", "Capsule", etc.
  const medStartRegex = /^(.*\b(Tablet|Capsule|Syrup|Injection)\b.*)$/i;

  for (const line of lines) {
    if (medStartRegex.test(line)) {
      // If we have a medication in progress, save it
      if (currentMedication) {
        medications.push(currentMedication);
      }
      // Start a new medication object using the whole line as the medication name
      currentMedication = {
        name: line.trim(),
        dosage: '',
        instructions: '',
        quantity: null,
        refills: null
      };
    } else if (currentMedication) {
      // Append additional lines to the instructions field
      currentMedication.instructions += ' ' + line.trim();
      // Try to extract quantity (e.g., "qty: 30")
      const quantityMatch = line.match(/qty:?\s*(\d+)/i);
      if (quantityMatch) {
        currentMedication.quantity = parseInt(quantityMatch[1], 10);
      }
      // Try to extract refills (e.g., "refills: 2")
      const refillMatch = line.match(/refills:?\s*(\d+)/i);
      if (refillMatch) {
        currentMedication.refills = parseInt(refillMatch[1], 10);
      }
    }
  }
  // Add the last medication if exists
  if (currentMedication) {
    medications.push(currentMedication);
  }
  return medications;
}

/**
 * Parse prescription text to extract medication information.
 * It first attempts AI‑based parsing; if that fails, it falls back to rule-based parsing.
 * @param {string} ocrText - Raw OCR text from a prescription.
 * @returns {Promise<Array>} - Array of extracted medications.
 */
async function parsePrescription(ocrText) {
  try {
    // Attempt AI-based parsing first
    const aiMedications = await parsePrescriptionWithAI(ocrText);
    if (aiMedications && aiMedications.length > 0) {
      return aiMedications;
    }
    logger.info("AI parsing returned no results, falling back to rule-based parsing");
    return basicPrescriptionParsing(ocrText);
  } catch (error) {
    logger.error("Error in prescription parsing:", error);
    // If any error occurs, fallback to basic parsing
    return basicPrescriptionParsing(ocrText);
  }
}

module.exports = {
  parsePrescription,
  parsePrescriptionWithAI,
  basicPrescriptionParsing
};
