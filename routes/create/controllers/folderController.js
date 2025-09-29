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
 * Delete folder and CASCADE DELETE all its contents
 * - All materials and their vector embeddings
 * - All quizzes and their questions
 * - All learning objectives and generation plans
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const folderId = req.params.id;
  const userId = req.user.id;

  console.log(`🗑️ Starting cascade deletion for folder: ${folderId}`);

  const folder = await Folder.findOne({ _id: folderId, instructor: userId });

  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  console.log(`📊 Folder "${folder.name}" contains: ${folder.materials.length} materials, ${folder.quizzes.length} quizzes`);

  try {
    // Import models needed for cascade deletion
    const Material = await import('../models/Material.js');
    const Quiz = await import('../models/Quiz.js');
    const Question = await import('../models/Question.js');
    const LearningObjective = await import('../models/LearningObjective.js');
    const GenerationPlan = await import('../models/GenerationPlan.js');
    const ragService = await import('../services/ragService.js');
    
    // Step 1: Delete all vector embeddings for materials in this folder
    if (folder.materials.length > 0) {
      console.log('🔄 Cleaning up vector database embeddings...');
      
      try {
        // Clean up vector database embeddings for each material
        const materials = await Material.default.find({ 
          _id: { $in: folder.materials },
          folder: folderId 
        });
        
        for (const material of materials) {
          try {
            await ragService.default.cleanupMaterialEmbeddings(material._id.toString());
            console.log(`✅ Cleaned vector embeddings for material: ${material.name}`);
          } catch (embedError) {
            console.error(`⚠️ Failed to clean embeddings for ${material.name}:`, embedError.message);
            // Continue with deletion even if vector cleanup fails
          }
        }
      } catch (ragError) {
        console.error('⚠️ Vector database cleanup error:', ragError.message);
        // Continue with database deletion even if vector cleanup fails
      }
    }

    // Step 2: Delete all questions for all quizzes in this folder
    if (folder.quizzes.length > 0) {
      const questionDeleteResult = await Question.default.deleteMany({
        quiz: { $in: folder.quizzes }
      });
      console.log(`✅ Deleted ${questionDeleteResult.deletedCount} questions`);

      // Step 3: Delete all learning objectives for all quizzes in this folder
      const objectiveDeleteResult = await LearningObjective.default.deleteMany({
        quiz: { $in: folder.quizzes }
      });
      console.log(`✅ Deleted ${objectiveDeleteResult.deletedCount} learning objectives`);

      // Step 4: Delete all generation plans for all quizzes in this folder
      const planDeleteResult = await GenerationPlan.default.deleteMany({
        quiz: { $in: folder.quizzes }
      });
      console.log(`✅ Deleted ${planDeleteResult.deletedCount} generation plans`);

      // Step 5: Delete all quizzes in this folder
      const quizDeleteResult = await Quiz.default.deleteMany({
        _id: { $in: folder.quizzes },
        folder: folderId
      });
      console.log(`✅ Deleted ${quizDeleteResult.deletedCount} quizzes`);
    }

    // Step 6: Delete all materials in this folder
    if (folder.materials.length > 0) {
      const materialDeleteResult = await Material.default.deleteMany({
        _id: { $in: folder.materials },
        folder: folderId
      });
      console.log(`✅ Deleted ${materialDeleteResult.deletedCount} materials`);
    }

    // Step 7: Finally, delete the folder itself
    await Folder.findByIdAndDelete(folderId);
    console.log(`✅ Deleted folder: ${folder.name}`);

    return successResponse(res, {
      folderId,
      folderName: folder.name,
      deletedCounts: {
        materials: folder.materials.length,
        quizzes: folder.quizzes.length,
        vectorEmbeddings: 'cleaned'
      }
    }, 'Course and all associated data deleted successfully');

  } catch (error) {
    console.error('❌ Error during cascade deletion:', error);
    return errorResponse(
      res, 
      `Failed to delete course: ${error.message}`, 
      'DELETION_ERROR', 
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
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