import express from 'express';
import Question from '../models/Question.js';
import Quiz from '../models/Quiz.js';
import LearningObjective from '../models/LearningObjective.js';
import Folder from '../models/Folder.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateCreateQuestion, validateReorderQuestions, validateMongoId, validateQuizId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, REVIEW_STATUS } from '../config/constants.js';
import { formatContentForDatabase } from '../services/questionContentService.js';

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

  return successResponse(res, { questions }, 'Questions retrieved successfully');
}));

/**
 * POST /api/questions/generate-from-plan
 * DEPRECATED: Use /api/create/streaming/generate-questions instead
 */
router.post('/generate-from-plan', authenticateToken, asyncHandler(async (req, res) => {
  return errorResponse(
    res,
    'This endpoint is deprecated. Please use /api/create/streaming/generate-questions for real-time streaming generation.',
    'DEPRECATED_ENDPOINT',
    HTTP_STATUS.GONE
  );
}));

/**
 * POST /api/questions/generate-from-plan-stream
 * DEPRECATED: Use /api/create/streaming/generate-questions instead
 */
router.post('/generate-from-plan-stream', authenticateToken, asyncHandler(async (req, res) => {
  return errorResponse(
    res,
    'This endpoint is deprecated. Please use /api/create/streaming/generate-questions for real-time streaming generation.',
    'DEPRECATED_ENDPOINT',
    HTTP_STATUS.GONE
  );
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
 * PUT /api/questions/reorder
 * Reorder questions
 * NOTE: Must be registered before /:id routes to avoid matching "reorder" as :id
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
 * Regenerate specific question using LLM
 */
router.post('/:id/regenerate', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;
  const { customPrompt } = req.body;

  const question = await Question.findOne({ _id: questionId, createdBy: userId })
    .populate('learningObjective');

  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  try {
    const { default: llmService } = await import('../services/llmService.js');

    const questionConfig = {
      learningObjective: question.learningObjective?.text || 'General knowledge assessment',
      questionType: question.type,
      relevantContent: [],
      difficulty: 'moderate',
      courseContext: customPrompt ? `Question regeneration with custom instructions: ${customPrompt}` : `Question regeneration`,
      previousQuestions: [{ questionText: question.questionText }],
      customPrompt: customPrompt || undefined
    };

    const result = await llmService.generateQuestion(questionConfig);
    const newQuestionData = result.questionData;

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
 * GET /api/questions/test-pipeline/:quizId
 * Test RAG + LLM pipeline for quiz
 */
router.get('/test-pipeline/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    const testResult = await intelligentQuestionGenerationService.testPipeline(quizId);

    if (testResult.success) {
      return successResponse(res, testResult, 'Pipeline test completed successfully');
    } else {
      return errorResponse(res, `Pipeline test failed: ${testResult.error}`, 'PIPELINE_TEST_FAILED', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }

  } catch (error) {
    console.error('Pipeline test error:', error);
    return errorResponse(res, `Pipeline test failed: ${error.message}`, 'PIPELINE_TEST_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * DELETE /api/questions/quiz/:quizId
 * Delete all questions for a quiz
 */
router.delete('/quiz/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    const questions = await Question.find({ quiz: quizId, createdBy: userId });
    const questionCount = questions.length;

    if (questionCount === 0) {
      return successResponse(res, { deletedCount: 0 }, 'No questions to delete');
    }

    await Question.deleteMany({ quiz: quizId, createdBy: userId });

    quiz.questions = [];
    await quiz.save();

    // Update folder stats after deleting questions
    const folder = await Folder.findOne({ quizzes: quizId });
    if (folder) {
      await folder.updateStats();
    }

    return successResponse(res, {
      deletedCount: questionCount,
      quizId: quizId
    }, `Successfully deleted ${questionCount} questions`);

  } catch (error) {
    console.error('Question deletion error:', error);
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

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    const stats = await intelligentQuestionGenerationService.getGenerationStats(quizId);
    return successResponse(res, stats, 'Generation statistics retrieved successfully');

  } catch (error) {
    console.error('Generation stats error:', error);
    return errorResponse(res, `Failed to get generation stats: ${error.message}`, 'STATS_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

export default router;
