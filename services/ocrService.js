const vision = require('@google-cloud/vision');
const logger = require('../utils/logger');

// Polyfill Headers if not defined
if (typeof Headers === 'undefined') {
  global.Headers = require('node-fetch').Headers;
}

// Parse the credentials from the environment variable
let credentials;
try {
  credentials = JSON.parse(process.env.GOOGLE_VISION_CREDENTIALS);
} catch (error) {
  logger.error('Error parsing Google Vision credentials:', error);
  throw new Error('Invalid Google Vision credentials format');
}

// Replace escaped newline characters with actual newline characters
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');

// Initialize the Google Vision client with inline credentials
const client = new vision.ImageAnnotatorClient({
  credentials, // This now contains your correctly formatted key
});

/**
 * Extract text from image using Google Vision API
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromImage(imageBuffer) {
  try {
    logger.info('Starting OCR extraction with Google Vision API');
    const [result] = await client.textDetection(imageBuffer);
    logger.info('Vision API raw result:', result);
    const detections = result.textAnnotations;
    
    if (!detections || detections.length === 0) {
      logger.warn('No text detected in the image');
      return '';
    }
    
    const extractedText = detections[0].description;
    logger.info('OCR Extraction complete');
    return extractedText;
  } catch (error) {
    logger.error('Error extracting text with Vision API:', error);
    throw error;
  }
}

/**
 * Extract text from an S3 file URL or file path
 * @param {string} fileUrl - File URL or path
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromUrl(fileUrl) {
  try {
    logger.info(`Fetching image from: ${fileUrl}`);
    const response = await fetch(fileUrl);
    const imageBuffer = await response.arrayBuffer();
    return await extractTextFromImage(Buffer.from(imageBuffer));
  } catch (error) {
    logger.error('Error extracting text from URL:', error);
    throw error;
  }
}

module.exports = {
  extractTextFromImage,
  extractTextFromUrl,
};
