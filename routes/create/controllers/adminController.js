import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import BugReport from '../models/BugReport.js';
import User from '../models/User.js';
import Folder from '../models/Folder.js';
import Quiz from '../models/Quiz.js';
import Question from '../models/Question.js';
import Material from '../models/Material.js';
import LearningObjective from '../models/LearningObjective.js';
import GenerationPlan from '../models/GenerationPlan.js';
import HelpInteraction from '../models/HelpInteraction.js';
import AuditEvent from '../models/AuditEvent.js';
import { recordAuditEvent } from '../services/auditService.js';

const router = express.Router();

const ADMIN_CWLS = (process.env.ADMIN_CWLS || '').split(',').map(s => s.trim()).filter(Boolean);

function requireAdmin(req, res, next) {
  const user = req.user?.fullUser || req.user;
  const userIdentifiers = [
    user?.cwlId,
    user?.displayName,
    user?.email,
    user?.email?.split('@')[0]
  ].filter(Boolean).map(s => s.toLowerCase());
  const isAdmin = ADMIN_CWLS.some(a => userIdentifiers.includes(a.toLowerCase()));
  if (!isAdmin) {
    return errorResponse(res, 'Admin access required', 'FORBIDDEN', 403);
  }
  next();
}

function clampLimit(value, fallback = 100, max = 250) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MATERIAL_ADMIN_FIELDS = 'name type originalFileName fileSize mimeType processingStatus processingMetadata timesUsedInQuiz lastUsed createdAt updatedAt';
const QUESTION_ADMIN_FIELDS = 'quiz learningObjective generationPlan type difficulty questionText content correctAnswer explanation order reviewStatus generationMetadata.sourceReferences.materialId generationMetadata.sourceReferences.materialName generationMetadata.sourceReferences.pageNumber generationMetadata.sourceReferences.pageStart generationMetadata.sourceReferences.pageEnd generationMetadata.sourceReferences.relevanceScore generationMetadata.sourceReferences.section generationMetadata.subObjective generationMetadata.focusArea generationMetadata.complexity generationMetadata.pedagogicalIntent generationMetadata.bloomLevel generationMetadata.planRationale generationMetadata.plannedSlice generationMetadata.plannedIntent generationMetadata.noveltyScore generationMetadata.generationMethod generationMetadata.streamingGenerated generationMetadata.generatedAt generationMetadata.confidence createdAt updatedAt';

// ============================================================
// Bug Reports (any authenticated user can submit)
// ============================================================

/**
 * POST /api/admin/reports
 * Submit a bug report
 */
router.post('/reports', authenticateToken, asyncHandler(async (req, res) => {
  const { type, description, email } = req.body;
  if (!description || !description.trim()) {
    return errorResponse(res, 'Description is required', 'MISSING_DESCRIPTION', 400);
  }

  const report = await BugReport.create({
    reporter: req.user.id,
    type: type || 'bug',
    description: description.trim(),
    email: email || null
  });

  return successResponse(res, { report }, 'Bug report submitted', 201);
}));

// ============================================================
// Admin-only endpoints
// ============================================================

/**
 * GET /api/admin/reports
 * List all bug reports (admin only)
 */
router.get('/reports', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const reports = await BugReport.find(filter)
    .populate('reporter', 'cwlId')
    .sort({ createdAt: -1 })
    .limit(100);

  return successResponse(res, { reports }, 'Bug reports retrieved');
}));

/**
 * PUT /api/admin/reports/:id
 * Update bug report status/notes (admin only)
 */
router.put('/reports/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { status, adminNotes } = req.body;
  const report = await BugReport.findById(req.params.id);
  if (!report) return errorResponse(res, 'Report not found', 'NOT_FOUND', 404);

  if (status) report.status = status;
  if (adminNotes !== undefined) report.adminNotes = adminNotes;
  await report.save();

  return successResponse(res, { report }, 'Report updated');
}));

/**
 * GET /api/admin/stats
 * Platform usage statistics (admin only)
 */
router.get('/stats', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const activeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [totalUsers, totalFolders, totalQuizzes, totalQuestions, totalGuideInteractions, activeActors, guideRatings] = await Promise.all([
    User.countDocuments(),
    Folder.countDocuments(),
    Quiz.countDocuments(),
    Question.countDocuments(),
    HelpInteraction.countDocuments(),
    AuditEvent.distinct('actor', { createdAt: { $gte: activeSince } }),
    HelpInteraction.aggregate([
      { $match: { 'rating.value': { $in: ['helpful', 'not-helpful'] } } },
      { $group: { _id: '$rating.value', count: { $sum: 1 } } }
    ])
  ]);

  // Per-user question generation stats
  const userStats = await User.find({}, 'cwlId stats lastLogin createdAt').sort({ 'stats.questionsCreated': -1 }).limit(50);

  const openReports = await BugReport.countDocuments({ status: 'open' });
  const ratingCounts = Object.fromEntries(guideRatings.map(item => [item._id, item.count]));

  return successResponse(res, {
    platform: {
      totalUsers,
      totalFolders,
      totalQuizzes,
      totalQuestions,
      totalGuideInteractions,
      activeUsers30d: activeActors.length,
      guideHelpful: ratingCounts.helpful || 0,
      guideNotHelpful: ratingCounts['not-helpful'] || 0,
      openReports
    },
    users: userStats.map(u => ({
      _id: u._id,
      cwlId: u.cwlId,
      coursesCreated: u.stats?.coursesCreated || 0,
      quizzesGenerated: u.stats?.quizzesGenerated || 0,
      questionsCreated: u.stats?.questionsCreated || 0,
      lastLogin: u.lastLogin,
      joinedAt: u.createdAt
    }))
  }, 'Admin stats retrieved');
}));

// ============================================================
// User API Key Permission Management
// ============================================================

/**
 * GET /api/admin/users
 * List all users with their canUseEnvKey status (admin only)
 */
router.get('/users', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const users = await User.find({}, 'cwlId displayName email role canUseEnvKey stats lastLogin createdAt').sort({ createdAt: -1 });
  return successResponse(res, { users }, 'Users retrieved');
}));

/**
 * GET /api/admin/guide-insights
 * Review CREATE Guide questions, answers, citations, and user feedback.
 */
router.get('/guide-insights', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const filter = {};
  if (['processing', 'completed', 'failed'].includes(req.query.status)) filter.status = req.query.status;
  if (['helpful', 'not-helpful'].includes(req.query.rating)) filter['rating.value'] = req.query.rating;
  if (req.query.rating === 'unrated') filter['rating.value'] = { $exists: false };
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    filter.question = { $regex: escapeRegex(req.query.search.trim().slice(0, 160)), $options: 'i' };
  }

  const [interactions, total, summaryRows, commonQuestions] = await Promise.all([
    HelpInteraction.find(filter)
      .populate('user', 'cwlId displayName email')
      .sort({ createdAt: -1 })
      .limit(clampLimit(req.query.limit))
      .lean(),
    HelpInteraction.countDocuments(filter),
    HelpInteraction.aggregate([
      { $group: {
        _id: null,
        total: { $sum: 1 },
        helpful: { $sum: { $cond: [{ $eq: ['$rating.value', 'helpful'] }, 1, 0] } },
        notHelpful: { $sum: { $cond: [{ $eq: ['$rating.value', 'not-helpful'] }, 1, 0] } },
        fallback: { $sum: { $cond: ['$fallback', 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
      } }
    ]),
    HelpInteraction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: { $toLower: '$question' }, question: { $first: '$question' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, question: 1, count: 1 } }
    ])
  ]);

  const summary = summaryRows[0] || { total: 0, helpful: 0, notHelpful: 0, fallback: 0, failed: 0 };
  const rated = summary.helpful + summary.notHelpful;
  summary.helpfulRate = rated ? Math.round((summary.helpful / rated) * 100) : null;

  return successResponse(res, { interactions, total, summary, commonQuestions }, 'CREATE Guide insights retrieved');
}));

/**
 * GET /api/admin/activity
 * Privacy-safe operation timeline. Request bodies and generated content are never stored here.
 */
router.get('/activity', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.userId) filter.actor = req.query.userId;
  if (req.query.action) filter.action = req.query.action;
  if (['success', 'failed'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const [events, actions] = await Promise.all([
    AuditEvent.find(filter)
      .populate('actor', 'cwlId displayName email')
      .populate('folder', 'name')
      .populate('quiz', 'name')
      .sort({ createdAt: -1 })
      .limit(clampLimit(req.query.limit, 150))
      .lean(),
    AuditEvent.distinct('action')
  ]);
  return successResponse(res, { events, actions: actions.sort() }, 'Activity retrieved');
}));

/**
 * GET /api/admin/users/:id/courses
 * Read-only course summaries for a selected user.
 */
router.get('/users/:id/courses', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const [targetUser, courses] = await Promise.all([
    User.findById(req.params.id, 'cwlId displayName email lastLogin createdAt').lean(),
    Folder.find({ instructor: req.params.id }, 'name stats materials quizzes createdAt updatedAt').sort({ updatedAt: -1 }).lean()
  ]);
  if (!targetUser) return errorResponse(res, 'User not found', 'NOT_FOUND', 404);

  await recordAuditEvent({
    actor: req.user.id,
    action: 'admin.view_user_courses',
    resourceType: 'user',
    resourceId: req.params.id,
    metadata: { targetUserId: req.params.id, adminView: 'user-courses' }
  });
  return successResponse(res, { user: targetUser, courses }, 'User courses retrieved');
}));

/**
 * GET /api/admin/courses/:id
 * Course structure only. Raw files, URLs, and material content are intentionally excluded.
 */
router.get('/courses/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const course = await Folder.findById(req.params.id, 'name instructor stats createdAt updatedAt')
    .populate('instructor', 'cwlId displayName email')
    .lean();
  if (!course) return errorResponse(res, 'Course not found', 'NOT_FOUND', 404);

  const [materials, quizzes] = await Promise.all([
    Material.find({ folder: course._id }, MATERIAL_ADMIN_FIELDS).sort({ createdAt: -1 }).lean(),
    Quiz.find({ folder: course._id }, 'name status settings materials learningObjectives questions generationPlans activePlan exports.format exports.exportedAt createdAt updatedAt').sort({ createdAt: -1 }).lean()
  ]);

  await recordAuditEvent({
    actor: req.user.id,
    action: 'admin.view_course',
    resourceType: 'course',
    resourceId: course._id,
    folder: course._id,
    metadata: { targetUserId: course.instructor?._id, adminView: 'course' }
  });
  return successResponse(res, { course: { ...course, materials, quizzes } }, 'Course details retrieved');
}));

/**
 * GET /api/admin/quizzes/:id
 * Read-only quiz content with prompt text and raw source excerpts removed.
 */
router.get('/quizzes/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id, 'name folder status settings materials activePlan createdBy exports.format exports.exportedAt createdAt updatedAt')
    .populate('folder', 'name instructor')
    .populate('createdBy', 'cwlId displayName email')
    .lean();
  if (!quiz) return errorResponse(res, 'Quiz not found', 'NOT_FOUND', 404);

  const [materials, objectives, questions, plans] = await Promise.all([
    Material.find({ _id: { $in: quiz.materials || [] } }, MATERIAL_ADMIN_FIELDS).lean(),
    LearningObjective.find({ quiz: quiz._id }, 'text order generatedFrom generationMetadata.isAIGenerated generationMetadata.llmModel generationMetadata.sourceReferences.materialId generationMetadata.sourceReferences.materialName generationMetadata.sourceReferences.pageNumber generationMetadata.sourceReferences.pageStart generationMetadata.sourceReferences.pageEnd generationMetadata.sourceReferences.relevanceScore generationMetadata.sourceReferences.section generationMetadata.title generationMetadata.topic generationMetadata.subtopic generationMetadata.sourceOutlineSection generationMetadata.subpoints generationMetadata.bloomLevel generationMetadata.rationale generationMetadata.confidence createdAt updatedAt').sort({ order: 1 }).lean(),
    Question.find({ quiz: quiz._id }, QUESTION_ADMIN_FIELDS).sort({ order: 1 }).lean(),
    GenerationPlan.find({ quiz: quiz._id }, 'approach questionsPerLO totalQuestions customFormula breakdown distribution generationMetadata.llmModel generationMetadata.processingTime generationMetadata.confidence generationMetadata.reasoning status createdAt updatedAt').sort({ createdAt: -1 }).lean()
  ]);

  await recordAuditEvent({
    actor: req.user.id,
    action: 'admin.view_quiz',
    resourceType: 'quiz',
    resourceId: quiz._id,
    folder: quiz.folder?._id,
    quiz: quiz._id,
    metadata: { adminView: 'quiz' }
  });
  return successResponse(res, { quiz: { ...quiz, materials, learningObjectives: objectives, questions, generationPlans: plans } }, 'Quiz details retrieved');
}));

/**
 * PATCH /api/admin/users/env-key-permission/all
 * Grant or revoke env key permission for all users at once (admin only)
 */
router.patch('/users/env-key-permission/all', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { canUseEnvKey } = req.body;
  if (typeof canUseEnvKey !== 'boolean') {
    return errorResponse(res, 'canUseEnvKey must be a boolean', 'INVALID_INPUT', 400);
  }
  await User.updateMany({}, { canUseEnvKey });
  return successResponse(res, { canUseEnvKey }, 'Permission updated for all users');
}));

/**
 * PATCH /api/admin/users/:id/env-key-permission
 * Grant or revoke a user's permission to use the .env API key (admin only)
 */
router.patch('/users/:id/env-key-permission', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { canUseEnvKey } = req.body;
  if (typeof canUseEnvKey !== 'boolean') {
    return errorResponse(res, 'canUseEnvKey must be a boolean', 'INVALID_INPUT', 400);
  }
  const user = await User.findByIdAndUpdate(req.params.id, { canUseEnvKey }, { new: true });
  if (!user) {
    return errorResponse(res, 'User not found', 'NOT_FOUND', 404);
  }
  return successResponse(res, { user: { _id: user._id, cwlId: user.cwlId, canUseEnvKey: user.canUseEnvKey } }, 'Permission updated');
}));

export default router;
