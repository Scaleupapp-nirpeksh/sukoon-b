// utils/s3Service.js
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();
const BUCKET_NAME = process.env.S3_BUCKET_NAME;

/**
 * Upload a file to S3
 * @param {Buffer} fileBuffer - File buffer to upload
 * @param {string} originalFilename - Original file name
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<string>} - URL of the uploaded file
 */
const uploadToS3 = async (fileBuffer, originalFilename, contentType) => {
  try {
    // Generate a unique key for the file
    const fileExtension = path.extname(originalFilename);
    const key = `prescriptions/${uuidv4()}${fileExtension}`;

    // Upload file to S3
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      ACL: 'private', // Make it private for security
    };

    const result = await s3.upload(uploadParams).promise();
    logger.info(`File uploaded successfully to ${result.Location}`);
    
    return {
      key: result.Key,
      url: result.Location
    };
  } catch (error) {
    logger.error('Error uploading file to S3:', error);
    throw new Error('Failed to upload file to storage');
  }
};

/**
 * Get a signed URL for temporary access to a private S3 object
 * @param {string} key - S3 object key
 * @param {number} expiresIn - URL expiration time in seconds (default: 60 minutes)
 * @returns {Promise<string>} - Signed URL
 */
const getSignedUrl = async (key, expiresIn = 3600) => {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
      Expires: expiresIn,
    };

    const url = await s3.getSignedUrlPromise('getObject', params);
    return url;
  } catch (error) {
    logger.error('Error generating signed URL:', error);
    throw new Error('Failed to generate access URL');
  }
};

/**
 * Delete a file from S3
 * @param {string} key - S3 object key
 * @returns {Promise<boolean>} - Success status
 */
const deleteFromS3 = async (key) => {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
    };

    await s3.deleteObject(params).promise();
    logger.info(`File ${key} deleted from S3`);
    return true;
  } catch (error) {
    logger.error('Error deleting file from S3:', error);
    throw new Error('Failed to delete file from storage');
  }
};

/**
 * Handle file upload based on environment
 * In production: Upload to S3
 * In development: Save to local file system
 */
const uploadFile = async (fileBuffer, originalFilename, contentType) => {
  if (process.env.NODE_ENV === 'production') {
    return await uploadToS3(fileBuffer, originalFilename, contentType);
  } else {
    // For development, save to local filesystem
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const fileExtension = path.extname(originalFilename);
    const fileName = `${uuidv4()}${fileExtension}`;
    const filePath = path.join(uploadsDir, fileName);
    
    // Ensure uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    await fs.promises.writeFile(filePath, fileBuffer);
    logger.info(`File saved locally to ${filePath}`);
    
    return {
      key: fileName,
      url: `/uploads/${fileName}`
    };
  }
};

/**
 * Get access to file
 */
const getFileAccess = async (key) => {
  if (process.env.NODE_ENV === 'production') {
    return await getSignedUrl(key);
  } else {
    // For development, return local path
    return `/uploads/${key}`;
  }
};

/**
 * Delete file
 */
const deleteFile = async (key) => {
  if (process.env.NODE_ENV === 'production') {
    return await deleteFromS3(key);
  } else {
    // For development, delete from local filesystem
    const filePath = path.join(__dirname, '..', 'uploads', key);
    await fs.promises.unlink(filePath);
    logger.info(`File deleted locally: ${filePath}`);
    return true;
  }
};

module.exports = {
  uploadFile,
  getFileAccess,
  deleteFile
};