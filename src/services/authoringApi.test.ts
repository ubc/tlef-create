import { afterEach, expect, it, vi } from 'vitest';
import { studioAssistantApi, studioAuthoringApi } from './api';

vi.mock('../config/api', () => ({ API_URL: 'http://localhost:8051' }));
afterEach(() => vi.unstubAllGlobals());

it('streams the same authenticated authoring resource as the status API', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { session: {} } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  const sessionId = 'a session/identifier';
  await studioAuthoringApi.get(sessionId);
  const statusUrl = new URL(fetch.mock.calls[0][0]);
  const eventsUrl = new URL(studioAuthoringApi.eventsUrl(sessionId));
  expect(statusUrl.pathname).toBe('/api/create/h5p-editor/authoring/sessions/a%20session%2Fidentifier');
  expect(eventsUrl.origin).toBe(statusUrl.origin);
  expect(eventsUrl.pathname).toBe(`${statusUrl.pathname}/events`);
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
});

it('previews checked questions through the page origin when the API uses another port', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { session: {} } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  const sessionId = 'a session/identifier';
  await studioAssistantApi.getSession(sessionId);
  const sessionUrl = new URL(fetch.mock.calls[0][0]);
  const previewPath = studioAssistantApi.previewUrl(sessionId, 3);
  const previewUrl = new URL(previewPath, window.location.href);
  expect(sessionUrl.pathname).toBe('/api/create/h5p-editor/assistant/sessions/a%20session%2Fidentifier');
  expect(previewPath).toMatch(/^\/api\/create\//);
  expect(sessionUrl.origin).toBe('http://localhost:8051');
  expect(previewUrl.origin).toBe(window.location.origin);
  expect(previewUrl.origin).not.toBe(sessionUrl.origin);
  expect(previewUrl.pathname).toBe(`${sessionUrl.pathname}/preview`);
  expect(previewUrl.searchParams.get('v')).toBe('3');
});

it('submits a confirmed clarification as one authenticated message with its original card identity', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { session: {} } }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }));
  vi.stubGlobal('fetch', fetch);
  const body = { requestId: 'confirm-request-123456', revision: 4, text: 'Confirmed teaching choices.',
    clarificationAnswers: { messageId: 'message1', answers: [{ questionIndex: 0, selectedOptions: ['Motion'], customAnswer: 'Forces' }] } };
  await studioAuthoringApi.command('session1', 'message', body);
  expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/api/create/h5p-editor/authoring/sessions/session1/message');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify(body) });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('saves the complete edited objective set with its task and assistant revisions', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { session: {} } }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }));
  vi.stubGlobal('fetch', fetch);
  const body = { requestId: 'objectives-request-123456', revision: 5, assistantRevision: 2,
    objectives: [{ id: 'objective1', text: 'Apply Newton’s first law.' }] };
  await studioAuthoringApi.command('session1', 'save_objectives', body);
  expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/api/create/h5p-editor/authoring/sessions/session1/save_objectives');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify(body) });
  expect(fetch).toHaveBeenCalledTimes(1);
});
