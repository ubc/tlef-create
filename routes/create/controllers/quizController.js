import express from 'express';
import Quiz from '../models/Quiz.js';
import Folder from '../models/Folder.js';
import Material from '../models/Material.js';
import LearningObjective from '../models/LearningObjective.js';
import Question from '../models/Question.js';
import GenerationPlan from '../models/GenerationPlan.js';
import { authenticateToken, attachUser } from '../middleware/auth.js';
import { validateCreateQuiz, validateUpdateQuiz, validateAssignMaterials, validateMongoId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, QUIZ_STATUS } from '../config/constants.js';

const router = express.Router();

/**
 * GET /api/quizzes/folder/:folderId
 * Get folder's quizzes
 */
router.get('/folder/:folderId', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const folderId = req.params.folderId;
  const userId = req.user.id;

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  const quizzes = await Quiz.find({ folder: folderId })
    .populate('materials', 'name type processingStatus')
    .populate('learningObjectives', 'text order')
    .populate('activePlan', 'approach totalQuestions status')
    .sort({ updatedAt: -1 });

  return successResponse(res, { quizzes }, 'Quizzes retrieved successfully');
}));

/**
 * POST /api/quizzes
 * Create quiz
 */
router.post('/', authenticateToken, attachUser, validateCreateQuiz, asyncHandler(async (req, res) => {
  const { name, folderId } = req.body;
  const userId = req.user.id;

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  // Check for duplicate quiz name in folder
  const existingQuiz = await Quiz.findOne({ 
    folder: folderId, 
    name: name.trim() 
  });

  if (existingQuiz) {
    return errorResponse(
      res, 
      'A quiz with this name already exists in the folder', 
      'DUPLICATE_QUIZ', 
      HTTP_STATUS.CONFLICT
    );
  }

  const quiz = new Quiz({
    name: name.trim(),
    folder: folderId,
    createdBy: userId
  });

  await quiz.save();

  // Add quiz to folder
  await folder.addQuiz(quiz._id);

  // Update user stats
  if (req.user.fullUser) {
    await req.user.fullUser.incrementStats('quizzesGenerated');
  }

  return successResponse(res, { quiz }, 'Quiz created successfully', HTTP_STATUS.CREATED);
}));

/**
 * GET /api/quizzes/:id
 * Get quiz details
 */
router.get('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate({
      path: 'materials',
      select: 'name type processingStatus fileSize createdAt'
    })
    .populate({
      path: 'learningObjectives',
      select: 'text order generationMetadata createdAt',
      options: { sort: { order: 1 } }
    })
    .populate({
      path: 'questions',
      select: 'type difficulty questionText reviewStatus order createdAt',
      options: { sort: { order: 1 } }
    })
    .populate({
      path: 'generationPlans',
      select: 'approach totalQuestions status createdAt',
      options: { sort: { createdAt: -1 } }
    })
    .populate('activePlan');

  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  return successResponse(res, { quiz }, 'Quiz retrieved successfully');
}));

/**
 * PUT /api/quizzes/:id
 * Update quiz basic info
 */
router.put('/:id', authenticateToken, validateUpdateQuiz, asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const userId = req.user.id;
  const updates = req.body;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Check for duplicate name if updating name
  if (updates.name && updates.name.trim() !== quiz.name) {
    const existingQuiz = await Quiz.findOne({ 
      folder: quiz.folder, 
      name: updates.name.trim(),
      _id: { $ne: quizId }
    });

    if (existingQuiz) {
      return errorResponse(
        res, 
        'A quiz with this name already exists in the folder', 
        'DUPLICATE_QUIZ', 
        HTTP_STATUS.CONFLICT
      );
    }
  }

  // Update allowed fields
  const allowedUpdates = ['name', 'settings'];
  allowedUpdates.forEach(field => {
    if (updates[field] !== undefined) {
      if (field === 'name') {
        quiz[field] = updates[field].trim();
      } else if (field === 'settings') {
        quiz.settings = { ...quiz.settings, ...updates.settings };
      }
    }
  });

  await quiz.save();

  return successResponse(res, { quiz }, 'Quiz updated successfully');
}));

/**
 * DELETE /api/quizzes/:id
 * Delete quiz
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Remove from folder
  const folder = await Folder.findById(quiz.folder);
  if (folder) {
    await folder.removeQuiz(quizId);
  }

  // Delete associated data
  const [LearningObjective, Question, GenerationPlan] = await Promise.all([
    import('../models/LearningObjective.js').then(m => m.default),
    import('../models/Question.js').then(m => m.default),
    import('../models/GenerationPlan.js').then(m => m.default)
  ]);

  await Promise.all([
    LearningObjective.deleteMany({ quiz: quizId }),
    Question.deleteMany({ quiz: quizId }),
    GenerationPlan.deleteMany({ quiz: quizId })
  ]);

  // Delete quiz
  await Quiz.findByIdAndDelete(quizId);

  return successResponse(res, null, 'Quiz deleted successfully');
}));

/**
 * PUT /api/quizzes/:id/materials
 * Assign materials to quiz
 */
router.put('/:id/materials', authenticateToken, validateAssignMaterials, asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const { materialIds } = req.body;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify all materials exist and belong to the same folder
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

  // Update quiz materials
  quiz.materials = materialIds;
  await quiz.updateProgress();

  // Update usage tracking for materials
  await Material.updateMany(
    { _id: { $in: materialIds } },
    { $inc: { timesUsedInQuiz: 1 }, lastUsed: new Date() }
  );

  const updatedQuiz = await Quiz.findById(quizId)
    .populate('materials', 'name type processingStatus');

  return successResponse(res, { quiz: updatedQuiz }, 'Materials assigned successfully');
}));

/**
 * GET /api/quizzes/:id/progress
 * Get quiz progress
 */
router.get('/:id/progress', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .select('progress status createdAt updatedAt');

  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Calculate detailed progress
  const [materialCount, objectiveCount, planCount, questionCount] = await Promise.all([
    Material.countDocuments({ _id: { $in: quiz.materials || [] } }),
    (await import('../models/LearningObjective.js')).default.countDocuments({ quiz: quizId }),
    (await import('../models/GenerationPlan.js')).default.countDocuments({ quiz: quizId }),
    (await import('../models/Question.js')).default.countDocuments({ quiz: quizId })
  ]);

  const progress = {
    status: quiz.status,
    progress: quiz.progress,
    counts: {
      materials: materialCount,
      objectives: objectiveCount,
      plans: planCount,
      questions: questionCount
    },
    timestamps: {
      created: quiz.createdAt,
      lastUpdated: quiz.updatedAt
    }
  };

  return successResponse(res, { progress }, 'Quiz progress retrieved');
}));

/**
 * POST /api/quizzes/:id/duplicate
 * Duplicate quiz
 */
router.post('/:id/duplicate', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const userId = req.user.id;
  const { name } = req.body;

  const originalQuiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate('learningObjectives')
    .populate('questions');

  if (!originalQuiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const newName = name || `${originalQuiz.name} (Copy)`;

  // Check for duplicate name
  const existingQuiz = await Quiz.findOne({ 
    folder: originalQuiz.folder, 
    name: newName 
  });

  if (existingQuiz) {
    return errorResponse(
      res, 
      'A quiz with this name already exists', 
      'DUPLICATE_QUIZ', 
      HTTP_STATUS.CONFLICT
    );
  }

  // Create new quiz
  const newQuiz = new Quiz({
    name: newName,
    folder: originalQuiz.folder,
    materials: originalQuiz.materials,
    settings: originalQuiz.settings,
    createdBy: userId
  });

  await newQuiz.save();

  // Add to folder
  const folder = await Folder.findById(originalQuiz.folder);
  if (folder) {
    await folder.addQuiz(newQuiz._id);
  }

  return successResponse(res, { quiz: newQuiz }, 'Quiz duplicated successfully', HTTP_STATUS.CREATED);
}));

export default router;