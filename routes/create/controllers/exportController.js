import express from 'express';
import Quiz from '../models/Quiz.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateQuizId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

import { createH5PPackage } from '../services/h5pExportService.js';
import { createPDFExport } from '../services/pdfExportService.js';
import { getQuestionTypeBreakdown, getDifficultyDistribution, estimateExportSize } from '../services/exportUtils.js';

const router = express.Router();

// Shared helper: load a quiz with populated questions + objectives, scoped to user
async function loadQuizForExport(quizId, userId) {
  return Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate({
      path: 'questions',
      populate: { path: 'learningObjective', select: 'text order' },
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives', 'text order');
}

/**
 * POST /api/export/h5p/:quizId
 * Generate H5P export
 */
router.post('/h5p/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quiz = await loadQuizForExport(req.params.quizId, req.user.id);
  if (!quiz) return notFoundResponse(res, 'Quiz');
  if (!quiz.questions || quiz.questions.length === 0) {
    return errorResponse(res, 'Quiz must have questions before exporting', 'NO_QUESTIONS', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    const exportId = crypto.randomBytes(16).toString('hex');
    const filename = `${quiz.name.replace(/[^a-zA-Z0-9]/g, '_')}_${exportId}.h5p`;
    const uploadsDir = path.join('./routes/create/uploads/');
    const filePath = path.join(uploadsDir, filename);

    await fs.mkdir(uploadsDir, { recursive: true });
    await createH5PPackage(quiz, filePath);

    if (quiz.addExport) {
      await quiz.addExport(filePath);
    } else {
      console.log(`Export created for quiz ${quiz._id}: ${filePath}`);
    }

    const stats = await fs.stat(filePath);

    return successResponse(res, {
      exportId,
      filename,
      downloadUrl: `/api/export/${exportId}/download`,
      previewUrl: `/api/export/${req.params.quizId}/preview`,
      metadata: {
        questionCount: quiz.questions.length,
        objectiveCount: quiz.learningObjectives.length,
        exportFormat: 'h5p',
        fileSize: stats.size
      }
    }, 'H5P export generated successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    console.error('H5P export error:', error);
    return errorResponse(res, 'Failed to generate H5P export', 'EXPORT_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * POST /api/export/pdf/:quizId
 * Generate PDF export
 */
router.post('/pdf/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const { type } = req.body;

  if (!['questions', 'answers', 'combined'].includes(type)) {
    return errorResponse(res, 'Invalid export type. Must be "questions", "answers", or "combined"', 'INVALID_TYPE', HTTP_STATUS.BAD_REQUEST);
  }

  const quiz = await loadQuizForExport(req.params.quizId, req.user.id);
  if (!quiz) return notFoundResponse(res, 'Quiz');
  if (!quiz.questions || quiz.questions.length === 0) {
    return errorResponse(res, 'Quiz must have questions before exporting', 'NO_QUESTIONS', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    const exportId = crypto.randomBytes(16).toString('hex');
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const filename = `${quiz.name.replace(/[^a-zA-Z0-9]/g, '_')}_${typeLabel}_${exportId}.pdf`;
    const uploadsDir = path.join('./routes/create/uploads/');
    const filePath = path.join(uploadsDir, filename);

    await fs.mkdir(uploadsDir, { recursive: true });
    await createPDFExport(quiz, filePath, type);

    if (quiz.addExport) {
      await quiz.addExport(filePath);
    } else {
      console.log(`PDF export created for quiz ${quiz._id}: ${filePath}`);
    }

    const stats = await fs.stat(filePath);

    return successResponse(res, {
      exportId,
      filename,
      downloadUrl: `/api/export/${exportId}/download`,
      metadata: {
        questionCount: quiz.questions.length,
        exportFormat: 'pdf',
        exportType: type,
        fileSize: stats.size
      }
    }, 'PDF export generated successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    console.error('PDF export error:', error);
    return errorResponse(res, 'Failed to generate PDF export', 'EXPORT_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * GET /api/export/:exportId/download
 * Download exported file
 */
router.get('/:exportId/download', authenticateToken, asyncHandler(async (req, res) => {
  const exportId = req.params.exportId;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({
    'exports.filePath': { $regex: exportId },
    createdBy: userId
  });

  if (!quiz) return notFoundResponse(res, 'Export');

  const exportRecord = quiz.exports.find(exp => exp.filePath.includes(exportId));
  if (!exportRecord) return notFoundResponse(res, 'Export');

  try {
    await fs.access(exportRecord.filePath);

    exportRecord.downloadCount += 1;
    await quiz.save();

    const filename = path.basename(exportRecord.filePath);
    const fileExtension = path.extname(filename).toLowerCase();
    const contentType = fileExtension === '.pdf' ? 'application/pdf' : 'application/zip';

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);

    const absolutePath = path.resolve(exportRecord.filePath);
    res.sendFile(absolutePath);
  } catch (error) {
    console.error('Download error:', error);
    return notFoundResponse(res, 'Export file');
  }
}));

/**
 * GET /api/export/:quizId/preview
 * Preview quiz structure
 */
router.get('/:quizId/preview', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.quizId, createdBy: req.user.id })
    .populate({
      path: 'questions',
      populate: { path: 'learningObjective', select: 'text order' },
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives', 'text order')
    .populate('activePlan', 'approach distribution');

  if (!quiz) return notFoundResponse(res, 'Quiz');

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
router.get('/:quizId/formats', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.quizId, createdBy: req.user.id });
  if (!quiz) return notFoundResponse(res, 'Quiz');

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

  const quiz = await Quiz.findOne({
    'exports.filePath': { $regex: exportId },
    createdBy: userId
  });

  if (!quiz) return notFoundResponse(res, 'Export');

  const exportIndex = quiz.exports.findIndex(exp => exp.filePath.includes(exportId));
  if (exportIndex === -1) return notFoundResponse(res, 'Export');

  const exportRecord = quiz.exports[exportIndex];

  try {
    await fs.unlink(exportRecord.filePath);
  } catch (error) {
    console.error('Error deleting export file:', error);
  }

  quiz.exports.splice(exportIndex, 1);
  await quiz.save();

  return successResponse(res, null, 'Export deleted successfully');
}));

export default router;
