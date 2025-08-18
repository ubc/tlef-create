import Material from '../models/Material.js';
import documentProcessingService from './documentProcessingService.js';
import { PROCESSING_STATUS } from '../config/constants.js';

/**
 * Processing Job Service
 * Handles background processing of materials (documents, URLs, text)
 */
class ProcessingJobService {
  constructor() {
    this.isProcessing = false;
    this.jobQueue = [];
    this.processedJobs = new Map();
    this.maxConcurrentJobs = 3;
    this.currentJobs = 0;
    
    // Statistics
    this.stats = {
      totalProcessed: 0,
      successfulJobs: 0,
      failedJobs: 0,
      averageProcessingTime: 0,
      lastReset: new Date()
    };
  }

  /**
   * Add material to processing queue
   * @param {string} materialId - Material ID to process
   * @param {string} processingType - Type of processing (document, url, text)
   * @returns {Promise<boolean>} - Success status
   */
  async enqueueProcessingJob(materialId, processingType = 'document') {
    try {
      console.log(`📋 ProcessingJobService: Enqueuing ${processingType} job for material: ${materialId}`);
      
      // Check if material exists
      const material = await Material.findById(materialId);
      if (!material) {
        throw new Error(`Material not found: ${materialId}`);
      }

      // Check if already being processed or completed
      if (material.processingStatus === PROCESSING_STATUS.PROCESSING) {
        console.log(`⚠️ Material ${materialId} is already being processed`);
        return false;
      }

      if (material.processingStatus === PROCESSING_STATUS.COMPLETED) {
        console.log(`✅ Material ${materialId} is already processed`);
        return false;
      }

      // Add to queue
      const job = {
        id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        materialId,
        processingType,
        status: 'queued',
        enqueuedAt: new Date(),
        retryCount: 0,
        maxRetries: 3
      };

      this.jobQueue.push(job);
      
      // Update material status
      await material.updateProcessingStatus(PROCESSING_STATUS.PENDING);
      
      console.log(`✅ Job ${job.id} enqueued for material ${materialId}`);
      
      // Start processing if not already running
      if (!this.isProcessing) {
        this.startProcessing();
      }
      
      return true;
      
    } catch (error) {
      console.error(`❌ Failed to enqueue processing job for material ${materialId}:`, error);
      throw error;
    }
  }

  /**
   * Start processing jobs from queue
   */
  async startProcessing() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    console.log('🚀 ProcessingJobService: Starting job processing...');

    while (this.jobQueue.length > 0 && this.currentJobs < this.maxConcurrentJobs) {
      const job = this.jobQueue.shift();
      if (job) {
        this.processJob(job); // Don't await - process concurrently
      }
    }

    // If no more jobs or max concurrent reached, check again later
    if (this.jobQueue.length > 0) {
      setTimeout(() => {
        if (this.currentJobs < this.maxConcurrentJobs) {
          this.startProcessing();
        }
      }, 1000);
    } else {
      this.isProcessing = false;
      console.log('⏸️ ProcessingJobService: No more jobs to process');
    }
  }

  /**
   * Process a single job
   * @param {Object} job - Job to process
   */
  async processJob(job) {
    this.currentJobs++;
    const startTime = Date.now();
    
    try {
      console.log(`🔄 Processing job ${job.id} for material ${job.materialId}`);
      
      job.status = 'processing';
      job.startedAt = new Date();
      
      // Get material from database
      const material = await Material.findById(job.materialId);
      if (!material) {
        throw new Error(`Material not found: ${job.materialId}`);
      }

      // Update material status to processing
      await material.updateProcessingStatus(PROCESSING_STATUS.PROCESSING);

      let processingResult;
      
      // Process based on type
      switch (job.processingType) {
        case 'document':
          if (!material.filePath) {
            throw new Error('No file path found for document processing');
          }
          processingResult = await documentProcessingService.processDocument(material);
          break;
          
        case 'url':
          if (!material.url) {
            throw new Error('No URL found for URL processing');
          }
          processingResult = await documentProcessingService.processUrl(material.url, material);
          break;
          
        case 'text':
          if (!material.content) {
            throw new Error('No content found for text processing');
          }
          processingResult = await documentProcessingService.processTextContent(material.content, material);
          break;
          
        default:
          throw new Error(`Unknown processing type: ${job.processingType}`);
      }

      // Update material with processing results
      material.qdrantDocumentId = processingResult.qdrantDocumentId;
      material.processingStatus = PROCESSING_STATUS.COMPLETED;
      material.processingError = undefined;
      
      // Store extracted text for text materials that don't have content
      if (job.processingType === 'document' && processingResult.extractedText) {
        material.content = processingResult.extractedText;
      }
      
      await material.save();
      
      // Mark job as completed
      job.status = 'completed';
      job.completedAt = new Date();
      job.processingTime = Date.now() - startTime;
      job.result = processingResult;
      
      this.processedJobs.set(job.id, job);
      
      // Update statistics
      this.stats.totalProcessed++;
      this.stats.successfulJobs++;
      this.updateAverageProcessingTime(job.processingTime);
      
      console.log(`✅ Job ${job.id} completed successfully in ${job.processingTime}ms`);
      
    } catch (error) {
      console.error(`❌ Job ${job.id} failed:`, error);
      
      job.status = 'failed';
      job.completedAt = new Date();
      job.processingTime = Date.now() - startTime;
      job.error = error.message;
      job.retryCount++;
      
      // Update material with error
      try {
        const material = await Material.findById(job.materialId);
        if (material) {
          await material.updateProcessingStatus(PROCESSING_STATUS.FAILED, {
            message: error.message,
            timestamp: new Date()
          });
        }
      } catch (updateError) {
        console.error(`❌ Failed to update material status:`, updateError);
      }
      
      // Retry if possible
      if (job.retryCount < job.maxRetries) {
        console.log(`🔄 Retrying job ${job.id} (attempt ${job.retryCount + 1}/${job.maxRetries})`);
        job.status = 'queued';
        job.retryAt = new Date(Date.now() + (job.retryCount * 5000)); // Exponential backoff
        this.jobQueue.push(job);
      } else {
        this.processedJobs.set(job.id, job);
        this.stats.totalProcessed++;
        this.stats.failedJobs++;
      }
      
    } finally {
      this.currentJobs--;
      
      // Continue processing if there are more jobs
      if (this.jobQueue.length > 0 && !this.isProcessing) {
        setTimeout(() => this.startProcessing(), 100);
      }
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Object|null} - Job status or null if not found
   */
  getJobStatus(jobId) {
    // Check processed jobs
    if (this.processedJobs.has(jobId)) {
      return this.processedJobs.get(jobId);
    }
    
    // Check queued jobs
    const queuedJob = this.jobQueue.find(job => job.id === jobId);
    if (queuedJob) {
      return queuedJob;
    }
    
    return null;
  }

  /**
   * Get processing statistics
   * @returns {Object} - Processing statistics
   */
  getProcessingStats() {
    return {
      ...this.stats,
      queuedJobs: this.jobQueue.length,
      currentJobs: this.currentJobs,
      isProcessing: this.isProcessing,
      totalJobsInMemory: this.processedJobs.size
    };
  }

  /**
   * Update average processing time
   * @param {number} processingTime - Processing time in milliseconds
   */
  updateAverageProcessingTime(processingTime) {
    if (this.stats.successfulJobs === 1) {
      this.stats.averageProcessingTime = processingTime;
    } else {
      // Moving average
      this.stats.averageProcessingTime = Math.round(
        (this.stats.averageProcessingTime * (this.stats.successfulJobs - 1) + processingTime) / this.stats.successfulJobs
      );
    }
  }

  /**
   * Clear old completed jobs from memory
   * @param {number} maxAge - Maximum age in milliseconds (default: 1 hour)
   */
  cleanupOldJobs(maxAge = 60 * 60 * 1000) {
    const cutoffTime = Date.now() - maxAge;
    let cleanedCount = 0;
    
    for (const [jobId, job] of this.processedJobs.entries()) {
      if (job.completedAt && new Date(job.completedAt).getTime() < cutoffTime) {
        this.processedJobs.delete(jobId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} old jobs from memory`);
    }
    
    return cleanedCount;
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      successfulJobs: 0,
      failedJobs: 0,
      averageProcessingTime: 0,
      lastReset: new Date()
    };
    console.log('📊 Processing statistics reset');
  }

  /**
   * Stop processing and clear queue
   */
  async stopProcessing() {
    console.log('🛑 ProcessingJobService: Stopping job processing...');
    this.isProcessing = false;
    this.jobQueue = [];
    
    // Wait for current jobs to complete
    while (this.currentJobs > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('✅ ProcessingJobService: All processing stopped');
  }
}

// Export singleton instance
export default new ProcessingJobService();