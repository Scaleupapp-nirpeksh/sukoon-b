// services/ocrService.js
const vision = require('@google-cloud/vision');
const logger = require('../utils/logger');

// Parse the credentials from the environment variable
const credentials = JSON.parse(process.env.GOOGLE_VISION_CREDENTIALS);

// Initialize the Google Vision client with inline credentials
const client = new vision.ImageAnnotatorClient({
  credentials, // This contains your service account key details
});

async function extractTextFromImage(imageBuffer) {
  try {
    const [result] = await client.textDetection(imageBuffer);
    const detections = result.textAnnotations;
    const extractedText = detections && detections[0] ? detections[0].description : '';
    logger.info('OCR Extraction complete');
    return extractedText;
  } catch (error) {
    logger.error('Error extracting text with Vision API:', error);
    throw error;
  }
}

module.exports = {
  extractTextFromImage,
};
