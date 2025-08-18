import express from 'express';
import Folder from '../models/Folder.js';
import { authenticateToken, attachUser } from '../middleware/auth.js';
import { validateCreateFolder, validateUpdateFolder, validateMongoId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse, forbiddenResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';

const router = express.Router();

/**
 * GET /api/folders
 * Get user's folders
 */
router.get('/', authenticateToken, attachUser, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  console.log('🔍 GET /folders - User ID:', userId);

  const folders = await Folder.find({ instructor: userId })
    .populate('quizzes', 'name status questions createdAt')
    .sort({ updatedAt: -1 });

  console.log('📁 Found folders for user:', folders.length);
  console.log('📋 Folder details:', folders);

  return successResponse(res, { folders }, 'Folders retrieved successfully');
}));

/**
 * POST /api/folders
 * Create new folder with auto-generated quizzes
 */
router.post('/', authenticateToken, validateCreateFolder, asyncHandler(async (req, res) => {
  const { name, quizCount = 1 } = req.body;
  const userId = req.user.id;
  console.log('➕ POST /folders - Creating folder:', name, 'with', quizCount, 'quizzes for user:', userId);

  // Check if folder with same name already exists for this user
  const existingFolder = await Folder.findOne({ 
    instructor: userId, 
    name: name.trim() 
  });

  if (existingFolder) {
    console.log('❌ Duplicate folder name:', name);
    return errorResponse(
      res, 
      'A folder with this name already exists', 
      'DUPLICATE_FOLDER', 
      HTTP_STATUS.CONFLICT
    );
  }

  // Validate quiz count
  if (quizCount < 1 || quizCount > 20) {
    return errorResponse(
      res, 
      'Quiz count must be between 1 and 20', 
      'INVALID_QUIZ_COUNT', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  const folder = new Folder({
    name: name.trim(),
    instructor: userId
  });

  await folder.save();
  console.log('✅ Folder saved to database:', folder);

  // Auto-generate numbered quizzes
  const Quiz = (await import('../models/Quiz.js')).default;
  const quizzes = [];
  
  for (let i = 1; i <= quizCount; i++) {
    const quiz = new Quiz({
      name: `Quiz ${i}`,
      folder: folder._id,
      createdBy: userId,
      status: 'draft',
      settings: {
        pedagogicalApproach: 'support',
        questionsPerObjective: 3,
        questionTypes: [],
        difficulty: 'moderate'
      },
      progress: {
        materialsAssigned: false,
        objectivesSet: false,
        planGenerated: false,
        planApproved: false,
        questionsGenerated: false,
        reviewCompleted: false
      }
    });
    
    await quiz.save();
    quizzes.push(quiz);
    console.log(`✅ Created ${quiz.name} for folder ${folder.name}`);
  }

  // Update folder with quiz references
  folder.quizzes = quizzes.map(q => q._id);
  await folder.save();

  // Populate the folder with quiz data for response
  await folder.populate('quizzes', 'name status progress questions createdAt');

  // Update user stats
  if (req.user.fullUser) {
    await req.user.fullUser.incrementStats('coursesCreated');
    await req.user.fullUser.incrementStats('quizzesGenerated', quizCount);
  }

  return successResponse(res, { folder }, 'Folder created successfully with quizzes', HTTP_STATUS.CREATED);
}));

/**
 * GET /api/folders/:id
 * Get specific folder with details
 */
router.get('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const folderId = req.params.id;
  const userId = req.user.id;

  const folder = await Folder.findOne({ _id: folderId, instructor: userId })
    .populate({
      path: 'quizzes',
      select: 'name status progress questions createdAt',
      options: { sort: { createdAt: -1 } }
    });

  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  return successResponse(res, { folder }, 'Folder retrieved successfully');
}));

/**
 * PUT /api/folders/:id
 * Update folder name
 */
router.put('/:id', authenticateToken, validateUpdateFolder, asyncHandler(async (req, res) => {
  const folderId = req.params.id;
  const userId = req.user.id;
  const { name } = req.body;

  const folder = await Folder.findOne({ _id: folderId, instructor: userId });

  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  // Check if new name conflicts with existing folders
  if (name && name.trim() !== folder.name) {
    const existingFolder = await Folder.findOne({ 
      instructor: userId, 
      name: name.trim(),
      _id: { $ne: folderId } 
    });

    if (existingFolder) {
      return errorResponse(
        res, 
        'A folder with this name already exists', 
        'DUPLICATE_FOLDER', 
        HTTP_STATUS.CONFLICT
      );
    }

    folder.name = name.trim();
  }

  await folder.updateStats();

  return successResponse(res, { folder }, 'Folder updated successfully');
}));

/**
 * DELETE /api/folders/:id
 * Delete folder and all its contents
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const folderId = req.params.id;
  const userId = req.user.id;

  const folder = await Folder.findOne({ _id: folderId, instructor: userId });

  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  // Check if folder has materials or quizzes
  if (folder.materials.length > 0 || folder.quizzes.length > 0) {
    return errorResponse(
      res, 
      'Cannot delete folder with existing materials or quizzes. Please remove them first.', 
      'FOLDER_NOT_EMPTY', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  await Folder.findByIdAndDelete(folderId);

  return successResponse(res, null, 'Folder deleted successfully');
}));

/**
 * GET /api/folders/:id/stats
 * Get folder statistics
 */
router.get('/:id/stats', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const folderId = req.params.id;
  const userId = req.user.id;

  const folder = await Folder.findOne({ _id: folderId, instructor: userId });

  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  // Get detailed stats
  const Material = (await import('../models/Material.js')).default;
  const Quiz = (await import('../models/Quiz.js')).default;
  const Question = (await import('../models/Question.js')).default;

  const [materialStats, quizStats] = await Promise.all([
    Material.aggregate([
      { $match: { folder: folder._id } },
      {
        $group: {
          _id: '$processingStatus',
          count: { $sum: 1 },
          totalSize: { $sum: '$fileSize' }
        }
      }
    ]),
    Quiz.aggregate([
      { $match: { folder: folder._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  const totalQuestions = await Question.countDocuments({
    quiz: { $in: folder.quizzes }
  });

  const stats = {
    folder: folder.stats,
    materials: {
      total: folder.materials.length,
      byStatus: materialStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      totalSize: materialStats.reduce((total, stat) => total + (stat.totalSize || 0), 0)
    },
    quizzes: {
      total: folder.quizzes.length,
      byStatus: quizStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      totalQuestions
    }
  };

  return successResponse(res, { stats }, 'Folder statistics retrieved');
}));

export default router;