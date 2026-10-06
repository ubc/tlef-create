import { beforeEach, afterEach, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import session from 'express-session';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';

const exchangeCode = jest.fn();
const listCourses = jest.fn();
const hasValidToken = jest.fn().mockResolvedValue(true);
let currentUser = 'owner';
jest.unstable_mockModule('../../middleware/auth.js', () => ({ authenticateToken: (req, res, next) => { if (!currentUser) return res.sendStatus(401); req.user = { id: currentUser }; next(); } }));
jest.unstable_mockModule('../../services/canvasApiService.js', () => ({
  isConfigured: () => true, getBaseUrl: () => 'https://canvas.example.edu',
  getAuthorizationUrl: state => `https://canvas.example.edu/login/oauth2/auth?state=${state}`,
  exchangeCode, listCourses, hasValidToken, getClient: jest.fn()
}));
jest.unstable_mockModule('../../services/lumiService.js', () => ({ importH5PContent: jest.fn(), renderContent: jest.fn() }));
jest.unstable_mockModule('../../services/h5pExportService.js', () => ({ createH5PPackage: jest.fn() }));
jest.unstable_mockModule('../../services/mixedActivityService.js', () => ({ createMixedActivitySnapshot: jest.fn(), validateMixedActivitySnapshot: jest.fn() }));
const { default: router } = await import('../../controllers/canvasController.js');
const { default: materialImports } = await import('../../services/canvasMaterialImportService.js');
let agent;
let sessions;
const originalLtiClientId = process.env.LTI_CLIENT_ID;
const originalLtiPublicUrl = process.env.LTI_PUBLIC_URL;
beforeEach(() => {
  jest.clearAllMocks(); hasValidToken.mockResolvedValue(true); currentUser = 'owner';
  sessions = new session.MemoryStore();
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'local-test-session-secret', resave: false, saveUninitialized: false, store: sessions }));
  app.use('/canvas', router);
  agent = request.agent(app);
});
afterEach(() => {
  jest.restoreAllMocks();
  sessions.clear();
  if (originalLtiClientId === undefined) delete process.env.LTI_CLIENT_ID;
  else process.env.LTI_CLIENT_ID = originalLtiClientId;
  if (originalLtiPublicUrl === undefined) delete process.env.LTI_PUBLIC_URL;
  else process.env.LTI_PUBLIC_URL = originalLtiPublicUrl;
});
async function connect() {
  const response = await agent.get('/canvas/auth/connect').expect(200);
  return new URL(response.body.data.authUrl).searchParams.get('state');
}
test('preserves the connect/callback URLs and consumes persisted OAuth state', async () => {
  const state = await connect();
  await agent.get('/canvas/oauth/callback').query({ state, code: 'test-code' }).expect(302);
  expect(exchangeCode).toHaveBeenCalledWith('test-code', 'owner');
  await agent.get('/canvas/oauth/callback').query({ state, code: 'test-code' }).expect(403);
  expect(exchangeCode).toHaveBeenCalledTimes(1);
});
test('rejects invalid state before calling the toolkit', async () => {
  await connect();
  await agent.get('/canvas/oauth/callback').query({ state: 'wrong', code: 'code' }).expect(403);
  expect(exchangeCode).not.toHaveBeenCalled();
});
test('rejects a callback after the signed-in CREATE user changes', async () => {
  const state = await connect(); currentUser = 'other';
  await agent.get('/canvas/oauth/callback').query({ state, code: 'code' }).expect(403);
  expect(exchangeCode).not.toHaveBeenCalled();
});
test('consumes cancelled authorization without saving tokens', async () => {
  const state = await connect();
  const response = await agent.get('/canvas/oauth/callback').query({ state, error: 'access_denied' }).expect(302);
  expect(response.headers.location).toContain('error=access_denied');
  expect(exchangeCode).not.toHaveBeenCalled();
  await agent.get('/canvas/oauth/callback').query({ state, code: 'code' }).expect(403);
});
test('Canvas expiry does not send the CREATE-login-expired status', async () => {
  listCourses.mockRejectedValueOnce(new canvas.CanvasApiError('Unauthorized', 401));
  const response = await agent.get('/canvas/courses').expect(409);
  expect(response.body.error.code).toBe('CANVAS_RECONNECT_REQUIRED');
});
test('reports a Developer Key permission error without exposing Canvas response content', async () => {
  listCourses.mockRejectedValueOnce(new canvas.CanvasApiError('private upstream detail', 403));
  const response = await agent.get('/canvas/courses').expect(403);
  expect(response.body.error.message).toContain('permission');
  expect(JSON.stringify(response.body)).not.toContain('private upstream detail');
});

test('export without a Canvas connection preserves the CREATE login', async () => {
  hasValidToken.mockResolvedValueOnce(false);
  const response = await agent.post('/canvas/export/507f1f77bcf86cd799439011').send({ courseId: '2', moduleId: '8' }).expect(409);
  expect(response.body.error.code).toBe('CANVAS_RECONNECT_REQUIRED');
});

test('export reports missing LTI configuration before preparing content', async () => {
  delete process.env.LTI_CLIENT_ID;
  const response = await agent.post('/canvas/export/507f1f77bcf86cd799439011').send({ courseId: '2', moduleId: '8' }).expect(503);
  expect(response.body.error.code).toBe('CANVAS_LTI_NOT_CONFIGURED');
});

test('Canvas routes report an unavailable LTI tool as a recoverable setup error', async () => {
  listCourses.mockRejectedValueOnce(Object.assign(new Error('Canvas setup failure'), { code: 'CANVAS_LTI_TOOL_UNAVAILABLE' }));
  const response = await agent.get('/canvas/courses').expect(409);
  expect(response.body.error.code).toBe('CANVAS_LTI_TOOL_UNAVAILABLE');
});

test('material import endpoints stay behind CREATE authentication', async () => {
  currentUser = null;
  const catalog = jest.spyOn(materialImports, 'catalog');
  await agent.get('/canvas/material-import/courses/2/materials?folderId=folder').expect(401);
  await agent.post('/canvas/material-import/courses/2/materials').send({ folderId: 'folder', resources: [] }).expect(401);
  expect(catalog).not.toHaveBeenCalled();
});
test('passes only the signed-in user and requested CREATE course to material selection', async () => {
  jest.spyOn(materialImports, 'catalog').mockResolvedValue({ resources: [], warnings: [], batchLimit: 10 });
  await agent.get('/canvas/material-import/courses/2/materials?folderId=folder').expect(200);
  expect(materialImports.catalog).toHaveBeenCalledWith('owner', 'folder', '2');
});
test('returns partial per-material results without treating the whole batch as failed', async () => {
  const result = { results: [{ id: '4', status: 'imported' }, { id: '5', status: 'failed' }], summary: { imported: 1, skipped: 0, failed: 1 } };
  jest.spyOn(materialImports, 'importBatch').mockResolvedValue(result);
  const response = await agent.post('/canvas/material-import/courses/2/materials').send({ folderId: 'folder', resources: [{ id: '4', resourceType: 'file' }] }).expect(200);
  expect(response.body.data).toEqual(result);
  expect(materialImports.importBatch).toHaveBeenCalledWith('owner', 'folder', '2', [{ id: '4', resourceType: 'file' }]);
});
test('material import Canvas expiry returns 409 and never exposes upstream private details', async () => {
  jest.spyOn(materialImports, 'courses').mockRejectedValue(new canvas.CanvasApiError('private credential detail', 401));
  const response = await agent.get('/canvas/material-import/courses?folderId=folder').expect(409);
  expect(response.body.error.code).toBe('CANVAS_RECONNECT_REQUIRED');
  expect(JSON.stringify(response.body)).not.toContain('private');
});
