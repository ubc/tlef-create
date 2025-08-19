import fs from 'fs/promises';
import path from 'path';
import { FILE_CONFIG } from '../config/constants.js';

class StorageMonitor {
  /**
   * Check disk usage for upload directory
   */
  static async checkDiskUsage() {
    try {
      const uploadPath = FILE_CONFIG.UPLOAD_PATH;
      const stats = await this.getDirectorySize(uploadPath);
      
      const usage = {
        totalFiles: stats.fileCount,
        totalSizeBytes: stats.totalSize,
        totalSizeMB: Math.round(stats.totalSize / (1024 * 1024)),
        totalSizeGB: Math.round(stats.totalSize / (1024 * 1024 * 1024) * 100) / 100,
        averageFileSize: stats.fileCount > 0 ? Math.round(stats.totalSize / stats.fileCount / 1024) : 0 // KB
      };
      
      console.log('📊 Storage Usage Report:');
      console.log(`   Files: ${usage.totalFiles}`);
      console.log(`   Total: ${usage.totalSizeMB}MB (${usage.totalSizeGB}GB)`);
      console.log(`   Average: ${usage.averageFileSize}KB per file`);
      
      // Warning thresholds
      if (usage.totalSizeGB > 10) {
        console.warn('⚠️  WARNING: Upload directory is over 10GB!');
      }
      
      if (usage.totalFiles > 10000) {
        console.warn('⚠️  WARNING: Over 10,000 files in upload directory!');
      }
      
      return usage;
    } catch (error) {
      console.error('Error checking disk usage:', error);
      return null;
    }
  }
  
  /**
   * Get directory size recursively
   */
  static async getDirectorySize(dirPath) {
    let totalSize = 0;
    let fileCount = 0;
    
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        
        if (item.isDirectory()) {
          const subStats = await this.getDirectorySize(fullPath);
          totalSize += subStats.totalSize;
          fileCount += subStats.fileCount;
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
          fileCount++;
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }
    
    return { totalSize, fileCount };
  }
  
  /**
   * Clean up old files (older than specified days)
   */
  static async cleanupOldFiles(daysOld = 30) {
    try {
      const uploadPath = FILE_CONFIG.UPLOAD_PATH;
      const cutoffDate = new Date(Date.now() - (daysOld * 24 * 60 * 60 * 1000));
      let deletedCount = 0;
      let deletedSize = 0;
      
      const files = await fs.readdir(uploadPath);
      
      for (const filename of files) {
        const filePath = path.join(uploadPath, filename);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          deletedSize += stats.size;
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} old files (${Math.round(deletedSize / (1024 * 1024))}MB freed)`);
      }
      
      return { deletedCount, deletedSize };
    } catch (error) {
      console.error('Error during cleanup:', error);
      return { deletedCount: 0, deletedSize: 0 };
    }
  }
  
  /**
   * Initialize storage monitoring
   */
  static startMonitoring() {
    // Check storage every hour
    setInterval(() => {
      this.checkDiskUsage();
    }, 60 * 60 * 1000);
    
    // Clean up old files daily (files older than 30 days)
    setInterval(() => {
      this.cleanupOldFiles(30);
    }, 24 * 60 * 60 * 1000);
    
    // Initial check
    this.checkDiskUsage();
    
    console.log('📊 Storage monitoring started');
  }
}

export default StorageMonitor;