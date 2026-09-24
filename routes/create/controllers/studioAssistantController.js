import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import { getAssistantQuestionTypes, ASSISTANT_LIMITS } from '../services/studioAssistantPlanning.js';
import { createAssistantSession, listAssistantSessions, readAssistantSession, updateAssistantPlan,
  approveAssistantPlan, resumeAssistantSession, assistantPreviewDocument } from '../services/studioAssistantService.js';
import { renderNativeH5PPreview } from '../services/h5pNativePreviewService.js';

const router = express.Router();
router.use(authenticateToken);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    return errorResponse(res, error.status ? error.message : 'The assistant could not complete this request. Reload the saved task to check its status.',
      error.status ? error.code : 'STUDIO_ASSISTANT_FAILED', error.status || 500);
  }
};

router.get('/capabilities', handle(async (_req, res) => successResponse(res, {
  questionTypes: getAssistantQuestionTypes().map(type => ({ type: type.questionType, title: type.label, library: type.library })),
  maxObjectives: ASSISTANT_LIMITS.objectives, maxPlanRows: ASSISTANT_LIMITS.planRows,
  maxQuestions: ASSISTANT_LIMITS.questions, maxMaterials: ASSISTANT_LIMITS.materials
})));
router.get('/sessions', handle(async (req, res) => successResponse(res, { sessions: await listAssistantSessions(String(req.user.id)) })));
router.post('/sessions', handle(async (req, res) => successResponse(res, { session: await createAssistantSession(req.user, req.body || {}) }, 'Assistant task started.', 202)));
router.get('/sessions/:id', handle(async (req, res) => successResponse(res, { session: await readAssistantSession(String(req.user.id), req.params.id) })));
router.put('/sessions/:id/plan', handle(async (req, res) => successResponse(res, { session: await updateAssistantPlan(req.user, req.params.id, req.body || {}) })));
router.post('/sessions/:id/approve', handle(async (req, res) => successResponse(res, { session: await approveAssistantPlan(req.user, req.params.id, req.body || {}) }, 'Approved generation started.', 202)));
router.post('/sessions/:id/resume', handle(async (req, res) => successResponse(res, { session: await resumeAssistantSession(req.user, req.params.id, req.body || {}) }, 'Explicit retry started.', 202)));
router.get('/sessions/:id/preview', handle(async (req, res) => {
  const document = await assistantPreviewDocument(String(req.user.id), req.params.id);
  const html = await renderNativeH5PPreview(document);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'");
  res.type('html').send(html);
}));
export default router;
