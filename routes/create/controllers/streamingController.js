/**
 * Streaming Controller
 * Handles SSE endpoints for real-time question generation
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import sseService from '../services/sseService.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

/**
 * Enrich question configs with learning objective ObjectIds from quiz.
 * Maps text or index-based LO references to actual Mongoose documents.
 */
function enrichQuestionConfigsWithObjectives(questionConfigs, quiz) {
  return questionConfigs.map((config, index) => {
    let learningObjective;

    if (config.learningObjectiveIndex !== undefined) {
      learningObjective = quiz.learningObjectives[config.learningObjectiveIndex];
    } else if (config.learningObjective) {
      learningObjective = quiz.learningObjectives.find(lo => lo.text === config.learningObjective);
    } else {
      learningObjective = quiz.learningObjectives[index % quiz.learningObjectives.length];
    }

    return {
      ...config,
      learningObjective: learningObjective || quiz.learningObjectives[0]
    };
  });
}

// ============================================================
// Production endpoints
// ============================================================

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
router.post('/generate-questions', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, questionConfigs, sessionId } = req.body;
  const userId = req.user.id;

  if (!quizId || !questionConfigs || !Array.isArray(questionConfigs)) {
    return res.status(400).json({
      error: 'Missing required fields: quizId, questionConfigs'
    });
  }

  const finalSessionId = sessionId || uuidv4();

  try {
    const Quiz = (await import('../models/Quiz.js')).default;
    const quiz = await Quiz.findById(quizId).populate('learningObjectives');

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const enrichedConfigs = enrichQuestionConfigsWithObjectives(questionConfigs, quiz);

    sseService.notifyBatchStarted(finalSessionId, {
      quizId,
      totalQuestions: enrichedConfigs.length,
      questionTypes: enrichedConfigs.map(config => config.questionType),
      userId
    });

    const { default: questionStreamingService } = await import('../services/questionStreamingService.js');

    // Helper function to add timeout to a promise
    const withTimeout = (promise, timeoutMs, questionId) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Generation timeout after ${timeoutMs/1000}s`)), timeoutMs)
        )
      ]).catch(error => {
        console.error(`[${questionId}] Timeout or error:`, error.message);
        throw error;
      });
    };

    const QUESTION_TIMEOUT_MS = 120000; // 2 minutes per question

    const questionPromises = enrichedConfigs.map(async (config, index) => {
      const questionId = `question-${index + 1}`;
      try {
        await withTimeout(
          questionStreamingService.generateQuestionWithStreaming({
            quizId,
            questionId,
            questionConfig: config,
            learningObjective: config.learningObjective,
            relevantContent: config.relevantContent,
            sessionId: finalSessionId,
            userId
          }),
          QUESTION_TIMEOUT_MS,
          questionId
        );
        console.log(`[${questionId}] Generation completed successfully`);
        return { success: true, questionId };
      } catch (error) {
        console.error(`[${questionId}] Failed to generate:`, error.message);
        sseService.emitError(finalSessionId, questionId, error.message, 'generation-error');
        
        // Send a "complete" event even for failed questions to unblock the UI
        sseService.notifyQuestionComplete(finalSessionId, questionId, {
          error: true,
          errorMessage: error.message,
          questionId
        });
        
        return { success: false, questionId, error: error.message };
      }
    });

    Promise.all(questionPromises).then((results) => {
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      
      console.log(`✅ Batch complete: ${successCount} succeeded, ${failureCount} failed`);
      console.log(`📤 Sending batch-complete event to session: ${finalSessionId}`);
      
      // Add a small delay to ensure all question-complete events are processed first
      setTimeout(() => {
        const sent = sseService.notifyBatchComplete(finalSessionId, {
          totalGenerated: successCount,
          totalFailed: failureCount,
          totalTime: 'completed'
        });
        console.log(`📡 batch-complete sent result: ${sent}`);
      }, 500);
    }).catch((error) => {
      // This should rarely happen now since we catch errors in individual promises
      console.error('❌ Unexpected batch error:', error);
      sseService.emitError(finalSessionId, 'batch', error.message, 'batch-error');
      
      // Still send batch-complete to unblock the UI
      setTimeout(() => {
        sseService.notifyBatchComplete(finalSessionId, {
          totalGenerated: 0,
          totalFailed: enrichedConfigs.length,
          error: true
        });
      }, 500);
    });

    res.json({
      success: true,
      sessionId: finalSessionId,
      jobId: 'direct-processing',
      message: 'Question generation started with direct streaming',
      sseEndpoint: `/api/streaming/questions/${finalSessionId}`
    });

  } catch (error) {
    console.error('Failed to start streaming generation:', error);
    sseService.emitError(finalSessionId, 'batch', error.message, 'startup-error');
    res.status(500).json({
      error: 'Failed to start question generation',
      details: error.message
    });
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
  router.get('/test-sse/:sessionId', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    sseService.addClient(sessionId, res, { isTest: true, ip: req.ip });
  }));

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
        }]
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
          }]
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
  router.get('/test-questions/:quizId', asyncHandler(async (req, res) => {
    const { quizId } = req.params;

    try {
      const Question = (await import('../models/Question.js')).default;
      const questions = await Question.find({ quiz: quizId })
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
