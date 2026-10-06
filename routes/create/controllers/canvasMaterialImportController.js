import express from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import imports, { canvasImportFailure } from '../services/canvasMaterialImportService.js';

// Mounted behind Canvas authentication. All course ownership checks are in the service.
const router = express.Router();
router.get('/courses', asyncHandler(async (req, res) => {
  const courses = await imports.courses(req.user.id, req.query.folderId);
  return successResponse(res, { courses }, 'Canvas teaching courses');
}));
router.get('/courses/:courseId/materials', asyncHandler(async (req, res) => {
  const catalog = await imports.catalog(req.user.id, req.query.folderId, req.params.courseId);
  return successResponse(res, catalog, 'Canvas material selection');
}));
router.post('/courses/:courseId/materials', asyncHandler(async (req, res) => {
  const result = await imports.importBatch(req.user.id, req.body.folderId, req.params.courseId, req.body.resources);
  return successResponse(res, result, 'Canvas import results');
}));
router.use((error, _req, res, _next) => {
  const safe = canvasImportFailure(error);
  const status = safe.code === 'CANVAS_RECONNECT_REQUIRED' ? 409
    : error.status || (error.statusCode === 403 ? 403 : 502);
  return errorResponse(res, safe.message, safe.code, status);
});
export default router;
