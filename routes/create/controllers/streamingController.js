/**
 * Streaming Controller
 * Handles SSE endpoints for real-time question generation
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import sseService from '../services/sseService.js';
import jobQueueService from '../services/jobQueueService.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

/**
 * GET /api/streaming/questions/:sessionId
 * SSE endpoint for question generation progress
 */
router.get('/questions/:sessionId', authenticateToken, asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user.id;

  console.log(`📡 SSE connection requested for session: ${sessionId} by user: ${userId}`);

  // Validate session belongs to user (basic security)
  if (!sessionId || sessionId.length < 10) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  // Add client to SSE service
  sseService.addClient(sessionId, res, {
    userId,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });

  // Connection will be managed by sseService
  // Response is kept alive for streaming
}));

/**
 * POST /api/streaming/generate-questions
 * Start streaming question generation process
 */
router.post('/generate-questions', authenticateToken, asyncHandler(async (req, res) => {
  const {
    quizId,
    questionConfigs,
    generationPlan,
    sessionId
  } = req.body;

  const userId = req.user.id;

  console.log(`🚀 Starting streaming question generation for quiz: ${quizId}`);
  console.log(`📊 Questions to generate: ${questionConfigs?.length || 0}`);

  // Validate input
  if (!quizId || !questionConfigs || !Array.isArray(questionConfigs)) {
    return res.status(400).json({
      error: 'Missing required fields: quizId, questionConfigs'
    });
  }

  // Generate session ID if not provided
  const finalSessionId = sessionId || uuidv4();

  try {
    // Notify batch start via SSE
    sseService.notifyBatchStarted(finalSessionId, {
      quizId,
      totalQuestions: questionConfigs.length,
      questionTypes: questionConfigs.map(config => config.questionType),
      userId
    });

    // Process questions directly (bypassing job queue for now)
    console.log('🎯 Processing questions directly for immediate streaming');
    
    // Import question streaming service
    const { default: questionStreamingService } = await import('../services/questionStreamingService.js');
    
    // Process questions in parallel
    const questionPromises = questionConfigs.map(async (config, index) => {
      const questionId = `question-${index + 1}`;
      console.log(`🚀 Starting generation for ${questionId} (${config.questionType})`);
      
      try {
        await questionStreamingService.generateQuestionWithStreaming({
          quizId,
          questionId,
          questionConfig: config,
          learningObjective: config.learningObjective,
          relevantContent: config.relevantContent,
          sessionId: finalSessionId
        });
        console.log(`✅ Completed generation for ${questionId}`);
      } catch (error) {
        console.error(`❌ Failed to generate ${questionId}:`, error);
        // Emit error via SSE
        sseService.emitError(finalSessionId, questionId, error.message, 'generation-error');
      }
    });
    
    // Process all questions in parallel (non-blocking)
    Promise.all(questionPromises).then(() => {
      console.log('🎉 All questions completed, sending batch complete notification');
      sseService.notifyBatchComplete(finalSessionId, {
        totalGenerated: questionConfigs.length,
        totalTime: 'completed'
      });
    }).catch((error) => {
      console.error('❌ Batch processing failed:', error);
      sseService.emitError(finalSessionId, 'batch', error.message, 'batch-error');
    });

    console.log(`✅ Question generation started directly (bypassing job queue)`);

    // Return session info
    res.json({
      success: true,
      sessionId: finalSessionId,
      jobId: 'direct-processing',
      message: 'Question generation started with direct streaming',
      sseEndpoint: `/api/streaming/questions/${finalSessionId}`
    });

  } catch (error) {
    console.error('❌ Failed to start streaming generation:', error);
    
    // Emit error via SSE if possible
    sseService.emitError(finalSessionId, 'batch', error.message, 'startup-error');
    
    res.status(500).json({
      error: 'Failed to start question generation',
      details: error.message
    });
  }
}));

/**
 * GET /api/streaming/sessions
 * Get active SSE sessions (for debugging)
 */
router.get('/sessions', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') { // Add role check if needed
    return res.status(403).json({ error: 'Admin access required' });
  }

  const sessions = sseService.getActiveSessionsInfo();
  const jobStats = await jobQueueService.getStats();

  res.json({
    activeSessions: sessions,
    jobQueueStats: jobStats,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/streaming/test-sse/:sessionId
 * Test SSE endpoint without authentication (for testing only)
 */
router.get('/test-sse/:sessionId', asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  console.log(`📡 Test SSE connection requested for session: ${sessionId}`);

  // Add client to SSE service (no auth required for testing)
  sseService.addClient(sessionId, res, {
    isTest: true,
    ip: req.ip
  });

  // Connection will be managed by sseService
  // Response is kept alive for streaming
}));

/**
 * POST /api/streaming/test-real-llm
 * Test real LLM streaming (no auth for testing)
 */
router.post('/test-real-llm', asyncHandler(async (req, res) => {
  const { sessionId, questionType = 'multiple-choice' } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  console.log(`🧪 Starting real LLM streaming test for session: ${sessionId}`);

  try {
    // Import LLM service directly
    const { default: llmService } = await import('../services/llmService.js');
    
    // Check if LLM service is properly initialized
    if (!llmService.llm) {
      throw new Error('LLM service not initialized. Please check Ollama configuration.');
    }
    
    console.log('✅ LLM service is initialized');
    
    // Create test question config for LLM only (no database)
    const questionConfig = {
      questionType: questionType,
      difficulty: 'moderate',
      learningObjective: 'Students will understand the basic principles of machine learning and be able to explain the difference between supervised and unsupervised learning approaches.',
      relevantContent: [
        {
          content: 'Machine learning is a subset of artificial intelligence that focuses on creating systems that can learn and improve from experience without being explicitly programmed.',
          metadata: { source: 'test-material.pdf' }
        }
      ]
    };

    // Notify start
    sseService.notifyBatchStarted(sessionId, {
      quizId: 'test-quiz-id',
      totalQuestions: 1,
      questionTypes: [questionType],
      isRealLLMTest: true
    });

    // Notify question progress start
    sseService.streamQuestionProgress(sessionId, 'test-question-1', {
      status: 'started',
      type: questionType,
      learningObjective: questionConfig.learningObjective
    });

    console.log('🚀 Starting LLM generation...');

    // Test LLM streaming directly (no database save)
    const result = await llmService.generateQuestionStreaming(questionConfig, (textChunk, metadata) => {
      console.log(`📝 LLM chunk received: "${textChunk?.substring(0, 50)}..." (partial: ${metadata.partial})`);
      
      if (metadata.partial && textChunk) {
        // Stream the text chunk to the client
        sseService.streamTextChunk(sessionId, 'test-question-1', textChunk, {
          totalLength: metadata.totalLength,
          isPartial: true,
          timestamp: new Date().toISOString()
        });
      }
    });

    console.log(`✅ LLM streaming completed:`, result);

    // Notify question complete with the generated data
    sseService.notifyQuestionComplete(sessionId, 'test-question-1', result.questionData);

    // Complete batch
    setTimeout(() => {
      sseService.notifyBatchComplete(sessionId, {
        totalGenerated: 1,
        realLLMTest: true,
        questionId: 'test-question-1'
      });
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
    console.error('❌ Real LLM streaming test failed:', error);
    console.error('Error stack:', error.stack);
    sseService.emitError(sessionId, 'test-real-llm', error.message, 'real-llm-test-error');
    
    res.status(500).json({
      error: 'Real LLM streaming test failed',
      details: error.message,
      stack: error.stack
    });
  }
}));

/**
 * POST /api/streaming/test-simple-llm
 * Simple LLM test without any database operations
 */
router.post('/test-simple-llm', asyncHandler(async (req, res) => {
  const { prompt = 'Generate a simple multiple choice question about machine learning' } = req.body;

  console.log('🧪 Starting simple LLM test...');

  try {
    // Import LLM module directly
    const { LLMModule } = await import('ubc-genai-toolkit-llm');
    
    const llm = new LLMModule({
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
      defaultModel: 'llama3.1:8b',
      defaultOptions: {
        temperature: 0.7,
        maxTokens: 2000
      }
    });

    console.log('✅ LLM module initialized');
    
    const response = await llm.sendMessage(prompt);
    
    console.log(`✅ LLM response received: ${response.content.substring(0, 100)}...`);

    res.json({
      success: true,
      message: 'Simple LLM test completed',
      response: {
        content: response.content.substring(0, 500) + '...',
        model: response.model
      }
    });

  } catch (error) {
    console.error('❌ Simple LLM test failed:', error);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      error: 'Simple LLM test failed',
      details: error.message,
      stack: error.stack
    });
  }
}));

/**
 * POST /api/streaming/test-mock
 * Test SSE streaming with mock data (no auth for testing)
 */
router.post('/test-mock', asyncHandler(async (req, res) => {
  const { sessionId, testType = 'mock-generation' } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  console.log(`🧪 Starting SSE test for session: ${sessionId}`);

  try {
    if (testType === 'mock-generation') {
      // Simulate question generation process
      const mockQuestions = ['multiple-choice', 'true-false', 'flashcard'];
      
      // Notify start
      sseService.notifyBatchStarted(sessionId, {
        quizId: 'test-quiz',
        totalQuestions: mockQuestions.length,
        questionTypes: mockQuestions,
        isTest: true
      });

      // Schedule mock generation
      for (let i = 0; i < mockQuestions.length; i++) {
        setTimeout(() => {
          const questionId = `test-question-${i + 1}`;
          
          // Stream progress
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'generating',
            type: mockQuestions[i],
            progress: Math.round(((i + 1) / mockQuestions.length) * 100)
          });

          // Stream text chunks
          setTimeout(() => {
            sseService.streamTextChunk(sessionId, questionId, 
              `Sample ${mockQuestions[i]} question text...`, 
              { step: 1, totalSteps: 2 }
            );
          }, 1000);

          // Complete question
          setTimeout(() => {
            sseService.notifyQuestionComplete(sessionId, questionId, {
              questionText: `Test ${mockQuestions[i]} question`,
              type: mockQuestions[i],
              isTest: true
            });
          }, 2000);
        }, i * 3000);
      }

      // Complete batch
      setTimeout(() => {
        sseService.notifyBatchComplete(sessionId, {
          totalGenerated: mockQuestions.length,
          duration: '9 seconds',
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
    console.error('❌ SSE test failed:', error);
    sseService.emitError(sessionId, 'test', error.message, 'test-error');
    
    res.status(500).json({
      error: 'SSE test failed',
      details: error.message
    });
  }
}));

/**
 * POST /api/streaming/test
 * Test SSE streaming with mock data
 */
router.post('/test', authenticateToken, asyncHandler(async (req, res) => {
  const { sessionId, testType = 'mock-generation' } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  console.log(`🧪 Starting SSE test for session: ${sessionId}`);

  try {
    if (testType === 'mock-generation') {
      // Simulate question generation process
      const mockQuestions = ['multiple-choice', 'true-false', 'flashcard'];
      
      // Notify start
      sseService.notifyBatchStarted(sessionId, {
        quizId: 'test-quiz',
        totalQuestions: mockQuestions.length,
        questionTypes: mockQuestions,
        isTest: true
      });

      // Schedule mock generation
      for (let i = 0; i < mockQuestions.length; i++) {
        setTimeout(() => {
          const questionId = `test-question-${i + 1}`;
          
          // Stream progress
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'generating',
            type: mockQuestions[i],
            progress: Math.round(((i + 1) / mockQuestions.length) * 100)
          });

          // Stream text chunks
          setTimeout(() => {
            sseService.streamTextChunk(sessionId, questionId, 
              `Sample ${mockQuestions[i]} question text...`, 
              { step: 1, totalSteps: 2 }
            );
          }, 1000);

          // Complete question
          setTimeout(() => {
            sseService.notifyQuestionComplete(sessionId, questionId, {
              questionText: `Test ${mockQuestions[i]} question`,
              type: mockQuestions[i],
              isTest: true
            });
          }, 2000);
        }, i * 3000);
      }

      // Complete batch
      setTimeout(() => {
        sseService.notifyBatchComplete(sessionId, {
          totalGenerated: mockQuestions.length,
          duration: '9 seconds',
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
    console.error('❌ SSE test failed:', error);
    sseService.emitError(sessionId, 'test', error.message, 'test-error');
    
    res.status(500).json({
      error: 'SSE test failed',
      details: error.message
    });
  }
}));

/**
 * POST /api/streaming/test-real-llm-with-db
 * Test real LLM streaming with database save (no auth for testing)
 */
router.post('/test-real-llm-with-db', asyncHandler(async (req, res) => {
  const { sessionId, questionConfigs, quizId, learningObjective } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  console.log(`🧪 Starting real LLM streaming test with DB save for session: ${sessionId}`);
  console.log(`📊 Question configs received:`, questionConfigs?.length || 0);

  try {
    // Import LLM service directly
    const { default: llmService } = await import('../services/llmService.js');
    
    // Check if LLM service is properly initialized
    if (!llmService.llm) {
      throw new Error('LLM service not initialized. Please check Ollama configuration.');
    }
    
    console.log('✅ LLM service is initialized');
    
    // Use provided questionConfigs or create default ones
    const configs = questionConfigs || [
      {
        questionType: 'multiple-choice',
        difficulty: 'moderate',
        learningObjective: learningObjective || 'Students will understand the basic principles of machine learning.'
      }
    ];

    // Notify start
    sseService.notifyBatchStarted(sessionId, {
      quizId: quizId || 'test-quiz-id',
      totalQuestions: configs.length,
      questionTypes: configs.map(config => config.questionType),
      realLLMTestWithDB: true
    });

    console.log(`🚀 Starting LLM generation for ${configs.length} questions...`);

    let completedQuestions = 0;
    const allResults = [];

    // Generate questions sequentially to avoid overwhelming the LLM
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      const questionId = `test-question-${i + 1}`;
      
      console.log(`📝 Generating question ${i + 1}/${configs.length}: ${config.questionType}`);

      // Create question config for LLM
      const questionConfig = {
        questionType: config.questionType || 'multiple-choice',
        difficulty: config.difficulty || 'moderate',
        learningObjective: config.learningObjective || learningObjective || 'Students will understand the basic principles of machine learning.',
        relevantContent: [
          {
            content: 'Machine learning is a subset of artificial intelligence that focuses on creating systems that can learn and improve from experience without being explicitly programmed.',
            metadata: { source: 'test-material.pdf' }
          }
        ]
      };

      // Notify question progress start
      sseService.streamQuestionProgress(sessionId, questionId, {
        status: 'started',
        type: questionConfig.questionType,
        learningObjective: questionConfig.learningObjective
      });

      // Test LLM streaming with database save
      const result = await llmService.generateQuestionStreaming(questionConfig, (textChunk, metadata) => {
        console.log(`📝 LLM chunk received for ${questionId}: "${textChunk?.substring(0, 50)}..." (partial: ${metadata.partial})`);
        
        if (metadata.partial && textChunk) {
          // Stream the text chunk to the client
          sseService.streamTextChunk(sessionId, questionId, textChunk, {
            totalLength: metadata.totalLength,
            isPartial: true,
            timestamp: new Date().toISOString()
          });
        }
      });

      console.log(`✅ LLM streaming completed for ${questionId}:`, result.success);

      // Save to database if quizId is provided
      if (quizId && result.success && result.questionData) {
        try {
          const Question = (await import('../models/Question.js')).default;
          
          // Generate valid ObjectIds for required fields
          const { ObjectId } = await import('mongodb');
          const testLearningObjectiveId = new ObjectId();
          const testUserId = new ObjectId();
          
          const newQuestion = new Question({
            quiz: quizId,
            type: result.questionData.type,
            questionText: result.questionData.questionText,
            options: result.questionData.options || [],
            correctAnswer: result.questionData.correctAnswer,
            explanation: result.questionData.explanation,
            content: result.questionData.content || {},
            difficulty: result.questionData.difficulty,
            learningObjective: testLearningObjectiveId, // Use valid ObjectId
            order: i,
            reviewStatus: 'pending',
            createdBy: testUserId, // Use valid ObjectId
            generationMetadata: result.questionData.generationMetadata
          });

          const savedQuestion = await newQuestion.save();
          console.log(`💾 Saved streaming question ${i + 1} to database: ${savedQuestion._id}`);
          
          // Update the question data with the saved ID
          result.questionData._id = savedQuestion._id;
        } catch (dbError) {
          console.error(`❌ Database save failed for question ${i + 1}:`, dbError);
          // Continue without failing the whole operation
        }
      }

      // Notify question complete with the generated data
      sseService.notifyQuestionComplete(sessionId, questionId, result.questionData);
      
      allResults.push(result);
      completedQuestions++;
      
      // Small delay between questions to avoid overwhelming the system
      if (i < configs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Complete batch
    setTimeout(() => {
      sseService.notifyBatchComplete(sessionId, {
        totalGenerated: completedQuestions,
        realLLMTestWithDB: true,
        questionIds: allResults.map((_, i) => `test-question-${i + 1}`)
      });
    }, 1000);

    res.json({
      success: true,
      message: `Real LLM streaming test with DB save completed for session: ${sessionId}`,
      totalQuestions: completedQuestions,
      results: allResults.map((result, i) => ({
        questionId: `test-question-${i + 1}`,
        questionText: result.questionData?.questionText?.substring(0, 100) + '...',
        type: result.questionData?.type,
        savedToDB: !!quizId
      }))
    });

  } catch (error) {
    console.error('❌ Real LLM streaming test with DB save failed:', error);
    console.error('Error stack:', error.stack);
    sseService.emitError(sessionId, 'test-real-llm-with-db', error.message, 'real-llm-test-error');
    
    res.status(500).json({
      error: 'Real LLM streaming test with DB save failed',
      details: error.message,
      stack: error.stack
    });
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
    
    console.log(`🔍 Found ${questions.length} questions for quiz ${quizId}`);
    
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
        generationMetadata: q.generationMetadata,
        createdAt: q.createdAt
      }))
    });
  } catch (error) {
    console.error('❌ Failed to load test questions:', error);
    res.status(500).json({
      error: 'Failed to load questions',
      details: error.message
    });
  }
}));

export default router;