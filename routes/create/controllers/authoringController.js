import express from 'express';
import { streamAuthoringSession } from '../services/authoring/authoringStream.js';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '../middleware/auth.js';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import { createAuthoringSession, listAuthoringSessions, readAuthoringSession, authoringCommand, cancelAuthoringRun } from '../services/authoring/authoringService.js';

const router = express.Router();
router.use(authenticateToken);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
const writes = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => String(req.user.id), message: { success: false, error: { message: 'Please wait a moment before sending another request.' } } });
const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) { errorResponse(res, error.status ? error.message : 'This request could not be completed. Refresh the saved task before retrying.', error.status ? error.code || 'AUTHORING_CONFLICT' : 'AUTHORING_FAILED', error.status || 500); }
};
router.get('/sessions', handle(async (req, res) => successResponse(res, { sessions: await listAuthoringSessions(String(req.user.id)) })));
router.post('/sessions', writes, handle(async (req, res) => successResponse(res, { session: await createAuthoringSession(String(req.user.id), req.body || {}) }, 'Task saved.', 202)));
router.get('/sessions/:id', handle(async (req, res) => successResponse(res, { session: await readAuthoringSession(String(req.user.id), req.params.id) })));
router.get('/sessions/:id/events', handle(async (req, res) => {
  await streamAuthoringSession(req, res);
}));
router.post('/sessions/:id/cancel', writes, handle(async (req, res) => successResponse(res, { session: await cancelAuthoringRun(String(req.user.id), req.params.id, req.body || {}) })));
router.post('/sessions/:id/:command', writes, handle(async (req, res) => successResponse(res, { session: await authoringCommand(String(req.user.id), req.params.id, req.params.command, req.body || {}) }, 'Request saved.', 202)));
export default router;
