/**
 * Search Controller
 * Handles global search across materials, questions, and learning objectives
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import { ERROR_CODES, HTTP_STATUS } from '../config/constants.js';

const router = express.Router();

/**
 * GET /api/search?q=query
 * Search across materials, questions, and learning objectives
 */
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { q: query } = req.query;
  const userId = req.user.id;

  if (typeof query !== 'string' || query.trim().length < 2) {
    return successResponse(res, { results: [] }, 'Query too short');
  }

  const normalizedQuery = query.trim().slice(0, 120);
  console.log('🔍 Search request received', { userId, queryLength: normalizedQuery.length });

  try {
    // Import models
    const Material = (await import('../models/Material.js')).default;
    const Question = (await import('../models/Question.js')).default;
    const LearningObjective = (await import('../models/LearningObjective.js')).default;
    const Folder = (await import('../models/Folder.js')).default;
    const Quiz = (await import('../models/Quiz.js')).default;

    // Treat user input as literal text rather than a regular-expression program.
    const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedQuery, 'i');

    // Resolve valid parents first so orphaned records and records belonging to
    // another instructor can never produce navigable search results.
    const ownedFolders = await Folder.find({ instructor: userId }).select('_id').lean();
    const ownedFolderIds = ownedFolders.map(folder => folder._id);
    const ownedQuizzes = ownedFolderIds.length > 0
      ? await Quiz.find({ createdBy: userId, folder: { $in: ownedFolderIds } }).select('_id').lean()
      : [];
    const ownedQuizIds = ownedQuizzes.map(quiz => quiz._id);

    // Search materials (name, content)
    const materialsPromise = Material.find({
      uploadedBy: userId,
      folder: { $in: ownedFolderIds },
      $or: [
        { name: searchRegex },
        { content: searchRegex }
      ]
    })
    .populate('folder', 'name')
    .limit(10)
    .lean();

    // Search questions (questionText, explanation)
    const questionsPromise = Question.find({
      createdBy: userId,
      quiz: { $in: ownedQuizIds },
      $or: [
        { questionText: searchRegex },
        { explanation: searchRegex }
      ]
    })
    .populate({
      path: 'quiz',
      select: '_id name folder',
      populate: {
        path: 'folder',
        select: '_id name'
      }
    })
    .limit(10)
    .lean();

    // Search learning objectives (text, description)
    const objectivesPromise = LearningObjective.find({
      createdBy: userId,
      quiz: { $in: ownedQuizIds },
      $or: [
        { text: searchRegex },
        { description: searchRegex }
      ]
    })
    .populate({
      path: 'quiz',
      select: '_id name folder',
      populate: {
        path: 'folder',
        select: '_id name'
      }
    })
    .limit(10)
    .lean();

    // Execute searches in parallel
    const [materials, questions, objectives] = await Promise.all([
      materialsPromise,
      questionsPromise,
      objectivesPromise
    ]);

    // Format results
    const results = [];

    // Add materials to results
    materials.forEach(material => {
      if (!material.folder?._id) {
        return;
      }
      results.push({
        type: 'material',
        id: material._id,
        title: material.name,
        snippet: material.content ? material.content.substring(0, 100) + '...' : '',
        courseName: material.folder?.name || 'Unknown Course',
        courseId: material.folder?._id,
        // For materials, navigate to course page
        navigationPath: `/course/${material.folder._id}`
      });
    });

    // Add questions to results
    questions.forEach(question => {
      const folderId = question.quiz?.folder?._id;
      const quizId = question.quiz?._id;

      // Only add if we have valid IDs
      if (folderId && quizId) {
        results.push({
          type: 'question',
          id: question._id,
          title: question.questionText,
          snippet: question.explanation ? question.explanation.substring(0, 100) + '...' : '',
          courseName: question.quiz?.folder?.name || 'Unknown Course',
          courseId: folderId,
          quizName: question.quiz?.name || 'Unknown Quiz',
          quizId: quizId,
          // For questions, navigate to quiz page Review & Edit tab with question ID for scrolling
          navigationPath: `/course/${folderId}/quiz/${quizId}?tab=review&questionId=${question._id}`
        });
      } else {
        console.warn(`⚠️ Skipping question ${question._id} - missing folder (${folderId}) or quiz (${quizId}) ID`);
      }
    });

    // Add learning objectives to results
    objectives.forEach(objective => {
      const folderId = objective.quiz?.folder?._id;
      const quizId = objective.quiz?._id;

      // Only add if we have valid IDs
      if (folderId && quizId) {
        results.push({
          type: 'learning-objective',
          id: objective._id,
          title: objective.text,
          snippet: objective.description ? objective.description.substring(0, 100) + '...' : '',
          courseName: objective.quiz?.folder?.name || 'Unknown Course',
          courseId: folderId,
          quizName: objective.quiz?.name || 'Unknown Quiz',
          quizId: quizId,
          // For objectives, navigate to quiz page Learning Objectives tab
          navigationPath: `/course/${folderId}/quiz/${quizId}?tab=objectives`
        });
      } else {
        console.warn(`⚠️ Skipping learning objective ${objective._id} - missing folder (${folderId}) or quiz (${quizId}) ID`);
      }
    });

    console.log(`✅ Found ${results.length} total results`);
    const resultCounts = results.reduce((counts, result) => {
      if (result.type === 'material') counts.materials += 1;
      if (result.type === 'question') counts.questions += 1;
      if (result.type === 'learning-objective') counts.objectives += 1;
      return counts;
    }, { materials: 0, questions: 0, objectives: 0 });

    console.log(`   - Materials: ${resultCounts.materials}`);
    console.log(`   - Questions: ${resultCounts.questions}`);
    console.log(`   - Learning Objectives: ${resultCounts.objectives}`);

    return successResponse(res, {
      results,
      counts: {
        materials: resultCounts.materials,
        questions: resultCounts.questions,
        objectives: resultCounts.objectives,
        total: results.length
      }
    }, 'Search completed');

  } catch (error) {
    console.error('❌ Search error:', error);
    return errorResponse(
      res,
      'Search failed',
      ERROR_CODES.INTERNAL_SERVER_ERROR,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      { reason: error.message }
    );
  }
}));

export default router;
