import express from 'express';
import Question from '../models/Question.js';
import Quiz from '../models/Quiz.js';
import LearningObjective from '../models/LearningObjective.js';
import GenerationPlan from '../models/GenerationPlan.js';
import { authenticateToken, attachUser } from '../middleware/auth.js';
import { validateCreateQuestion, validateGenerateQuestions, validateReorderQuestions, validateMongoId, validateQuizId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, QUESTION_TYPES, DIFFICULTY_LEVELS, REVIEW_STATUS } from '../config/constants.js';
import { generateDetailedPrompts, generateQuestionFromPrompt } from '../services/promptGenerationService.js';
import intelligentQuestionGenerationService from '../services/intelligentQuestionGenerationService.js';

const router = express.Router();

/**
 * GET /api/questions/quiz/:quizId
 * Get quiz questions
 */
router.get('/quiz/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const questions = await Question.find({ quiz: quizId })
    .populate('learningObjective', 'text order')
    .populate('generationPlan', 'approach')
    .populate('createdBy', 'cwlId')
    .sort({ order: 1 });

  // Debug logging for Summary questions when loading
  const summaryQuestions = questions.filter(q => q.type === 'summary');
  if (summaryQuestions.length > 0) {
    console.log(`🔍 Loading ${summaryQuestions.length} Summary questions from database:`);
    summaryQuestions.forEach((q, index) => {
      console.log(`📋 Summary ${index + 1}: ${q._id}`);
      console.log(`📝 Question text: ${q.questionText}`);
      console.log(`💾 Content from DB:`, JSON.stringify(q.content, null, 2));
      console.log(`🔑 Has keyPoints:`, !!q.content?.keyPoints);
      if (q.content?.keyPoints) {
        console.log(`📊 KeyPoints count:`, q.content.keyPoints.length);
      }
    });
  }

  return successResponse(res, { questions }, 'Questions retrieved successfully');
}));

/**
 * POST /api/questions/generate-from-plan
 * Generate questions from approved plan
 */
router.post('/generate-from-plan', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId } = req.body;
  const userId = req.user.id;

  console.log('🚀 Question generation started for quiz:', quizId, 'by user:', userId);

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    console.log('❌ Quiz not found:', quizId, 'for user:', userId);
    return notFoundResponse(res, 'Quiz');
  }

  console.log('✅ Quiz found:', quiz.name);

  // Get the approved plan for this quiz
  const plan = await GenerationPlan.findOne({ 
    quiz: quizId, 
    status: 'approved',
    createdBy: userId 
  }).populate('breakdown.learningObjective');

  console.log('🔍 Looking for approved plan for quiz:', quizId);
  
  if (!plan) {
    console.log('❌ No approved plan found for quiz:', quizId);
    // Also check what plans exist
    const allPlans = await GenerationPlan.find({ quiz: quizId, createdBy: userId });
    console.log('📋 All plans for this quiz:', allPlans.map(p => ({ id: p._id, status: p.status })));
    return errorResponse(res, 'No approved plan found for this quiz', 'NO_APPROVED_PLAN', HTTP_STATUS.BAD_REQUEST);
  }

  console.log('✅ Approved plan found:', plan._id, 'with', plan.breakdown.length, 'breakdown items');

  try {
    console.log('🧠 Starting intelligent RAG + LLM question generation...');

    const provider = process.env.LLM_PROVIDER || 'ollama';
    const model = provider === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.OLLAMA_MODEL || 'llama3.1:8b');
    console.log(`🤖 Using ${provider} model: ${model}`);

    // Use the intelligent generation service instead of template-based generation
    const generationResult = await intelligentQuestionGenerationService.generateQuestionsForQuiz(
      quizId,
      {
        difficulty: 'moderate',
        useRAG: true,
        useLLM: true
      }
    );

    console.log('🔍 Generation result summary:', {
      success: generationResult.success,
      questionsCount: generationResult.questions?.length || 0,
      hasError: !!generationResult.error,
      errorMessage: generationResult.error
    });

    if (!generationResult.success) {
      console.log('❌ Intelligent generation failed, falling back to enhanced prompts...');
      throw new Error(generationResult.error || 'Intelligent generation failed');
    }

    console.log('✅ Intelligent generation successful!');
    console.log(`📊 Generated ${generationResult.questions.length} questions`);
    console.log(`🔍 RAG enabled: ${generationResult.metadata.ragEnabled}`);
    console.log(`🤖 Generation method: ${generationResult.metadata.generationMethod}`);

    // Convert generated questions to database format and save them
    const questions = [];
    let questionOrder = 0;

    for (const generatedQuestion of generationResult.questions) {
      console.log(`💾 Saving question ${questionOrder + 1}: ${generatedQuestion.questionText ? generatedQuestion.questionText.substring(0, 50) : 'No text'}...`);
      
      const question = new Question({
        quiz: quizId,
        learningObjective: generatedQuestion.learningObjectiveId,
        generationPlan: plan._id,
        type: generatedQuestion.type,
        difficulty: 'moderate',
        questionText: generatedQuestion.questionText,
        content: formatContentForDatabase(generatedQuestion, generatedQuestion.type),
        correctAnswer: generatedQuestion.correctAnswer,
        explanation: generatedQuestion.explanation,
        order: questionOrder++,
        generationMetadata: {
          ...generatedQuestion.generationMetadata,
          generationMethod: 'intelligent-rag-llm',
          ragEnabled: generationResult.metadata.ragEnabled,
          courseContext: generationResult.metadata.courseContext
        },
        createdBy: userId
      });

      await question.save();
      console.log('✅ Question saved:', question._id);
      
      // Debug logging for Summary questions
      if (generatedQuestion.type === 'summary') {
        console.log('🔍 Summary question saved to database:');
        console.log('📋 Saved content:', JSON.stringify(question.content, null, 2));
        console.log('🆔 Question ID:', question._id);
        console.log('📝 Question text:', question.questionText);
      }
      
      questions.push(question);
      await quiz.addQuestion(question._id);
    }

    console.log('🎉 Saved', questions.length, 'intelligent questions to database');

    // Mark plan as used
    await plan.markAsUsed();

    // Update user stats
    if (req.user.fullUser) {
      await req.user.fullUser.incrementStats('questionsCreated');
    }

    // Add generation record to quiz
    await quiz.addGenerationRecord({
      approach: plan.approach,
      questionsGenerated: questions.length,
      processingTime: 8000, // Intelligent generation takes longer
      llmModel: generationResult.metadata.llmModel || 'llama3.1:8b',
      generationMethod: 'intelligent-rag-llm',
      ragEnabled: generationResult.metadata.ragEnabled,
      success: true
    });

    // Update folder stats to reflect new question count
    const Folder = require('../models/Folder');
    const folder = await Folder.findOne({ quizzes: quizId });
    if (folder) {
      console.log('📊 Updating folder stats after question generation...');
      await folder.updateStats();
      console.log('✅ Folder stats updated');
    }

    return successResponse(res, { 
      questions,
      metadata: {
        generatedCount: questions.length,
        planUsed: plan.approach,
        totalObjectives: plan.breakdown.length,
        generationMethod: 'intelligent-rag-llm',
        ragEnabled: generationResult.metadata.ragEnabled,
        courseContext: generationResult.metadata.courseContext,
        materialsUsed: generationResult.metadata.totalMaterials,
        errors: generationResult.errors
      }
    }, 'Questions generated successfully using RAG + LLM', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('❌ Question generation error:', error);
    console.error('📍 Error stack:', error.stack);
    
    console.log('🔄 Attempting fallback to template-based generation...');
    
    try {
      // Fallback to template-based generation
      const questions = [];
      let questionOrder = 0;

      for (const breakdownItem of plan.breakdown) {
        const learningObjective = breakdownItem.learningObjective;
        
        for (const questionType of breakdownItem.questionTypes) {
          for (let i = 0; i < questionType.count; i++) {
            console.log(`📝 Generating template question ${questionOrder + 1} (${questionType.type})`);
            
            const question = await generateQuestion(
              quizId, 
              learningObjective._id || learningObjective, 
              questionType.type, 
              plan._id, 
              questionOrder, 
              userId
            );
            
            questions.push(question);
            await quiz.addQuestion(question._id);
            questionOrder++;
          }
        }
      }

      console.log(`✅ Fallback generation completed: ${questions.length} template questions created`);

      // Mark plan as used
      await plan.markAsUsed();

      // Update user stats
      if (req.user.fullUser) {
        await req.user.fullUser.incrementStats('questionsCreated');
      }

      // Add generation record
      await quiz.addGenerationRecord({
        approach: plan.approach,
        questionsGenerated: questions.length,
        processingTime: 3000,
        llmModel: 'template-based',
        generationMethod: 'template-fallback',
        success: true,
        errorMessage: `Intelligent generation failed: ${error.message}`
      });

      return successResponse(res, { 
        questions,
        metadata: {
          generatedCount: questions.length,
          planUsed: plan.approach,
          totalObjectives: plan.breakdown.length,
          generationMethod: 'template-fallback',
          ragEnabled: false,
          courseContext: 'fallback generation',
          materialsUsed: 0,
          fallbackReason: error.message
        }
      }, 'Questions generated using template fallback', HTTP_STATUS.CREATED);

    } catch (fallbackError) {
      console.error('❌ Fallback generation also failed:', fallbackError);
      
      // Add failed generation record
      await quiz.addGenerationRecord({
        approach: plan.approach,
        questionsGenerated: 0,
        processingTime: 2000,
        llmModel: 'llama3.1:8b',
        success: false,
        errorMessage: `Both intelligent and fallback generation failed: ${error.message} | ${fallbackError.message}`
      });

      return errorResponse(res, `Failed to generate questions: ${error.message}`, 'QUESTION_GENERATION_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
  }
}));

/**
 * POST /api/questions
 * Create manual question
 */
router.post('/', authenticateToken, validateCreateQuestion, asyncHandler(async (req, res) => {
  const { quizId, learningObjectiveId, type, difficulty, questionText, content, correctAnswer, explanation } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify learning objective exists and belongs to quiz
  const objective = await LearningObjective.findOne({ 
    _id: learningObjectiveId, 
    quiz: quizId 
  });
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  // Get next order number
  const lastQuestion = await Question.findOne({ quiz: quizId }).sort({ order: -1 });
  const order = lastQuestion ? lastQuestion.order + 1 : 0;

  const question = new Question({
    quiz: quizId,
    learningObjective: learningObjectiveId,
    type,
    difficulty,
    questionText,
    content: content || {},
    correctAnswer,
    explanation,
    order,
    createdBy: userId
  });

  await question.save();
  await quiz.addQuestion(question._id);

  return successResponse(res, { question }, 'Question created successfully', HTTP_STATUS.CREATED);
}));

/**
 * PUT /api/questions/:id
 * Update question
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;
  const updates = req.body;

  const question = await Question.findOne({ _id: questionId, createdBy: userId });
  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  // Track changes for edit history
  const previousData = {
    questionText: question.questionText,
    content: question.content,
    correctAnswer: question.correctAnswer
  };

  // Update allowed fields
  const allowedUpdates = ['questionText', 'content', 'correctAnswer', 'explanation', 'difficulty'];
  allowedUpdates.forEach(field => {
    if (updates[field] !== undefined) {
      question[field] = updates[field];
    }
  });

  // Add to edit history
  await question.addEdit(userId, 'Manual update', previousData);

  return successResponse(res, { question }, 'Question updated successfully');
}));

/**
 * DELETE /api/questions/:id
 * Delete question
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;

  const question = await Question.findOne({ _id: questionId, createdBy: userId });
  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  // Remove from quiz
  const quiz = await Quiz.findById(question.quiz);
  if (quiz) {
    await quiz.removeQuestion(questionId);
  }

  await Question.findByIdAndDelete(questionId);

  return successResponse(res, null, 'Question deleted successfully');
}));

/**
 * POST /api/questions/:id/regenerate
 * Regenerate specific question
 */
router.post('/:id/regenerate', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;

  const question = await Question.findOne({ _id: questionId, createdBy: userId })
    .populate('learningObjective');

  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  try {
    const provider = process.env.LLM_PROVIDER || 'ollama';
    const model = provider === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.OLLAMA_MODEL || 'llama3.1:8b');
    console.log(`🎯 Question regeneration using ${provider} model: ${model}`);
    
    // Import LLM service for regeneration
    const { default: llmService } = await import('../services/llmService.js');
    
    // Generate new question using LLM service with user preferences
    console.log('🔄 Regenerating question with LLM...');
    const questionConfig = {
      learningObjective: question.learningObjective.text,
      questionType: question.type,
      relevantContent: [], // Could be enhanced with RAG content later
      difficulty: 'moderate',
      courseContext: `Question regeneration`,
      previousQuestions: [{ questionText: question.questionText }] // Avoid duplication
    };
    
    const result = await llmService.generateQuestion(questionConfig);
    const newQuestionData = result.questionData;

    // Debug logging for Summary regeneration
    if (question.type === 'summary') {
      console.log('🔄 REGENERATION: Summary question data received:');
      console.log('📋 New question data:', JSON.stringify(newQuestionData, null, 2));
      console.log('📝 Content field:', JSON.stringify(newQuestionData.content, null, 2));
      console.log('🔑 Has keyPoints:', !!newQuestionData.content?.keyPoints);
    }

    // Store previous version
    const previousData = {
      questionText: question.questionText,
      content: question.content,
      correctAnswer: question.correctAnswer
    };

    // Update question - use formatContentForDatabase for proper structure
    question.questionText = newQuestionData.questionText;
    question.content = formatContentForDatabase(newQuestionData, question.type);
    question.correctAnswer = newQuestionData.correctAnswer;
    question.explanation = newQuestionData.explanation;
    
    // Update generation metadata
    question.generationMetadata = {
      ...question.generationMetadata,
      ...newQuestionData.generationMetadata,
      regeneratedAt: new Date(),
      regenerationMethod: 'llm-regeneration'
    };

    // Add to edit history
    await question.addEdit(userId, 'AI regeneration with LLM', previousData);

    return successResponse(res, { question }, 'Question regenerated successfully');

  } catch (error) {
    console.error('Question regeneration error:', error);
    return errorResponse(res, 'Failed to regenerate question', 'REGENERATION_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * PUT /api/questions/reorder
 * Reorder questions
 */
router.put('/reorder', authenticateToken, validateReorderQuestions, asyncHandler(async (req, res) => {
  const { quizId, questionIds } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify all questions belong to this quiz and user
  const questions = await Question.find({ 
    _id: { $in: questionIds },
    quiz: quizId,
    createdBy: userId 
  });

  if (questions.length !== questionIds.length) {
    return errorResponse(
      res, 
      'Some questions not found or not owned by user', 
      'INVALID_QUESTIONS', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Update order
  await Question.reorderQuestions(quizId, questionIds);

  const reorderedQuestions = await Question.find({ quiz: quizId })
    .populate('learningObjective', 'text')
    .sort({ order: 1 });

  return successResponse(res, { questions: reorderedQuestions }, 'Questions reordered successfully');
}));

/**
 * PUT /api/questions/:id/review
 * Update question review status
 */
router.put('/:id/review', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;
  const { status } = req.body;

  if (!Object.values(REVIEW_STATUS).includes(status)) {
    return errorResponse(res, 'Invalid review status', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  const question = await Question.findOne({ _id: questionId, createdBy: userId });
  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  await question.markAsReviewed(status);

  return successResponse(res, { question }, 'Question review status updated');
}));

/**
 * GET /api/questions/test-pipeline/:quizId
 * Test RAG + LLM pipeline for quiz
 */
router.get('/test-pipeline/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    console.log('🧪 Testing RAG + LLM pipeline for quiz:', quizId);
    
    const testResult = await intelligentQuestionGenerationService.testPipeline(quizId);
    
    if (testResult.success) {
      return successResponse(res, testResult, 'Pipeline test completed successfully');
    } else {
      return errorResponse(res, `Pipeline test failed: ${testResult.error}`, 'PIPELINE_TEST_FAILED', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
    
  } catch (error) {
    console.error('❌ Pipeline test error:', error);
    return errorResponse(res, `Pipeline test failed: ${error.message}`, 'PIPELINE_TEST_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * DELETE /api/questions/quiz/:quizId
 * Delete all questions for a quiz (before regeneration)
 */
router.delete('/quiz/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    console.log(`🗑️ Deleting all questions for quiz ${quizId}...`);
    
    // Get all questions for this quiz
    const questions = await Question.find({ quiz: quizId, createdBy: userId });
    const questionCount = questions.length;
    
    if (questionCount === 0) {
      return successResponse(res, { deletedCount: 0 }, 'No questions to delete');
    }
    
    // Delete all questions
    await Question.deleteMany({ quiz: quizId, createdBy: userId });
    
    // Clear questions array from quiz
    quiz.questions = [];
    await quiz.save();
    
    console.log(`✅ Deleted ${questionCount} questions from quiz ${quizId}`);
    
    // Update folder stats after deleting questions
    const Folder = require('../models/Folder');
    const folder = await Folder.findOne({ quizzes: quizId });
    if (folder) {
      console.log('📊 Updating folder stats after question deletion...');
      await folder.updateStats();
      console.log('✅ Folder stats updated');
    }
    
    return successResponse(res, { 
      deletedCount: questionCount,
      quizId: quizId 
    }, `Successfully deleted ${questionCount} questions`);
    
  } catch (error) {
    console.error('❌ Question deletion error:', error);
    return errorResponse(res, `Failed to delete questions: ${error.message}`, 'DELETION_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * GET /api/questions/generation-stats/:quizId
 * Get generation statistics for quiz
 */
router.get('/generation-stats/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    const stats = await intelligentQuestionGenerationService.getGenerationStats(quizId);
    return successResponse(res, stats, 'Generation statistics retrieved successfully');
    
  } catch (error) {
    console.error('❌ Generation stats error:', error);
    return errorResponse(res, `Failed to get generation stats: ${error.message}`, 'STATS_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

// Helper functions

/**
 * Format LLM-generated question content for database storage
 */
function formatContentForDatabase(generatedQuestion, questionType) {
  console.log(`🔧 Formatting content for ${questionType}:`, {
    hasOptions: !!generatedQuestion.options,
    hasContent: !!generatedQuestion.content,
    hasQuestionText: !!generatedQuestion.questionText
  });
  
  switch (questionType) {
    case 'multiple-choice':
    case 'true-false':
      // Wrap options in content object with proper structure
      return {
        options: generatedQuestion.options || []
      };
    
    case 'flashcard':
      // Use the flashcard content structure
      return generatedQuestion.content || {
        front: generatedQuestion.front || '',
        back: generatedQuestion.back || ''
      };
    
    case 'matching':
      return {
        leftItems: generatedQuestion.leftItems || [],
        rightItems: generatedQuestion.rightItems || [],
        matchingPairs: generatedQuestion.matchingPairs || []
      };
    
    case 'ordering':
      return {
        items: generatedQuestion.items || [],
        correctOrder: generatedQuestion.correctOrder || []
      };
    
    case 'cloze':
      return {
        textWithBlanks: generatedQuestion.content?.textWithBlanks || generatedQuestion.textWithBlanks || generatedQuestion.questionText || '',
        blankOptions: generatedQuestion.content?.blankOptions || generatedQuestion.blankOptions || [],
        correctAnswers: generatedQuestion.content?.correctAnswers || generatedQuestion.correctAnswers || []
      };
    
    case 'summary':
      console.log('🔧 Formatting Summary content for database:');
      console.log('📋 Generated question data keys:', Object.keys(generatedQuestion));
      console.log('📝 generatedQuestion.content:', JSON.stringify(generatedQuestion.content, null, 2));
      console.log('🔍 generatedQuestion.content type:', typeof generatedQuestion.content);
      console.log('🔍 generatedQuestion.content exists:', !!generatedQuestion.content);
      
      // Check if content has keyPoints
      if (generatedQuestion.content && generatedQuestion.content.keyPoints) {
        console.log('✅ Found keyPoints in content:', generatedQuestion.content.keyPoints.length);
        console.log('🔑 First keyPoint:', JSON.stringify(generatedQuestion.content.keyPoints[0], null, 2));
      } else {
        console.log('❌ No keyPoints found in content');
        console.log('🔍 Available fields in generatedQuestion:', Object.keys(generatedQuestion));
      }
      
      const summaryContent = generatedQuestion.content || {};
      console.log('💾 Final content to save:', JSON.stringify(summaryContent, null, 2));
      console.log('💾 Final content keys:', Object.keys(summaryContent));
      return summaryContent;
    
    default:
      // For discussion and other text-based questions
      return generatedQuestion.content || {};
  }
}

async function generateQuestion(quizId, learningObjectiveId, type, planId, order, userId) {
  const objective = await LearningObjective.findById(learningObjectiveId);
  const questionData = await generateQuestionContent(type, objective.text, 'moderate', order);

  const question = new Question({
    quiz: quizId,
    learningObjective: learningObjectiveId,
    generationPlan: planId,
    type,
    difficulty: 'moderate',
    questionText: questionData.questionText,
    content: questionData.content,
    correctAnswer: questionData.correctAnswer,
    explanation: questionData.explanation,
    order,
    generationMetadata: {
      llmModel: 'llama3.1:8b',
      generationPrompt: `Generate ${type} question for: ${objective.text}`,
      templateIndex: order % 4,
      templateUsed: getTemplateDescription(type, order % 4),
      confidence: 0.8,
      processingTime: 1500
    },
    createdBy: userId
  });

  await question.save();
  return question;
}

// New AI-enhanced question generation function
async function generateQuestionWithAIPrompt(quizId, learningObjectiveId, type, planId, order, userId, promptData) {
  console.log('🎯 Generating question with AI prompt:', promptData.subObjective.substring(0, 50) + '...');
  
  const objective = await LearningObjective.findById(learningObjectiveId);
  
  // Use the AI-generated prompt to create question content
  const questionData = await generateQuestionFromPrompt(
    promptData.detailedPrompt,
    type,
    promptData.subObjective
  );

  const question = new Question({
    quiz: quizId,
    learningObjective: learningObjectiveId,
    generationPlan: planId,
    type,
    difficulty: 'moderate',
    questionText: questionData.questionText,
    content: questionData.content,
    correctAnswer: questionData.correctAnswer,
    explanation: questionData.explanation,
    order,
    generationMetadata: {
      llmModel: 'llama3.1:8b',
      generationPrompt: promptData.detailedPrompt,
      subObjective: promptData.subObjective,
      focusArea: promptData.focusArea,
      complexity: promptData.complexity,
      generationMethod: 'AI-enhanced-prompting',
      confidence: 0.9,
      processingTime: 2000
    },
    createdBy: userId
  });

  await question.save();
  return question;
}

async function generateQuestionContent(type, objectiveText, difficulty, questionIndex = 0) {
  // TODO: Implement AI question generation
  // This would call the UBC GenAI Toolkit
  // For now, return varied placeholder content based on question index

  const multipleChoiceTemplates = [
    {
      questionText: `Which of the following best demonstrates understanding of: ${objectiveText}?`,
      options: [
        "Correct understanding and application",
        "Common misconception",
        "Partial understanding",
        "Incorrect approach"
      ]
    },
    {
      questionText: `What is the most important aspect when considering: ${objectiveText}?`,
      options: [
        "Primary principle and core concept",
        "Secondary consideration",
        "Tangential detail",
        "Unrelated factor"
      ]
    },
    {
      questionText: `How would you best apply the concept of: ${objectiveText}?`,
      options: [
        "Proper implementation method",
        "Flawed implementation",
        "Incomplete implementation",
        "Wrong implementation"
      ]
    },
    {
      questionText: `Which statement accurately describes: ${objectiveText}?`,
      options: [
        "Accurate and complete description",
        "Partially correct description",
        "Misleading description",
        "Completely incorrect description"
      ]
    }
  ];

  const trueFalseTemplates = [
    `${objectiveText} is essential for understanding this topic.`,
    `The concept of ${objectiveText} requires careful consideration of multiple factors.`,
    `Understanding ${objectiveText} is fundamental to mastering this subject area.`,
    `${objectiveText} can be applied in various practical scenarios.`
  ];

  const flashcardTemplates = [
    {
      front: `What does this learning objective focus on?`,
      back: objectiveText
    },
    {
      front: `Define the key concept:`,
      back: objectiveText
    },
    {
      front: `What should students understand about:`,
      back: objectiveText
    }
  ];

  // Use questionIndex to vary the templates
  const templateIndex = questionIndex % 4;
  
  const templates = {
    [QUESTION_TYPES.MULTIPLE_CHOICE]: {
      questionText: multipleChoiceTemplates[templateIndex].questionText,
      content: {
        options: multipleChoiceTemplates[templateIndex].options.map((text, index) => ({
          text,
          isCorrect: index === 0,
          order: index
        }))
      },
      correctAnswer: multipleChoiceTemplates[templateIndex].options[0],
      explanation: `This option correctly demonstrates the key concept related to ${objectiveText}.`
    },
    [QUESTION_TYPES.TRUE_FALSE]: {
      questionText: `True or False: ${trueFalseTemplates[templateIndex]}`,
      content: {
        options: [
          { text: "True", isCorrect: true, order: 0 },
          { text: "False", isCorrect: false, order: 1 }
        ]
      },
      correctAnswer: "True",
      explanation: `This statement is true because it accurately reflects the learning objective: ${objectiveText}.`
    },
    [QUESTION_TYPES.FLASHCARD]: {
      questionText: "Review this concept",
      content: flashcardTemplates[templateIndex % flashcardTemplates.length],
      correctAnswer: objectiveText,
      explanation: `This flashcard helps reinforce understanding of: ${objectiveText}.`
    }
  };

  return templates[type] || templates[QUESTION_TYPES.MULTIPLE_CHOICE];
}

// Helper function to get template description
function getTemplateDescription(type, templateIndex) {
  const descriptions = {
    [QUESTION_TYPES.MULTIPLE_CHOICE]: [
      "Understanding demonstration template",
      "Important aspect identification template", 
      "Concept application template",
      "Accurate description template"
    ],
    [QUESTION_TYPES.TRUE_FALSE]: [
      "Essential knowledge template",
      "Multi-factor consideration template",
      "Fundamental understanding template", 
      "Practical application template"
    ],
    [QUESTION_TYPES.FLASHCARD]: [
      "Learning objective focus template",
      "Key concept definition template",
      "Student understanding template"
    ]
  };
  
  return descriptions[type]?.[templateIndex] || `Template ${templateIndex + 1}`;
}

export default router;