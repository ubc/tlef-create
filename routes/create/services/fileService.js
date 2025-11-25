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

  /**
   * Validate URL content type - check if URL leads to allowed content
   * Allows: PDFs, static websites with text content
   * Blocks: Websites mainly with pictures, animations, videos, dynamic content
   * @param {string} url - URL to validate
   * @returns {Promise<Object>} - Validation result with content type info
   */
  static async validateUrlContentType(url) {
    try {
      // Block known problematic domains that require authentication or dynamic rendering
      const blockedDomains = [
        'drive.google.com',
        'docs.google.com',
        'dropbox.com',
        'onedrive.live.com',
        'sharepoint.com'
      ];

      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      for (const blockedDomain of blockedDomains) {
        if (hostname === blockedDomain || hostname.endsWith('.' + blockedDomain)) {
          return {
            isValid: false,
            error: `URLs from ${blockedDomain} are not supported. These services require authentication and use dynamic content. Please download the file and upload it directly, or use a direct link to a PDF.`,
            contentType: 'blocked_domain',
            reason: 'blocked_domain'
          };
        }
      }

      const fetch = (await import('node-fetch')).default;

      // Perform HEAD request to check content type without downloading full content
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TLEF-Create-Bot/1.0)',
        },
        timeout: 10000,
        redirect: 'follow'
      });

      const contentType = response.headers.get('content-type') || '';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

      console.log('🔍 URL Content Type Check:', {
        url,
        contentType,
        contentLength,
        status: response.status
      });

      // Check for blocked content types
      const blockedTypes = [
        'image/', // Block direct image files
        'video/', // Block direct video files
        'audio/', // Block direct audio files
        'application/octet-stream', // Block generic binary files
        'application/zip',
        'application/x-rar',
        'application/x-7z-compressed'
      ];

      for (const blockedType of blockedTypes) {
        if (contentType.toLowerCase().includes(blockedType)) {
          return {
            isValid: false,
            error: `This URL contains ${blockedType.replace('/', '')} content which is not supported. Please provide URLs to PDFs or text-based web pages.`,
            contentType,
            reason: 'blocked_content_type'
          };
        }
      }

      // Allow PDFs explicitly
      if (contentType.includes('application/pdf')) {
        return {
          isValid: true,
          contentType: 'pdf',
          message: 'PDF content detected - allowed'
        };
      }

      // Allow HTML/text content
      if (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/xhtml')) {
        // Additional check: warn if content seems suspicious
        if (contentLength === 0) {
          console.warn('⚠️ HTML page has zero content-length - might be dynamic content');
        }

        return {
          isValid: true,
          contentType: 'html',
          message: 'HTML/text content detected - allowed'
        };
      }

      // If content type is unknown or empty, allow but warn
      if (!contentType || contentType.trim() === '') {
        console.warn('⚠️ No content-type header found, allowing with warning');
        return {
          isValid: true,
          contentType: 'unknown',
          warning: 'Content type could not be determined. Processing may fail if content is not text-based.'
        };
      }

      // Default: block unknown content types for safety
      return {
        isValid: false,
        error: `Content type "${contentType}" is not supported. Please provide URLs to PDFs or text-based web pages.`,
        contentType,
        reason: 'unsupported_content_type'
      };

    } catch (error) {
      console.error('❌ Error validating URL content type:', error.message);

      // Check if it's a network error
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return {
          isValid: false,
          error: 'Unable to access the URL. Please check that the URL is correct and accessible.',
          reason: 'network_error'
        };
      }

      if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
        return {
          isValid: false,
          error: 'URL request timed out. The server may be too slow or unavailable.',
          reason: 'timeout'
        };
      }

      // For other errors, allow but log warning
      console.warn('⚠️ Could not validate content type, allowing with warning:', error.message);
      return {
        isValid: true,
        contentType: 'unknown',
        warning: `Could not verify content type: ${error.message}. Processing may fail if content is not text-based.`
      };
    }
  }
}

export default FileService;