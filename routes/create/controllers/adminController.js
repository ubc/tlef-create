import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import BugReport from '../models/BugReport.js';
import User from '../models/User.js';
import Folder from '../models/Folder.js';
import Quiz from '../models/Quiz.js';
import Question from '../models/Question.js';

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
  const [totalUsers, totalFolders, totalQuizzes, totalQuestions] = await Promise.all([
    User.countDocuments(),
    Folder.countDocuments(),
    Quiz.countDocuments(),
    Question.countDocuments()
  ]);

  // Per-user question generation stats
  const userStats = await User.find({}, 'cwlId stats lastLogin createdAt').sort({ 'stats.questionsCreated': -1 }).limit(50);

  const openReports = await BugReport.countDocuments({ status: 'open' });

  return successResponse(res, {
    platform: { totalUsers, totalFolders, totalQuizzes, totalQuestions, openReports },
    users: userStats.map(u => ({
      cwlId: u.cwlId,
      coursesCreated: u.stats.coursesCreated,
      quizzesGenerated: u.stats.quizzesGenerated,
      questionsCreated: u.stats.questionsCreated,
      lastLogin: u.lastLogin,
      joinedAt: u.createdAt
    }))
  }, 'Admin stats retrieved');
}));

export default router;
