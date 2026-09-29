import { beforeAll, beforeEach, afterEach, afterAll, expect, jest, test } from '@jest/globals';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import CanvasToken from '../../models/CanvasToken.js';

const environment = Object.fromEntries(['CANVAS_DOMAIN', 'CANVAS_CLIENT_ID', 'CANVAS_CLIENT_SECRET', 'LTI_CLIENT_ID'].map(key => [key, process.env[key]]));
let service;
const originalFetch = global.fetch;
const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...headers } });
beforeAll(async () => {
  Object.assign(process.env, { CANVAS_DOMAIN: 'canvas.example.edu', CANVAS_CLIENT_ID: 'test-client', CANVAS_CLIENT_SECRET: 'test-secret', LTI_CLIENT_ID: '10000000000002' });
  service = await import('../../services/canvasApiService.js');
});
beforeEach(() => {
  jest.spyOn(CanvasToken, 'findOne').mockResolvedValue(new CanvasToken({
    user: '507f1f77bcf86cd799439011', accessToken: 'test-token', expiresAt: new Date(Date.now() + 3600000), canvasBaseUrl: 'https://canvas.example.edu'
  }));
  global.fetch = jest.fn();
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
afterAll(() => { for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

test('preserves the frontend course response while using toolkit normalized courses', async () => {
  global.fetch.mockResolvedValue(json([{ id: 7, name: 'Physics', course_code: 'PHYS', term: { name: 'Winter' } }]));
  expect(await service.listCourses('owner')).toEqual([{ id: 7, name: 'Physics', courseCode: 'PHYS', term: 'Winter' }]);
});
test('loads all module pages through the toolkit client', async () => {
  global.fetch.mockResolvedValueOnce(json([{ id: 1, name: 'First', position: 1, items_count: 2 }], { Link: '<https://canvas.example.edu/api/v1/courses/7/modules?page=2>; rel="next"' })).mockResolvedValueOnce(json([{ id: 2, name: 'Second', position: 2, items_count: 3 }]));
  expect(await service.listModules('owner', '7')).toEqual([{ id: 1, name: 'First', position: 1, itemCount: 2 }, { id: 2, name: 'Second', position: 2, itemCount: 3 }]);
});
test('creates a module using the official authenticated API client', async () => {
  global.fetch.mockResolvedValue(json({ id: 8 }));
  await service.createModule('owner', '7', 'Lesson');
  const [url, request] = global.fetch.mock.calls[0];
  expect(url.pathname).toBe('/api/v1/courses/7/modules');
  expect(request.method).toBe('POST');
  expect(request.headers.Authorization).toBe('Bearer test-token');
  expect(JSON.parse(request.body)).toEqual({ module: { name: 'Lesson', published: true } });
});
test('finds an installed LTI tool beyond the first page without installing a duplicate', async () => {
  global.fetch.mockResolvedValueOnce(json([], { Link: '<https://canvas.example.edu/api/v1/courses/7/external_tools?page=2>; rel="next"' })).mockResolvedValueOnce(json([{ id: 9, developer_key_id: '10000000000002' }]));
  expect(await service.ensureLtiToolInstalled('owner', '7')).toBe(9);
  expect(global.fetch.mock.calls.every(([, req]) => req.method === 'GET')).toBe(true);
});
test('reports a missing Canvas LTI installation without hiding upstream failures', async () => {
  global.fetch.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json([]))
    .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'Invalid client ID' }] }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  await expect(service.ensureLtiToolInstalled('owner', '7')).rejects.toMatchObject({ code: 'CANVAS_LTI_TOOL_UNAVAILABLE' });

  global.fetch.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json([]))
    .mockRejectedValueOnce(new canvas.CanvasApiError('Canvas unavailable', 503));
  await expect(service.ensureLtiToolInstalled('owner', '7')).rejects.toMatchObject({ statusCode: 503 });
});
test('creates the existing LTI launch module item through the toolkit', async () => {
  global.fetch.mockResolvedValue(json({ id: 10 }));
  await service.createExternalToolModuleItem('owner', '7', '8', 9, 'Lesson', 'https://create.example/?quizExportId=test');
  const [url, request] = global.fetch.mock.calls[0];
  expect(url.pathname).toBe('/api/v1/courses/7/modules/8/items');
  expect(JSON.parse(request.body).module_item).toMatchObject({ type: 'ExternalTool', content_id: 9, new_tab: false });
});
