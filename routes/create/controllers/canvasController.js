import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import { HTTP_STATUS, ERROR_CODES } from '../config/constants.js';
import * as canvasApiService from '../services/canvasApiService.js';
import path from 'path';
import fs from 'fs/promises';
import { importH5PContent, renderContent } from '../services/lumiService.js';
import { createH5PPackage } from '../services/h5pExportService.js';
import Quiz from '../models/Quiz.js';

const router = express.Router();

// Check if Canvas integration is configured
const CANVAS_CONFIGURED = !!(process.env.CANVAS_CLIENT_ID && process.env.CANVAS_CLIENT_SECRET);

// ============================================================
// Public config endpoint (no auth required)
// ============================================================

/**
 * GET /canvas/config
 * Returns whether Canvas integration is available (no auth needed)
 */
router.get('/config', (req, res) => {
  return successResponse(res, {
    enabled: CANVAS_CONFIGURED,
    canvasBaseUrl: process.env.CANVAS_BASE_URL || null,
    ltiConfigured: !!process.env.LTI_CLIENT_ID
  }, 'Canvas configuration');
});

// All remaining routes require authentication
router.use(authenticateToken);

// ============================================================
// Canvas OAuth2 endpoints
// ============================================================

/**
 * GET /canvas/auth/status
 * Check if user has a valid Canvas connection
 */
router.get('/auth/status', asyncHandler(async (req, res) => {
  if (!CANVAS_CONFIGURED) {
    return successResponse(res, { connected: false, reason: 'Canvas integration not configured' }, 'Canvas auth status');
  }
  const connected = await canvasApiService.hasValidToken(req.user.id);
  return successResponse(res, { connected }, 'Canvas auth status');
}));

/**
 * GET /canvas/auth/connect
 * Redirect to Canvas OAuth2 authorization page
 */
router.get('/auth/connect', asyncHandler(async (req, res) => {
  // Generate state token for CSRF protection
  const state = crypto.randomBytes(32).toString('hex');

  // Store state in session for verification on callback
  req.session.canvasOAuthState = state;
  req.session.save();

  const authUrl = canvasApiService.getAuthorizationUrl(state);
  return successResponse(res, { authUrl }, 'Canvas authorization URL');
}));

/**
 * GET /canvas/oauth/callback
 * Handle Canvas OAuth2 callback
 */
router.get('/oauth/callback', asyncHandler(async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    // Redirect to frontend with error
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8092';
    return res.redirect(`${frontendUrl}/canvas-callback?error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !state) {
    return errorResponse(res, 'Missing code or state parameter', ERROR_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
  }

  // Verify state matches
  if (state !== req.session.canvasOAuthState) {
    return errorResponse(res, 'Invalid state parameter', ERROR_CODES.AUTH_ERROR, HTTP_STATUS.FORBIDDEN);
  }

  // Clear state from session
  delete req.session.canvasOAuthState;

  // Exchange code for tokens
  await canvasApiService.exchangeCode(code, req.user.id);

  // Redirect to frontend success page
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8092';
  return res.redirect(`${frontendUrl}/canvas-callback?success=true`);
}));

/**
 * DELETE /canvas/auth/disconnect
 * Disconnect Canvas account
 */
router.delete('/auth/disconnect', asyncHandler(async (req, res) => {
  await canvasApiService.deleteToken(req.user.id);
  return successResponse(res, null, 'Canvas disconnected');
}));

// ============================================================
// Canvas course/module listing
// ============================================================

/**
 * GET /canvas/courses
 * List courses where user is an instructor
 */
router.get('/courses', asyncHandler(async (req, res) => {
  const courses = await canvasApiService.listCourses(req.user.id);
  return successResponse(res, { courses }, 'Canvas courses retrieved');
}));

/**
 * GET /canvas/courses/:courseId/modules
 * List modules for a course
 */
router.get('/courses/:courseId/modules', asyncHandler(async (req, res) => {
  const modules = await canvasApiService.listModules(req.user.id, req.params.courseId);
  return successResponse(res, { modules }, 'Canvas modules retrieved');
}));

/**
 * POST /canvas/courses/:courseId/modules
 * Create a new module in a Canvas course
 */
router.post('/courses/:courseId/modules', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return errorResponse(res, 'Module name is required', 'MISSING_NAME', 400);
  }
  const module = await canvasApiService.createModule(req.user.id, req.params.courseId, name.trim());
  return successResponse(res, {
    module: { id: module.id, name: module.name, position: module.position, itemCount: 0 }
  }, 'Canvas module created', 201);
}));

// ============================================================
// Export to Canvas
// ============================================================

/**
 * POST /canvas/export/:quizId
 * Export quiz to Canvas as an H5P interactive page
 */
router.post('/export/:quizId', asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const { courseId, moduleId } = req.body;

  if (!courseId || !moduleId) {
    return errorResponse(res, 'courseId and moduleId are required', ERROR_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
  }

  // Verify Canvas connection
  const connected = await canvasApiService.hasValidToken(req.user.id);
  if (!connected) {
    return errorResponse(res, 'Please connect to Canvas first', ERROR_CODES.AUTH_ERROR, HTTP_STATUS.UNAUTHORIZED);
  }

  // Load quiz with questions
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: req.user.id })
    .populate({
      path: 'questions',
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives');

  if (!quiz) {
    return errorResponse(res, 'Quiz not found', ERROR_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }

  if (!quiz.questions || quiz.questions.length === 0) {
    return errorResponse(res, 'Quiz has no questions to export', ERROR_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
  }

  // Step 1: Generate H5P package
  const exportId = crypto.randomBytes(8).toString('hex');
  const filename = `${quiz.name.replace(/[^a-zA-Z0-9]/g, '_')}_canvas_${exportId}.h5p`;
  const uploadsDir = path.join('./routes/create/uploads/');
  const filePath = path.join(uploadsDir, filename);
  await fs.mkdir(uploadsDir, { recursive: true });
  await createH5PPackage(quiz, filePath);

  // Step 2: Import into Lumi
  const lumiContentId = await importH5PContent(filePath);

  // Step 3: Generate resource link ID for LTI
  const resourceLinkId = crypto.randomUUID();

  // Step 4: Ensure LTI tool is installed in the course
  const externalToolId = await canvasApiService.ensureLtiToolInstalled(req.user.id, courseId);

  // Step 5: Build LTI launch URL with custom param to identify the quiz
  const ltiPublicUrl = process.env.LTI_PUBLIC_URL || `http://localhost:${process.env.LTI_PORT || 7737}`;
  const launchUrl = `${ltiPublicUrl}/?quizExportId=${resourceLinkId}`;

  // Step 6: Create ExternalTool module item (Canvas launches via LTI)
  const title = `${quiz.name} - Interactive Quiz`;
  const moduleItem = await canvasApiService.createExternalToolModuleItem(
    req.user.id, courseId, moduleId, externalToolId, title, launchUrl
  );

  // Step 7: Store export metadata
  quiz.exports.push({
    format: 'canvas',
    filePath,
    exportedAt: new Date(),
    lumiContentId,
    canvasExport: {
      courseId: String(courseId),
      moduleId: String(moduleId),
      moduleItemId: String(moduleItem.id),
      resourceLinkId,
      exportedAt: new Date()
    }
  });
  await quiz.save();

  // Build a link to the Canvas modules page
  const canvasBaseUrl = process.env.CANVAS_BASE_URL || 'http://localhost';
  const canvasModulesUrl = `${canvasBaseUrl}/courses/${courseId}/modules`;

  return successResponse(res, {
    moduleItemId: moduleItem.id,
    lumiContentId,
    quizName: quiz.name,
    canvasUrl: canvasModulesUrl
  }, 'Quiz exported to Canvas successfully', HTTP_STATUS.CREATED);
}));

export default router;
