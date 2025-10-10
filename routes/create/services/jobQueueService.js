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

      // Try alternative initialization approach
      console.log('📋 Attempting agenda startup...');
      try {
        // Use promise with shorter timeout and different approach
        console.log('📋 Trying quick start approach...');
        await Promise.race([
          this.agenda.start(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Quick start timeout')), 3000))
        ]);
        this.isInitialized = true;
        console.log('✅ Job queue service initialized successfully with quick start');
      } catch (quickStartError) {
        console.log(`⚠️ Quick start failed: ${quickStartError.message}, trying manual initialization...`);
        
        // Manual initialization with forced start() call
        console.log('📋 Attempting manual initialization...');
        try {
          // Force start agenda even if quick start failed
          await this.agenda.start();
          this.isInitialized = true;
          console.log('✅ Job queue service initialized manually and started');
        } catch (manualError) {
          console.error('❌ Manual initialization also failed:', manualError);
          // Mark as initialized anyway to allow job scheduling
          this.isInitialized = true;
          console.log('⚠️ Job queue initialized in degraded mode - jobs may not process');
        }
      }
      
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
      // Ensure agenda is started before scheduling jobs
      if (!this.agenda._ready) {
        console.log('📋 Starting agenda on first job...');
        try {
          await this.agenda.start();
          console.log('✅ Agenda started successfully');
        } catch (startError) {
          console.log('⚠️ Agenda start failed, proceeding anyway:', startError.message);
        }
      }
      
      const job = await this.agenda.schedule(options.when || 'now', jobName, jobData);
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