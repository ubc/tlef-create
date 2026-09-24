/**
 * Streaming Controller
 * Handles SSE endpoints for real-time question generation
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import sseService from '../services/sseService.js';
import mongoose from 'mongoose';
import { getGenerationReadiness } from '../utils/generationReadiness.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import questionGenerationJobs, { questionGenerationRequestHash, serializeQuestionJob } from '../services/questionGenerationJobs.js';
import { createQuestionBatchWork, normalizeGenerationConfigs } from '../services/questionBatchGeneration.js';
import QuestionGenerationJob from '../models/QuestionGenerationJob.js';

const router = express.Router();

// ============================================================
// Production endpoints
// ============================================================

// The UI calls this before replacement can delete existing questions. Generation
// repeats the same check because material state can change after the preflight.
router.post('/generation-readiness', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, questionConfigs } = req.body;
  const Quiz = (await import('../models/Quiz.js')).default;
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: req.user.id }).populate('materials');
  if (!quiz) return notFoundResponse(res, 'Learning object');
  const readiness = getGenerationReadiness(quiz, questionConfigs);
  if (!readiness.ready) return errorResponse(res, readiness.message, readiness.code, readiness.status);
  return successResponse(res, { ready: true });
}));

/**
 * GET /api/streaming/questions/:sessionId
 * SSE endpoint for question generation progress
 */
router.get('/questions/:sessionId', authenticateToken, asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user.id;

  if (!sessionId || sessionId.length < 10) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }
  const knownJob = await QuestionGenerationJob.exists({ sessionId });
  if (knownJob && !await questionGenerationJobs.findSession(userId, sessionId)) return notFoundResponse(res, 'Generation task');
  // LO and Blueprint clients subscribe before their POST. They use this shared
  // transport without a question receipt, but still retain an authenticated owner.
  sseService.claimSession(sessionId, userId);

  sseService.addClient(sessionId, res, {
    userId,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });
}));

/**
 * POST /api/streaming/generate-questions
 * Start streaming question generation process
 */
router.get('/generation-jobs', authenticateToken, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.quizId)) return errorResponse(res, 'Invalid learning object ID.', 'VALIDATION_ERROR', 400);
  const jobs = await questionGenerationJobs.list(req.user.id, req.query.quizId);
  if (!jobs) return notFoundResponse(res, 'Learning object');
  return successResponse(res, { jobs: jobs.map(serializeQuestionJob) });
}));

router.get('/generation-jobs/:requestId', authenticateToken, asyncHandler(async (req, res) => {
  const job = await questionGenerationJobs.get(req.user.id, req.params.requestId);
  if (!job) return notFoundResponse(res, 'Generation task');
  return successResponse(res, { job: serializeQuestionJob(job) });
}));

router.post('/generation-jobs/:requestId/abandon', authenticateToken, asyncHandler(async (req, res) => {
  try {
    const job = await questionGenerationJobs.abandon({ owner: req.user.id, quizId: req.body.quizId, requestId: req.params.requestId });
    return successResponse(res, { job: serializeQuestionJob(job) });
  } catch (error) {
    return errorResponse(res, error.status ? error.message : 'The request could not be confirmed. Keep this request ID and try checking again.', error.code || 'GENERATION_RECOVERY_FAILED', error.status || 503);
  }
}));

router.post('/generate-questions', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, requestId, mode = 'append' } = req.body;
  const userId = req.user.id;
  try {
    if (!mongoose.isValidObjectId(quizId) || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '')) {
      return errorResponse(res, 'A valid learning object and generation request ID are required.', 'INVALID_GENERATION_REQUEST', 400);
    }
    const questionConfigs = normalizeGenerationConfigs(req.body.questionConfigs);
    const Quiz = (await import('../models/Quiz.js')).default;
    const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId }).populate('learningObjectives').populate('materials');
    if (!quiz) return notFoundResponse(res, 'Learning object');
    // Replays return the durable result even if materials/settings changed since
    // admission. The same request ID cannot be reused for another paid intent.
    const previous = await questionGenerationJobs.get(userId, requestId);
    if (previous?.abandoned) {
      return errorResponse(res, 'This request was closed before generation started. Start a new attempt with a new request ID.', 'GENERATION_REQUEST_ABANDONED', 409);
    }
    if (previous && previous.requestHash !== questionGenerationRequestHash({ quizId, mode, questionConfigs })) {
      return errorResponse(res, 'This request ID was already used for different generation instructions.', 'REQUEST_ID_CONFLICT', 409);
    }
    const readiness = previous ? { ready: true } : getGenerationReadiness(quiz, questionConfigs);
    if (!readiness.ready) return errorResponse(res, readiness.message, readiness.code, readiness.status);
    if (!previous && questionConfigs.some(config => config.learningObjectiveId && !quiz.learningObjectives.some(lo => String(lo._id) === config.learningObjectiveId))) {
      return errorResponse(res, 'A selected learning objective no longer belongs to this learning object.', 'INVALID_GENERATION_CONFIG', 400);
    }
    if (!previous && questionConfigs.some(config => (config.supportingLearningObjectiveIds || [])
      .some(id => !quiz.learningObjectives.some(lo => String(lo._id) === String(id))))) {
      return errorResponse(res, 'A supporting learning objective no longer belongs to this learning object.', 'INVALID_GENERATION_CONFIG', 400);
    }
    const job = await questionGenerationJobs.start({
      owner: userId, quizId, requestId, mode, questionConfigs, expectedQuizVersion: quiz.__v || 0,
      work: createQuestionBatchWork({ quiz, questionConfigs, readiness, userId, mode }),
      onSettled(receipt) {
        if (!receipt) return;
        sseService.notifyBatchComplete(receipt.sessionId, {
          totalGenerated: receipt.status === 'succeeded' ? receipt.items.length : 0,
          totalFailed: receipt.items.filter(item => item.status === 'failed').length,
          requestId: receipt.requestId, status: receipt.status, error: receipt.status !== 'succeeded'
        });
      }
    });
    return res.status(job.active ? 202 : 200).json({ success: true, sessionId: job.sessionId, jobId: String(job._id),
      requestId: job.requestId, job: serializeQuestionJob(job), sseEndpoint: `/api/create/streaming/questions/${job.sessionId}` });
  } catch (error) {
    return errorResponse(res, error.status ? error.message : 'Question generation could not be started. Retry with the same request ID to check whether it was accepted.', error.code || 'GENERATION_START_FAILED', error.status || 503);
  }
}));

// ============================================================
// Test/diagnostic endpoints (disabled in production)
// ============================================================

if (process.env.NODE_ENV !== 'production') {
  /**
   * GET /api/streaming/sessions
   * Get active SSE sessions (for debugging)
   */
  router.get('/sessions', authenticateToken, asyncHandler(async (req, res) => {
    const sessions = sseService.getActiveSessionsInfo();

    res.json({
      activeSessions: sessions,
      timestamp: new Date().toISOString()
    });
  }));

  /**
   * GET /api/streaming/test-sse/:sessionId
   * Test SSE endpoint without authentication
   */
  router.get('/test-sse/:sessionId', authenticateToken, (req, res) => res.redirect(307, `/api/create/streaming/questions/${encodeURIComponent(req.params.sessionId)}`));

  /**
   * GET /api/streaming/diagnostic
   * Diagnostic endpoint to check streaming configuration
   */
  router.get('/diagnostic', asyncHandler(async (req, res) => {
    try {
      const { default: llmService } = await import('../services/llmService.js');

      let openaiInstalled = false;
      let openaiVersion = 'not installed';
      try {
        await import('openai');
        openaiInstalled = true;
        openaiVersion = 'installed';
      } catch (e) {
        openaiVersion = 'ERROR: ' + e.message;
      }

      res.json({
        success: true,
        diagnostics: {
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV,
          llmConfig: {
            provider: process.env.LLM_PROVIDER || 'not set',
            model: process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'not set',
            apiKeyPresent: !!process.env.OPENAI_API_KEY,
            llmServiceInitialized: !!llmService.llm,
            llmProvider: llmService.provider
          },
          packages: { openaiInstalled, openaiVersion },
          streaming: { sseServiceActive: true }
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }));

  /**
   * POST /api/streaming/test-mock
   * Test SSE streaming with mock data
   */
  router.post('/test-mock', asyncHandler(async (req, res) => {
    const { sessionId, testType = 'mock-generation' } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    try {
      if (testType === 'mock-generation') {
        const mockQuestions = ['multiple-choice', 'true-false', 'flashcard'];

        sseService.notifyBatchStarted(sessionId, {
          quizId: 'test-quiz',
          totalQuestions: mockQuestions.length,
          questionTypes: mockQuestions,
          isTest: true
        });

        for (let i = 0; i < mockQuestions.length; i++) {
          setTimeout(() => {
            const questionId = `test-question-${i + 1}`;
            sseService.streamQuestionProgress(sessionId, questionId, {
              status: 'generating',
              type: mockQuestions[i],
              progress: Math.round(((i + 1) / mockQuestions.length) * 100)
            });
            setTimeout(() => {
              sseService.streamTextChunk(sessionId, questionId,
                `Sample ${mockQuestions[i]} question text...`,
                { step: 1, totalSteps: 2 }
              );
            }, 1000);
            setTimeout(() => {
              sseService.notifyQuestionComplete(sessionId, questionId, {
                questionText: `Test ${mockQuestions[i]} question`,
                type: mockQuestions[i],
                isTest: true
              });
            }, 2000);
          }, i * 3000);
        }

        setTimeout(() => {
          sseService.notifyBatchComplete(sessionId, {
            totalGenerated: mockQuestions.length,
            isTest: true
          });
        }, mockQuestions.length * 3000);
      }

      res.json({
        success: true,
        message: `SSE test started for session: ${sessionId}`,
        testType
      });
    } catch (error) {
      sseService.emitError(sessionId, 'test', error.message, 'test-error');
      res.status(500).json({ error: 'SSE test failed', details: error.message });
    }
  }));

  /**
   * POST /api/streaming/test-real-llm
   * Test real LLM streaming
   */
  router.post('/test-real-llm', asyncHandler(async (req, res) => {
    const { sessionId, questionType = 'multiple-choice' } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    try {
      const { default: llmService } = await import('../services/llmService.js');

      if (!llmService.llm) {
        throw new Error('LLM service not initialized.');
      }

      const questionConfig = {
        questionType,
        difficulty: 'moderate',
        learningObjective: 'Students will understand the basic principles of machine learning.',
        relevantContent: [{
          content: 'Machine learning is a subset of AI that focuses on creating systems that learn from experience.',
          metadata: { source: 'test-material.pdf' }
        }],
        userId: req.user?.id
      };

      sseService.notifyBatchStarted(sessionId, {
        quizId: 'test-quiz-id',
        totalQuestions: 1,
        questionTypes: [questionType],
        isRealLLMTest: true
      });

      sseService.streamQuestionProgress(sessionId, 'test-question-1', {
        status: 'started',
        type: questionType,
        learningObjective: questionConfig.learningObjective
      });

      const result = await llmService.generateQuestionStreaming(questionConfig, (textChunk, metadata) => {
        if (metadata.partial && textChunk) {
          sseService.streamTextChunk(sessionId, 'test-question-1', textChunk, {
            totalLength: metadata.totalLength,
            isPartial: true
          });
        }
      });

      sseService.notifyQuestionComplete(sessionId, 'test-question-1', result.questionData);

      setTimeout(() => {
        sseService.notifyBatchComplete(sessionId, { totalGenerated: 1, realLLMTest: true });
      }, 1000);

      res.json({
        success: true,
        message: `Real LLM streaming test completed for session: ${sessionId}`,
        questionType,
        result: {
          questionText: result.questionData?.questionText?.substring(0, 100) + '...',
          type: result.questionData?.type
        }
      });
    } catch (error) {
      console.error('Real LLM streaming test failed:', error);
      sseService.emitError(sessionId, 'test-real-llm', error.message, 'real-llm-test-error');
      res.status(500).json({ error: 'Real LLM streaming test failed', details: error.message });
    }
  }));

  /**
   * POST /api/streaming/test-simple-llm
   * Simple LLM test without any database operations
   */
  router.post('/test-simple-llm', asyncHandler(async (req, res) => {
    const { prompt = 'Generate a simple multiple choice question about machine learning' } = req.body;

    try {
      const { LLMModule } = await import('ubc-genai-toolkit-llm');

      const llm = new LLMModule({
        provider: 'ollama',
        endpoint: 'http://localhost:11434',
        defaultModel: 'llama3.1:8b',
        defaultOptions: { temperature: 0.7, maxTokens: 2000 }
      });

      const response = await llm.sendMessage(prompt);

      res.json({
        success: true,
        message: 'Simple LLM test completed',
        response: {
          content: response.content.substring(0, 500) + '...',
          model: response.model
        }
      });
    } catch (error) {
      console.error('Simple LLM test failed:', error);
      res.status(500).json({ error: 'Simple LLM test failed', details: error.message });
    }
  }));

  /**
   * POST /api/streaming/test-real-llm-with-db
   * Test real LLM streaming with database save
   */
  router.post('/test-real-llm-with-db', asyncHandler(async (req, res) => {
    const { sessionId, questionConfigs, quizId, learningObjective } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    try {
      const Quiz = (await import('../models/Quiz.js')).default;
      const quiz = await Quiz.findById(quizId).populate('learningObjectives');
      if (!quiz) {
        return res.status(404).json({ error: 'Quiz not found' });
      }

      const { default: llmService } = await import('../services/llmService.js');
      if (!llmService.llm) {
        throw new Error('LLM service not initialized.');
      }

      const configs = questionConfigs || [{
        questionType: 'multiple-choice',
        difficulty: 'moderate',
        learningObjective: learningObjective || 'Students will understand the basic principles of machine learning.'
      }];

      sseService.notifyBatchStarted(sessionId, {
        quizId: quizId || 'test-quiz-id',
        totalQuestions: configs.length,
        questionTypes: configs.map(c => c.questionType),
        realLLMTestWithDB: true
      });

      let completedQuestions = 0;
      const allResults = [];

      for (let i = 0; i < configs.length; i++) {
        const config = configs[i];
        const questionId = `test-question-${i + 1}`;

        const questionConfig = {
          questionType: config.questionType || 'multiple-choice',
          difficulty: config.difficulty || 'moderate',
          learningObjective: config.learningObjective || learningObjective || 'Students will understand the basic principles of machine learning.',
          relevantContent: [{
            content: 'Machine learning is a subset of AI that focuses on creating systems that learn from experience.',
            metadata: { source: 'test-material.pdf' }
          }],
          userId: req.user?.id
        };

        sseService.streamQuestionProgress(sessionId, questionId, {
          status: 'started',
          type: questionConfig.questionType,
          learningObjective: questionConfig.learningObjective
        });

        const result = await llmService.generateQuestionStreaming(questionConfig, (textChunk, metadata) => {
          if (metadata.partial && textChunk) {
            sseService.streamTextChunk(sessionId, questionId, textChunk, {
              totalLength: metadata.totalLength,
              isPartial: true
            });
          }
        });

        if (quizId && result.success && result.questionData) {
          try {
            const Question = (await import('../models/Question.js')).default;
            const loIndex = config.learningObjectiveIndex || (i % quiz.learningObjectives.length);
            const learningObjectiveId = quiz.learningObjectives[loIndex]?._id;

            if (learningObjectiveId) {
              const newQuestion = new Question({
                quiz: quizId,
                type: result.questionData.type,
                questionText: result.questionData.questionText,
                correctAnswer: result.questionData.correctAnswer,
                explanation: result.questionData.explanation,
                content: result.questionData.content || {},
                difficulty: result.questionData.difficulty,
                learningObjective: learningObjectiveId,
                order: i,
                reviewStatus: 'pending',
                createdBy: quiz.createdBy,
                generationMetadata: result.questionData.generationMetadata
              });

              const savedQuestion = await newQuestion.save();
              const quizForUpdate = await Quiz.findById(quizId);
              if (quizForUpdate) {
                await quizForUpdate.addQuestion(savedQuestion._id);
              }
              result.questionData._id = savedQuestion._id;
            }
          } catch (dbError) {
            console.error(`Database save failed for question ${i + 1}:`, dbError);
          }
        }

        sseService.notifyQuestionComplete(sessionId, questionId, result.questionData);
        allResults.push(result);
        completedQuestions++;

        if (i < configs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setTimeout(() => {
        sseService.notifyBatchComplete(sessionId, {
          totalGenerated: completedQuestions,
          realLLMTestWithDB: true
        });
      }, 1000);

      res.json({
        success: true,
        message: `Real LLM streaming test with DB save completed`,
        totalQuestions: completedQuestions,
        results: allResults.map((result, i) => ({
          questionId: `test-question-${i + 1}`,
          questionText: result.questionData?.questionText?.substring(0, 100) + '...',
          type: result.questionData?.type,
          savedToDB: !!quizId
        }))
      });
    } catch (error) {
      console.error('Real LLM streaming test with DB save failed:', error);
      sseService.emitError(sessionId, 'test-real-llm-with-db', error.message, 'real-llm-test-error');
      res.status(500).json({ error: 'Real LLM streaming test with DB save failed', details: error.message });
    }
  }));

  /**
   * GET /api/streaming/test-questions/:quizId
   * Test endpoint to view saved questions without authentication
   */
  router.get('/test-questions/:quizId', authenticateToken, asyncHandler(async (req, res) => {
    const { quizId } = req.params;

    try {
      const Question = (await import('../models/Question.js')).default;
      const Quiz = (await import('../models/Quiz.js')).default;
      const quiz = await Quiz.findOne({ _id: quizId, createdBy: req.user.id });
      if (!quiz) return notFoundResponse(res, 'Learning object');
      const questions = await Question.find({ quiz: quizId, _id: { $in: quiz.questions } })
        .populate('learningObjective', 'text order')
        .sort({ order: 1 });

      res.json({
        success: true,
        quizId,
        totalQuestions: questions.length,
        questions: questions.map(q => ({
          _id: q._id,
          type: q.type,
          questionText: q.questionText.substring(0, 100) + '...',
          difficulty: q.difficulty,
          order: q.order,
          createdAt: q.createdAt
        }))
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load questions', details: error.message });
    }
  }));
}

export default router;
