import Material from '../models/Material.js';
import { PROCESSING_STATUS } from '../config/constants.js';

/**
 * Processing Job Service
 * Handles background processing of materials (documents, URLs, text)
 * Uses ragService for embedding and vector storage.
 */
class ProcessingJobService {
  constructor() {
    this.isProcessing = false;
    this.jobQueue = [];
    this.processedJobs = new Map();
    this.maxConcurrentJobs = 3;
    this.currentJobs = 0;

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
   */
  async enqueueProcessingJob(materialId, processingType = 'document') {
    try {
      const material = await Material.findById(materialId);
      if (!material) {
        throw new Error(`Material not found: ${materialId}`);
      }

      if (material.processingStatus === PROCESSING_STATUS.PROCESSING) {
        return false;
      }

      if (material.processingStatus === PROCESSING_STATUS.COMPLETED) {
        return false;
      }

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
      await material.updateProcessingStatus(PROCESSING_STATUS.PENDING);

      if (!this.isProcessing) {
        this.startProcessing();
      }

      return true;

    } catch (error) {
      console.error(`Failed to enqueue processing job for material ${materialId}:`, error);
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

    while (this.jobQueue.length > 0 && this.currentJobs < this.maxConcurrentJobs) {
      const job = this.jobQueue.shift();
      if (job) {
        this.processJob(job);
      }
    }

    if (this.jobQueue.length > 0) {
      setTimeout(() => {
        if (this.currentJobs < this.maxConcurrentJobs) {
          this.startProcessing();
        }
      }, 1000);
    } else {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single job using ragService
   */
  async processJob(job) {
    this.currentJobs++;
    const startTime = Date.now();

    try {
      job.status = 'processing';
      job.startedAt = new Date();

      const material = await Material.findById(job.materialId);
      if (!material) {
        throw new Error(`Material not found: ${job.materialId}`);
      }

      await material.updateProcessingStatus(PROCESSING_STATUS.PROCESSING);

      // Use ragService for all material types (handles text, url, pdf, docx)
      const ragService = (await import('./ragService.js')).default;
      const result = await ragService.processAndEmbedMaterial(material);

      if (!result.success) {
        throw new Error(result.error || 'Processing failed');
      }

      material.processingStatus = PROCESSING_STATUS.COMPLETED;
      material.processingError = undefined;
      await material.save();

      job.status = 'completed';
      job.completedAt = new Date();
      job.processingTime = Date.now() - startTime;
      job.result = result;

      this.processedJobs.set(job.id, job);
      this.stats.totalProcessed++;
      this.stats.successfulJobs++;
      this.updateAverageProcessingTime(job.processingTime);

    } catch (error) {
      console.error(`Job ${job.id} failed:`, error);

      job.status = 'failed';
      job.completedAt = new Date();
      job.processingTime = Date.now() - startTime;
      job.error = error.message;
      job.retryCount++;

      try {
        const material = await Material.findById(job.materialId);
        if (material) {
          await material.updateProcessingStatus(PROCESSING_STATUS.FAILED, {
            message: error.message,
            timestamp: new Date()
          });
        }
      } catch (updateError) {
        console.error('Failed to update material status:', updateError);
      }

      if (job.retryCount < job.maxRetries) {
        job.status = 'queued';
        job.retryAt = new Date(Date.now() + (job.retryCount * 5000));
        this.jobQueue.push(job);
      } else {
        this.processedJobs.set(job.id, job);
        this.stats.totalProcessed++;
        this.stats.failedJobs++;
      }

    } finally {
      this.currentJobs--;

      if (this.jobQueue.length > 0 && !this.isProcessing) {
        setTimeout(() => this.startProcessing(), 100);
      }
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId) {
    if (this.processedJobs.has(jobId)) {
      return this.processedJobs.get(jobId);
    }

    const queuedJob = this.jobQueue.find(job => job.id === jobId);
    return queuedJob || null;
  }

  /**
   * Get processing statistics
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
   */
  updateAverageProcessingTime(processingTime) {
    if (this.stats.successfulJobs === 1) {
      this.stats.averageProcessingTime = processingTime;
    } else {
      this.stats.averageProcessingTime = Math.round(
        (this.stats.averageProcessingTime * (this.stats.successfulJobs - 1) + processingTime) / this.stats.successfulJobs
      );
    }
  }

  /**
   * Clear old completed jobs from memory
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
  }

  /**
   * Stop processing and clear queue
   */
  async stopProcessing() {
    this.isProcessing = false;
    this.jobQueue = [];

    while (this.currentJobs > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

export default new ProcessingJobService();
