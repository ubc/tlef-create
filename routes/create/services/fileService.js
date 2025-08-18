import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { FILE_CONFIG, MATERIAL_TYPES } from '../config/constants.js';

class FileService {
  /**
   * Configure multer for file uploads
   */
  static configureUpload() {
    // Ensure upload directory exists
    this.ensureUploadDir();

    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, FILE_CONFIG.UPLOAD_PATH);
      },
      filename: (req, file, cb) => {
        // Generate unique filename with timestamp and random string
        const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
      }
    });

    const fileFilter = (req, file, cb) => {
      // Check if file type is allowed
      if (FILE_CONFIG.ALLOWED_MIME_TYPES[file.mimetype]) {
        cb(null, true);
      } else {
        cb(new Error('File type not supported'), false);
      }
    };

    return multer({
      storage,
      fileFilter,
      limits: {
        fileSize: FILE_CONFIG.MAX_FILE_SIZE,
        files: 10 // Maximum 10 files per request
      }
    });
  }

  /**
   * Ensure upload directory exists
   */
  static async ensureUploadDir() {
    try {
      await fs.mkdir(FILE_CONFIG.UPLOAD_PATH, { recursive: true });
    } catch (error) {
      console.error('Error creating upload directory:', error);
    }
  }

  /**
   * Generate file checksum for deduplication
   * @param {string} filePath - Path to file
   * @returns {Promise<string>} - MD5 checksum
   */
  static async generateChecksum(filePath) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      return crypto.createHash('md5').update(fileBuffer).digest('hex');
    } catch (error) {
      console.error('Error generating checksum:', error);
      return null;
    }
  }

  /**
   * Get file type from mimetype
   * @param {string} mimetype - File mimetype
   * @returns {string} - Material type
   */
  static getFileType(mimetype) {
    return FILE_CONFIG.ALLOWED_MIME_TYPES[mimetype] || 'unknown';
  }

  /**
   * Validate file before processing
   * @param {Object} file - Multer file object
   * @returns {Object} - Validation result
   */
  static validateFile(file) {
    const errors = [];

    // Check file size
    if (file.size > FILE_CONFIG.MAX_FILE_SIZE) {
      errors.push(`File size exceeds maximum limit of ${FILE_CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    // Check file type
    if (!FILE_CONFIG.ALLOWED_MIME_TYPES[file.mimetype]) {
      errors.push(`File type ${file.mimetype} is not supported`);
    }

    // Check filename
    if (!file.originalname || file.originalname.length > 255) {
      errors.push('Invalid filename');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Process uploaded file and create material data
   * @param {Object} file - Multer file object
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} - Processed file data
   */
  static async processUploadedFile(file, metadata = {}) {
    try {
      const validation = this.validateFile(file);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const checksum = await this.generateChecksum(file.path);
      const fileType = this.getFileType(file.mimetype);

      // Generate a proper name from filename if not provided
      const parsedName = path.parse(file.originalname).name;
      const defaultName = metadata.name || parsedName || file.originalname;
      
      console.log('🏷️ Name generation:', {
        metadataName: metadata.name,
        originalFilename: file.originalname,
        parsedName: parsedName,
        finalName: defaultName
      });
      
      // Ensure name is never undefined by filtering out undefined name from metadata
      const { name: metadataName, ...otherMetadata } = metadata;
      
      return {
        name: metadataName || defaultName,
        type: fileType,
        originalFileName: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        checksum,
        ...otherMetadata
      };
    } catch (error) {
      // Clean up file if processing failed
      await this.deleteFile(file.path);
      throw error;
    }
  }

  /**
   * Delete file from filesystem
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>} - Success status
   */
  static async deleteFile(filePath) {
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  }

  /**
   * Get file stats
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} - File stats
   */
  static async getFileStats(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        exists: true
      };
    } catch (error) {
      return {
        exists: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up old uploaded files (for maintenance)
   * @param {number} maxAgeHours - Maximum age in hours
   * @returns {Promise<number>} - Number of files deleted
   */
  static async cleanupOldFiles(maxAgeHours = 24) {
    try {
      const files = await fs.readdir(FILE_CONFIG.UPLOAD_PATH);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      let deletedCount = 0;

      for (const filename of files) {
        const filePath = path.join(FILE_CONFIG.UPLOAD_PATH, filename);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up old files:', error);
      return 0;
    }
  }

  /**
   * Format file size for display
   * @param {number} bytes - File size in bytes
   * @returns {string} - Formatted size
   */
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Validate URL for URL materials
   * @param {string} url - URL to validate
   * @returns {Object} - Validation result
   */
  static validateUrl(url) {
    try {
      const urlObj = new URL(url);
      const allowedProtocols = ['http:', 'https:'];
      
      if (!allowedProtocols.includes(urlObj.protocol)) {
        return {
          isValid: false,
          error: 'Only HTTP and HTTPS URLs are allowed'
        };
      }

      return {
        isValid: true,
        normalizedUrl: urlObj.toString()
      };
    } catch (error) {
      return {
        isValid: false,
        error: 'Invalid URL format'
      };
    }
  }
}

export default FileService;