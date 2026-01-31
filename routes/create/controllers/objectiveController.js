import express from 'express';
import LearningObjective from '../models/LearningObjective.js';
import Quiz from '../models/Quiz.js';
import Material from '../models/Material.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateCreateObjective, validateGenerateObjectives, validateClassifyObjectives, validateMongoId, validateQuizId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';
import llmService from '../services/llmService.js';

const router = express.Router();

/**
 * GET /api/objectives/quiz/:quizId
 * Get quiz objectives
 */
router.get('/quiz/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const objectives = await LearningObjective.find({ quiz: quizId })
    .populate('generatedFrom', 'name type')
    .populate('createdBy', 'cwlId')
    .sort({ order: 1 });

  return successResponse(res, { objectives }, 'Learning objectives retrieved successfully');
}));

/**
 * POST /api/objectives/generate
 * AI generate from materials
 */
router.post('/generate', authenticateToken, validateGenerateObjectives, asyncHandler(async (req, res) => {
  const { quizId, materialIds, targetCount } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify materials exist and are in the same folder
  const materials = await Material.find({ 
    _id: { $in: materialIds },
    folder: quiz.folder 
  });

  if (materials.length !== materialIds.length) {
    return errorResponse(
      res, 
      'Some materials not found or not in the same folder', 
      'INVALID_MATERIALS', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Check if materials are processed
  const unprocessedMaterials = materials.filter(m => m.processingStatus !== 'completed');
  if (unprocessedMaterials.length > 0) {
    return errorResponse(
      res, 
      'Some materials are not yet processed. Please wait for processing to complete.', 
      'MATERIALS_NOT_READY', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  try {
    const startTime = Date.now();
    
    // Get user preferences for AI model selection
    const { default: User } = await import('../models/User.js');
    const user = await User.findById(userId).select('preferences');
    const userPreferences = user?.preferences || null;
    
    if (userPreferences?.llmProvider) {
      console.log(`🎯 Objectives generation using: ${userPreferences.llmProvider} (${userPreferences.llmModel || 'default'})`);
    } else {
      console.log('🎯 Objectives generation using default LLM configuration');
    }
    
    // Generate learning objectives using user's preferred LLM
    const generatedObjectives = await llmService.generateLearningObjectives(
      materials,
      `Quiz: ${quiz.name}`, // Add context about the quiz
      targetCount, // Pass target count if provided
      userPreferences // Pass user preferences
    );
    
    const processingTime = Date.now() - startTime;

    const objectives = [];
    for (let i = 0; i < generatedObjectives.length; i++) {
      const objective = new LearningObjective({
        text: generatedObjectives[i],
        quiz: quizId,
        order: i,
        generatedFrom: materialIds,
        generationMetadata: {
          isAIGenerated: true,
          llmModel: userPreferences?.llmModel || 'llama3.1:8b',
          generationPrompt: 'Generate learning objectives from provided materials',
          confidence: 0.85,
          processingTime: processingTime
        },
        createdBy: userId
      });

      await objective.save();
      objectives.push(objective);

      // Add to quiz
      await quiz.addLearningObjective(objective._id);
    }

    return successResponse(res, { 
      objectives,
      metadata: {
        generatedCount: objectives.length,
        materialsUsed: materials.length,
        generationModel: userPreferences?.llmModel || 'llama3.1:8b'
      }
    }, 'Learning objectives generated successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('AI generation error:', error);
    return errorResponse(
      res, 
      'Failed to generate learning objectives', 
      'AI_GENERATION_ERROR', 
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

/**
 * POST /api/objectives/classify
 * AI classify user text into LOs
 */
router.post('/classify', authenticateToken, validateClassifyObjectives, asyncHandler(async (req, res) => {
  const { quizId, text } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    const startTime = Date.now();
    
    // Get user preferences for AI model selection
    const { default: User } = await import('../models/User.js');
    const user = await User.findById(userId).select('preferences');
    const userPreferences = user?.preferences || null;
    
    if (userPreferences?.llmProvider) {
      console.log(`🎯 Objectives classification using: ${userPreferences.llmProvider} (${userPreferences.llmModel || 'default'})`);
    } else {
      console.log('🎯 Objectives classification using default LLM configuration');
    }
    
    // Classify learning objectives using user's preferred LLM
    const classifiedObjectives = await llmService.classifyLearningObjectives(text, userPreferences);
    
    const processingTime = Date.now() - startTime;

    if (classifiedObjectives.length === 0) {
      return errorResponse(
        res, 
        'No learning objectives could be identified in the provided text', 
        'NO_OBJECTIVES_FOUND', 
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const objectives = [];
    for (let i = 0; i < classifiedObjectives.length; i++) {
      const objective = new LearningObjective({
        text: classifiedObjectives[i],
        quiz: quizId,
        order: i,
        generationMetadata: {
          isAIGenerated: true,
          llmModel: userPreferences?.llmModel || 'llama3.1:8b',
          generationPrompt: 'Classify text into learning objectives',
          confidence: 0.75,
          processingTime: processingTime
        },
        createdBy: userId
      });

      await objective.save();
      objectives.push(objective);

      // Add to quiz
      await quiz.addLearningObjective(objective._id);
    }

    return successResponse(res, { 
      objectives,
      metadata: {
        originalText: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        classifiedCount: objectives.length,
        processingTime: processingTime,
        llmModel: userPreferences?.llmModel || 'llama3.1:8b'
      }
    }, 'Text classified into learning objectives successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('Classification error:', error);
    return errorResponse(
      res, 
      'Failed to classify text into learning objectives', 
      'AI_CLASSIFICATION_ERROR', 
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

/**
 * POST /api/objectives
 * Add single LO or save batch
 */
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Handle batch creation/replacement
  if (Array.isArray(req.body)) {
    const objectivesData = req.body;
    const objectives = [];
    const errors = [];

    // Handle empty array (delete all)
    if (objectivesData.length === 0) {
      return errorResponse(res, 'Cannot determine quiz ID from empty objectives array. Use DELETE endpoint or provide quizId.', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
    }

    // Get the quizId from the first objective (all should have the same quizId)
    const quizId = objectivesData[0]?.quizId;
    if (!quizId) {
      return errorResponse(res, 'QuizId is required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
    }

    // Verify quiz exists and user owns it
    const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
    if (!quiz) {
      return notFoundResponse(res, 'Quiz');
    }

    // DELETE ALL EXISTING OBJECTIVES FOR THIS QUIZ FIRST
    await LearningObjective.deleteMany({ quiz: quizId });
    // Clear learning objectives from quiz
    quiz.learningObjectives = [];
    await quiz.save();

    for (const objData of objectivesData) {
      try {
        if (!objData.text || !objData.quizId) {
          errors.push({ data: objData, error: 'Text and quizId are required' });
          continue;
        }

        const objective = new LearningObjective({
          text: objData.text.trim(),
          quiz: objData.quizId,
          order: objData.order || objectives.length,
          createdBy: userId
        });

        await objective.save();
        await quiz.addLearningObjective(objective._id);
        objectives.push(objective);

      } catch (error) {
        errors.push({ data: objData, error: error.message });
      }
    }

    const response = {
      objectives,
      summary: {
        total: objectivesData.length,
        successful: objectives.length,
        failed: errors.length
      }
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    const statusCode = objectives.length > 0 ? HTTP_STATUS.CREATED : HTTP_STATUS.BAD_REQUEST;
    const message = objectives.length > 0 ? 
      `${objectives.length} learning objectives created successfully` : 
      'No learning objectives were created';

    return successResponse(res, response, message, statusCode);
  }

  // Handle single creation
  const { text, quizId, order } = req.body;

  if (!text || !quizId) {
    return errorResponse(res, 'Text and quizId are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const objective = new LearningObjective({
    text: text.trim(),
    quiz: quizId,
    order: order || 0,
    createdBy: userId
  });

  await objective.save();
  await quiz.addLearningObjective(objective._id);

  return successResponse(res, { objective }, 'Learning objective created successfully', HTTP_STATUS.CREATED);
}));

/**
 * PUT /api/objectives/:id
 * Update objective
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const objectiveId = req.params.id;
  const userId = req.user.id;
  const { text, order } = req.body;

  const objective = await LearningObjective.findOne({ _id: objectiveId, createdBy: userId });
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  if (text && text.trim() !== objective.text) {
    await objective.updateText(text.trim(), userId);
  }

  if (order !== undefined && order !== objective.order) {
    await objective.reorder(order);
  }

  return successResponse(res, { objective }, 'Learning objective updated successfully');
}));

/**
 * PUT /api/objectives/reorder
 * Reorder objectives
 */
router.put('/reorder', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, objectiveIds } = req.body;
  const userId = req.user.id;

  if (!quizId || !Array.isArray(objectiveIds)) {
    return errorResponse(res, 'QuizId and objectiveIds array are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify all objectives belong to this quiz and user
  const objectives = await LearningObjective.find({ 
    _id: { $in: objectiveIds },
    quiz: quizId,
    createdBy: userId 
  });

  if (objectives.length !== objectiveIds.length) {
    return errorResponse(
      res, 
      'Some objectives not found or not owned by user', 
      'INVALID_OBJECTIVES', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Update order
  await LearningObjective.reorderObjectives(quizId, objectiveIds);

  const reorderedObjectives = await LearningObjective.find({ quiz: quizId })
    .sort({ order: 1 });

  return successResponse(res, { objectives: reorderedObjectives }, 'Learning objectives reordered successfully');
}));

/**
 * DELETE /api/objectives/quiz/:quizId/all
 * Delete all learning objectives for a quiz
 */
router.delete('/quiz/:quizId/all', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  console.log('🟢 Backend DELETE /quiz/:quizId/all called');
  console.log('🟢 quizId:', quizId);
  console.log('🟢 userId:', userId);
  console.log('🟢 req.params:', req.params);

  // Verify quiz exists and user owns it
  console.log('🟢 Looking for quiz with _id:', quizId, 'createdBy:', userId);
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  console.log('🟢 Found quiz:', quiz ? 'YES' : 'NO');
  
  if (!quiz) {
    console.log('🟢 Quiz not found, returning 404');
    return notFoundResponse(res, 'Quiz');
  }

  try {
    console.log('🟢 Deleting objectives for quiz:', quizId);
    
    // Delete all objectives for this quiz
    const result = await LearningObjective.deleteMany({ quiz: quizId });
    console.log('🟢 Delete result:', result);
    
    // Clear learning objectives from quiz
    console.log('🟢 Clearing quiz.learningObjectives array');
    quiz.learningObjectives = [];
    await quiz.save();
    console.log('🟢 Quiz saved successfully');

    const responseData = { 
      deletedCount: result.deletedCount,
      quizId: quizId 
    };
    console.log('🟢 Sending success response:', responseData);

    return successResponse(res, responseData, `${result.deletedCount} learning objectives deleted successfully`);

  } catch (error) {
    console.error('🟢 Delete all objectives error:', error);
    return errorResponse(
      res, 
      'Failed to delete learning objectives', 
      'DELETE_ERROR', 
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
}));

/**
 * DELETE /api/objectives/:id
 * Delete objective
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const objectiveId = req.params.id;
  const userId = req.user.id;
  const { confirmed } = req.query;

  const objective = await LearningObjective.findOne({ _id: objectiveId, createdBy: userId });
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  // Check how many questions will be deleted
  const Question = (await import('../models/Question.js')).default;
  const questionCount = await Question.countDocuments({ learningObjective: objectiveId });

  // If there are questions and user hasn't confirmed, return warning
  if (questionCount > 0 && confirmed !== 'true') {
    return successResponse(res, {
      requiresConfirmation: true,
      questionCount,
      objectiveId,
      message: `This Learning Objective has ${questionCount} question(s). Deleting it will also delete all these questions.`
    }, 'Confirmation required');
  }

  // Get all question IDs before deleting
  const questions = await Question.find({ learningObjective: objectiveId }).select('_id');
  const questionIds = questions.map(q => q._id);

  // Remove from quiz
  const quiz = await Quiz.findById(objective.quiz);
  if (quiz) {
    // Remove all questions from quiz.questions array
    for (const questionId of questionIds) {
      await quiz.removeQuestion(questionId);
    }
    await quiz.removeLearningObjective(objectiveId);
  }

  // Delete associated questions from database
  await Question.deleteMany({ learningObjective: objectiveId });

  // Delete objective
  await LearningObjective.findByIdAndDelete(objectiveId);

  return successResponse(res, {
    deletedQuestions: questionCount
  }, `Learning objective and ${questionCount} question(s) deleted successfully`);
}));

/**
 * POST /api/objectives/:id/regenerate
 * Regenerate a single learning objective
 */
router.post('/:id/regenerate', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const objectiveId = req.params.id;
  const userId = req.user.id;
  const { customPrompt } = req.body; // Get custom prompt from request body

  // Find the objective and verify user owns it
  const objective = await LearningObjective.findById(objectiveId).populate('quiz');
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  if (objective.quiz.createdBy.toString() !== userId) {
    return errorResponse(res, 'Not authorized to regenerate this objective', 'UNAUTHORIZED', HTTP_STATUS.FORBIDDEN);
  }

  // Get materials assigned to the quiz
  const materials = await Material.find({ 
    _id: { $in: objective.quiz.materials },
    processingStatus: 'completed'
  });

  if (materials.length === 0) {
    return errorResponse(
      res, 
      'No processed materials found for this quiz. Please assign and process materials first.', 
      'NO_MATERIALS', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  try {
    const startTime = Date.now();
    
    // Get user preferences for AI model selection
    const { default: User } = await import('../models/User.js');
    const user = await User.findById(userId).select('preferences');
    const userPreferences = user?.preferences || null;
    
    if (userPreferences?.llmProvider) {
      console.log(`🎯 Objective regeneration using: ${userPreferences.llmProvider} (${userPreferences.llmModel || 'default'})`);
    } else {
      console.log('🎯 Objective regeneration using default LLM configuration');
    }
    
    // Regenerate the single objective using user's preferred LLM
    const regeneratedText = await llmService.regenerateSingleObjective(
      objective.text,
      materials,
      `Quiz: ${objective.quiz.name}`,
      userPreferences,
      customPrompt // Pass custom prompt to LLM service
    );
    
    const processingTime = Date.now() - startTime;

    // Update the objective
    objective.text = regeneratedText;
    objective.generationMetadata = {
      ...objective.generationMetadata,
      isAIGenerated: true,
      llmModel: userPreferences?.llmModel || 'llama3.1:8b',
      generationPrompt: 'Regenerate single learning objective',
      confidence: 0.8,
      processingTime: processingTime
    };

    await objective.save();

    return successResponse(res, { 
      objective,
      metadata: {
        originalText: req.body.originalText || 'N/A',
        regeneratedText: regeneratedText,
        processingTime: processingTime,
        materialsUsed: materials.length,
        llmModel: userPreferences?.llmModel || 'llama3.1:8b'
      }
    }, 'Learning objective regenerated successfully');

  } catch (error) {
    console.error('Single objective regeneration error:', error);
    return errorResponse(
      res, 
      'Failed to regenerate learning objective', 
      'AI_REGENERATION_ERROR', 
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

export default router;