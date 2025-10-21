/**
 * Job Queue Service using Agenda.js
 * Handles background question generation tasks
 */

import { Agenda } from 'agenda';
import mongoose from 'mongoose';

class JobQueueService {
  constructor() {
    this.agenda = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the job queue with MongoDB connection
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('📋 Job queue already initialized');
      return;
    }

    try {
      console.log('🚀 Initializing Agenda.js job queue...');
      
      // Check MongoDB connection state
      console.log(`📡 MongoDB connection state: ${mongoose.connection.readyState}`);
      if (mongoose.connection.readyState !== 1) {
        console.log('⏳ MongoDB not ready, waiting...');
        // Simple wait without complex promise logic
        let attempts = 0;
        while (mongoose.connection.readyState !== 1 && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
          console.log(`📡 Connection check ${attempts}: state ${mongoose.connection.readyState}`);
        }
        
        if (mongoose.connection.readyState !== 1) {
          throw new Error('MongoDB connection not ready after waiting');
        }
      }
      
      // Use existing MongoDB connection
      console.log('📋 Creating Agenda instance...');
      this.agenda = new Agenda({
        mongo: mongoose.connection.db,
        collection: 'jobs', // Collection name for jobs
        processEvery: '10 seconds',
        maxConcurrency: 3,
        defaultConcurrency: 1,
        defaultLockLifetime: 10 * 60 * 1000 // 10 minutes
      });

      // Handle agenda events
      this.agenda.on('ready', () => {
        console.log('✅ Agenda.js job queue ready');
      });

      this.agenda.on('error', (error) => {
        console.error('❌ Agenda.js error:', error);
      });

      // Define job processors
      console.log('📋 Defining job processors...');
      this.defineJobs();

      // Start agenda with timeout
      console.log('📋 Starting agenda...');
      const startPromise = this.agenda.start();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Agenda start timeout')), 5000)
      );

      try {
        await Promise.race([startPromise, timeoutPromise]);
        console.log('✅ Agenda started successfully');
      } catch (err) {
        console.log(`⚠️ Agenda start timeout (this is OK - will start in background)`);
        // Don't throw - just let it start in background
      }

      this.isInitialized = true;
      console.log('✅ Job queue service initialized');
      
    } catch (error) {
      console.error('❌ Failed to initialize job queue:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Define all job types and their processors
   */
  defineJobs() {
    // Question generation job
    this.agenda.define('generate-question-stream', async (job) => {
      const { 
        quizId, 
        questionId, 
        questionConfig, 
        learningObjective, 
        relevantContent,
        sessionId 
      } = job.attrs.data;

      console.log(`🎯 Processing question generation job: ${questionId}`);
      
      try {
        // Import here to avoid circular dependencies
        const { default: questionStreamingService } = await import('./questionStreamingService.js');
        
        // Generate question with streaming
        await questionStreamingService.generateQuestionWithStreaming({
          quizId,
          questionId,
          questionConfig,
          learningObjective,
          relevantContent,
          sessionId
        });

        console.log(`✅ Question generation job completed: ${questionId}`);
        
      } catch (error) {
        console.error(`❌ Question generation job failed: ${questionId}`, error);
        
        // Emit error event for SSE
        const { default: sseService } = await import('./sseService.js');
        sseService.emitError(sessionId, questionId, error.message);
        
        throw error;
      }
    });

    // Batch question generation job
    this.agenda.define('generate-questions-batch', async (job) => {
      const { 
        quizId, 
        questionConfigs, 
        sessionId,
        generationPlan 
      } = job.attrs.data;

      console.log(`🎯 Processing batch question generation: ${questionConfigs.length} questions`);
      
      try {
        // Schedule individual question generation jobs in parallel
        const questionJobs = questionConfigs.map((config, index) => ({
          name: 'generate-question-stream',
          data: {
            quizId,
            questionId: `question-${index + 1}`,
            questionConfig: config,
            learningObjective: config.learningObjective,
            relevantContent: config.relevantContent,
            sessionId
          }
        }));

        // Schedule all question jobs to run in parallel
        for (const questionJob of questionJobs) {
          await this.agenda.now(questionJob.name, questionJob.data);
        }

        console.log(`✅ Scheduled ${questionJobs.length} question generation jobs`);
        
      } catch (error) {
        console.error('❌ Batch question generation job failed:', error);
        throw error;
      }
    });

    // Material processing job (chunking and embedding)
    this.agenda.define('process-material', async (job) => {
      const { materialId } = job.attrs.data;

      console.log(`🔄 Processing material chunking job: ${materialId}`);

      try {
        // Import models and services
        const Material = (await import('../models/Material.js')).default;
        const ragService = (await import('../services/ragService.js')).default;
        const FileService = (await import('../services/fileService.js')).default;

        // Check if material still exists (may have been deleted)
        const material = await Material.findById(materialId);
        if (!material) {
          console.log(`⚠️ Material ${materialId} no longer exists, skipping processing`);
          return; // Job completes successfully but does nothing
        }

        console.log(`🔄 Chunking and embedding material: ${material.name}`);

        // Process and embed the material
        const result = await ragService.processAndEmbedMaterial(material);

        if (result.success) {
          // Check again if material still exists before updating
          const stillExists = await Material.findById(materialId);
          if (!stillExists) {
            console.log(`⚠️ Material ${materialId} was deleted during processing, cleaning up vectors...`);
            await ragService.cleanupMaterialEmbeddings(materialId);
            return;
          }

          await material.markAsCompleted();
          console.log(`✅ Material processed and embedded: ${material.name}`);
          console.log(`📊 Created ${result.chunksCount} chunks, embedded successfully`);

          // Clean up original file after successful processing
          if (material.filePath) {
            await FileService.deleteFile(material.filePath);
            console.log(`🗑️ Original file cleaned up: ${material.filePath}`);
            material.filePath = null;
            await material.save();
          }
        } else {
          await material.markAsFailed(result.error);
          console.error(`❌ Failed to process material: ${result.error}`);
        }

      } catch (error) {
        console.error(`❌ Material processing job failed: ${materialId}`, error);

        // Try to mark as failed in database
        try {
          const Material = (await import('../models/Material.js')).default;
          const material = await Material.findById(materialId);
          if (material) {
            await material.markAsFailed(error);
          }
        } catch (updateError) {
          console.error('Failed to update material status:', updateError);
        }

        throw error;
      }
    });

    console.log('📋 Job definitions registered');
  }

  /**
   * Add a job to the queue
   */
  async addJob(jobName, jobData, options = {}) {
    if (!this.isInitialized) {
      console.log('⏳ Job queue not initialized, attempting to initialize...');
      try {
        await this.initialize();
      } catch (initError) {
        console.error('❌ Failed to initialize job queue:', initError);
        throw new Error('Job queue not initialized and failed to initialize: ' + initError.message);
      }
    }

    try {
      const job = await this.agenda.now(jobName, jobData);
      console.log(`📋 Job added to queue: ${jobName} (${job.attrs._id})`);
      return job;
    } catch (error) {
      console.error('❌ Failed to add job to queue:', error);
      throw error;
    }
  }

  /**
   * Schedule question generation batch
   */
  async scheduleQuestionGeneration(quizId, questionConfigs, sessionId, generationPlan) {
    return this.addJob('generate-questions-batch', {
      quizId,
      questionConfigs,
      sessionId,
      generationPlan
    });
  }

  /**
   * Schedule material processing (chunking and embedding)
   */
  async scheduleMaterialProcessing(materialId) {
    return this.addJob('process-material', { materialId });
  }

  /**
   * Cancel all material processing jobs for a specific folder
   */
  async cancelMaterialJobsForFolder(folderMaterialIds) {
    if (!this.isInitialized || !folderMaterialIds || folderMaterialIds.length === 0) {
      return;
    }

    try {
      console.log(`🛑 Cancelling ${folderMaterialIds.length} material processing jobs...`);

      // Find all pending/running jobs for these materials
      const materialIdStrings = folderMaterialIds.map(id => id.toString());
      const jobs = await this.agenda.jobs({
        'name': 'process-material',
        'data.materialId': { $in: materialIdStrings },
        $or: [
          { 'nextRunAt': { $exists: true } },  // Scheduled
          { 'lockedAt': { $exists: true } }     // Running
        ]
      });

      console.log(`📋 Found ${jobs.length} jobs to cancel`);

      // Cancel each job
      for (const job of jobs) {
        await job.remove();
        console.log(`✅ Cancelled material processing job: ${job.attrs.data.materialId}`);
      }

      console.log(`✅ Cancelled all material processing jobs for folder`);
    } catch (error) {
      console.error('❌ Failed to cancel material jobs:', error);
    }
  }

  /**
   * Get job queue statistics
   */
  async getStats() {
    if (!this.isInitialized) {
      return { initialized: false };
    }

    try {
      const running = await this.agenda.jobs({ 'nextRunAt': { $exists: true } });
      const completed = await this.agenda.jobs({ 'lastFinishedAt': { $exists: true } });
      const failed = await this.agenda.jobs({ 'failedAt': { $exists: true } });

      return {
        initialized: true,
        running: running.length,
        completed: completed.length,
        failed: failed.length
      };
    } catch (error) {
      console.error('❌ Failed to get job stats:', error);
      return { error: error.message };
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.agenda) {
      console.log('🛑 Shutting down job queue...');
      await this.agenda.stop();
      console.log('✅ Job queue stopped');
    }
  }
}

// Create singleton instance
const jobQueueService = new JobQueueService();

export default jobQueueService;