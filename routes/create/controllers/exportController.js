import express from 'express';
import Quiz from '../models/Quiz.js';
import Question from '../models/Question.js';
import LearningObjective from '../models/LearningObjective.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateMongoId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

const router = express.Router();

/**
 * POST /api/export/h5p/:quizId
 * Generate H5P export
 */
router.post('/h5p/:quizId', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate({
      path: 'questions',
      populate: {
        path: 'learningObjective',
        select: 'text order'
      },
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives', 'text order');

  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  if (!quiz.questions || quiz.questions.length === 0) {
    return errorResponse(res, 'Quiz must have questions before exporting', 'NO_QUESTIONS', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    // Generate H5P content
    const h5pContent = await generateH5PContent(quiz);
    
    // Create export file
    const exportId = crypto.randomBytes(16).toString('hex');
    const filename = `${quiz.name.replace(/[^a-zA-Z0-9]/g, '_')}_${exportId}.h5p`;
    const filePath = path.join('./routes/create/uploads/', filename);

    // Write H5P file (for now, just JSON - in real implementation would be ZIP)
    await fs.writeFile(filePath, JSON.stringify(h5pContent, null, 2));

    // Save export record
    await quiz.addExport(filePath);

    return successResponse(res, {
      exportId,
      filename,
      downloadUrl: `/api/export/${exportId}/download`,
      previewUrl: `/api/export/${quizId}/preview`,
      metadata: {
        questionCount: quiz.questions.length,
        objectiveCount: quiz.learningObjectives.length,
        exportFormat: 'h5p',
        fileSize: h5pContent.toString().length
      }
    }, 'H5P export generated successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('H5P export error:', error);
    return errorResponse(res, 'Failed to generate H5P export', 'EXPORT_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * GET /api/export/:exportId/download
 * Download exported file
 */
router.get('/:exportId/download', authenticateToken, asyncHandler(async (req, res) => {
  const exportId = req.params.exportId;
  const userId = req.user.id;

  // Find quiz with this export
  const quiz = await Quiz.findOne({ 
    'exports.filePath': { $regex: exportId },
    createdBy: userId 
  });

  if (!quiz) {
    return notFoundResponse(res, 'Export');
  }

  const exportRecord = quiz.exports.find(exp => exp.filePath.includes(exportId));
  if (!exportRecord) {
    return notFoundResponse(res, 'Export');
  }

  try {
    // Check if file exists
    await fs.access(exportRecord.filePath);

    // Increment download count
    exportRecord.downloadCount += 1;
    await quiz.save();

    // Send file
    const filename = path.basename(exportRecord.filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/zip');
    
    // In a real implementation, you would stream the file
    const fileContent = await fs.readFile(exportRecord.filePath);
    res.send(fileContent);

  } catch (error) {
    console.error('Download error:', error);
    return notFoundResponse(res, 'Export file');
  }
}));

/**
 * GET /api/export/:quizId/preview
 * Preview quiz structure
 */
router.get('/:quizId/preview', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate({
      path: 'questions',
      populate: {
        path: 'learningObjective',
        select: 'text order'
      },
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives', 'text order')
    .populate('activePlan', 'approach distribution');

  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const preview = {
    quiz: {
      name: quiz.name,
      status: quiz.status,
      progress: quiz.progress,
      createdAt: quiz.createdAt
    },
    structure: {
      objectiveCount: quiz.learningObjectives.length,
      questionCount: quiz.questions.length,
      questionTypes: getQuestionTypeBreakdown(quiz.questions),
      difficultyDistribution: getDifficultyDistribution(quiz.questions)
    },
    objectives: quiz.learningObjectives.map(obj => ({
      text: obj.text,
      order: obj.order,
      questionCount: quiz.questions.filter(q => q.learningObjective._id.equals(obj._id)).length
    })),
    questions: quiz.questions.map(q => ({
      id: q._id,
      type: q.type,
      difficulty: q.difficulty,
      questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
      learningObjective: q.learningObjective.text,
      reviewStatus: q.reviewStatus,
      order: q.order
    })),
    exportInfo: {
      readyForExport: quiz.questions.length > 0,
      h5pCompatible: true,
      estimatedFileSize: estimateExportSize(quiz)
    }
  };

  if (quiz.activePlan) {
    preview.generationPlan = {
      approach: quiz.activePlan.approach,
      distribution: quiz.activePlan.distribution
    };
  }

  return successResponse(res, { preview }, 'Quiz preview generated successfully');
}));

/**
 * GET /api/export/:quizId/formats
 * Get available export formats
 */
router.get('/:quizId/formats', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const formats = [
    {
      name: 'H5P',
      id: 'h5p',
      description: 'Interactive content for LMS platforms like Canvas',
      supported: true,
      fileExtension: '.h5p',
      features: ['Interactive questions', 'Immediate feedback', 'Progress tracking', 'Mobile responsive']
    },
    {
      name: 'QTI',
      id: 'qti',
      description: 'Question and Test Interoperability format',
      supported: false,
      fileExtension: '.zip',
      features: ['LMS compatibility', 'Question bank import', 'Standards compliant']
    },
    {
      name: 'JSON',
      id: 'json',
      description: 'Raw quiz data in JSON format',
      supported: true,
      fileExtension: '.json',
      features: ['Developer friendly', 'Easy parsing', 'Custom integration']
    }
  ];

  return successResponse(res, { formats }, 'Export formats retrieved successfully');
}));

/**
 * DELETE /api/export/:exportId
 * Delete export file
 */
router.delete('/:exportId', authenticateToken, asyncHandler(async (req, res) => {
  const exportId = req.params.exportId;
  const userId = req.user.id;

  // Find quiz with this export
  const quiz = await Quiz.findOne({ 
    'exports.filePath': { $regex: exportId },
    createdBy: userId 
  });

  if (!quiz) {
    return notFoundResponse(res, 'Export');
  }

  const exportIndex = quiz.exports.findIndex(exp => exp.filePath.includes(exportId));
  if (exportIndex === -1) {
    return notFoundResponse(res, 'Export');
  }

  const exportRecord = quiz.exports[exportIndex];

  try {
    // Delete file
    await fs.unlink(exportRecord.filePath);
  } catch (error) {
    console.error('Error deleting export file:', error);
    // Continue to remove from database even if file deletion fails
  }

  // Remove from quiz exports
  quiz.exports.splice(exportIndex, 1);
  await quiz.save();

  return successResponse(res, null, 'Export deleted successfully');
}));

// Helper functions
async function generateH5PContent(quiz) {
  const h5pStructure = {
    title: quiz.name,
    language: 'en',
    introduction: `Quiz: ${quiz.name}`,
    questions: [],
    settings: {
      enableRetry: true,
      enableSolutionsButton: true,
      enableCheckButton: true,
      showScorePoints: true,
      progressType: 'dots',
      passPercentage: 70
    },
    metadata: {
      generatedBy: 'TLEF-CREATE',
      createdAt: new Date().toISOString(),
      questionCount: quiz.questions.length,
      objectiveCount: quiz.learningObjectives.length
    }
  };

  for (const question of quiz.questions) {
    const h5pQuestion = convertQuestionToH5P(question);
    h5pStructure.questions.push(h5pQuestion);
  }

  return h5pStructure;
}

function convertQuestionToH5P(question) {
  const baseQuestion = {
    type: question.type,
    text: question.questionText,
    feedback: question.explanation || 'Good job!'
  };

  switch (question.type) {
    case 'multiple-choice':
      return {
        ...baseQuestion,
        library: 'H5P.MultiChoice 1.16',
        answers: question.content.options?.map(option => ({
          text: option.text,
          correct: option.isCorrect,
          tipsAndFeedback: {
            tip: '',
            chosenFeedback: option.isCorrect ? 'Correct!' : 'Try again.',
            notChosenFeedback: ''
          }
        })) || []
      };

    case 'true-false':
      return {
        ...baseQuestion,
        library: 'H5P.TrueFalse 1.8',
        correct: question.correctAnswer === 'True' ? 'true' : 'false'
      };

    default:
      return {
        ...baseQuestion,
        library: 'H5P.Essay 1.5',
        placeholder: 'Enter your answer here...'
      };
  }
}

function getQuestionTypeBreakdown(questions) {
  const breakdown = {};
  questions.forEach(q => {
    breakdown[q.type] = (breakdown[q.type] || 0) + 1;
  });
  return breakdown;
}

function getDifficultyDistribution(questions) {
  const distribution = {};
  questions.forEach(q => {
    distribution[q.difficulty] = (distribution[q.difficulty] || 0) + 1;
  });
  return distribution;
}

function estimateExportSize(quiz) {
  const baseSize = 1024; // Base H5P structure
  const questionSize = 512; // Average per question
  const estimated = baseSize + (quiz.questions.length * questionSize);
  
  if (estimated < 1024) return `${estimated} bytes`;
  if (estimated < 1024 * 1024) return `${Math.round(estimated / 1024)} KB`;
  return `${Math.round(estimated / (1024 * 1024))} MB`;
}

export default router;