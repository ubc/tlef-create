import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';

// Exercise the installed toolkit, not a reimplementation of Canvas downloads.
const originalFetch = global.fetch;
const json = (body, options = {}) => new Response(JSON.stringify(body), {
  ...options, headers: { 'Content-Type': 'application/json', ...options.headers }
});
const metadata = (overrides = {}) => ({
  id: 4, filename: 'lesson.pdf', size: 4, 'content-type': 'application/pdf',
  url: 'https://canvas.example.edu/files/4/download', ...overrides
});
const bytes = (headers = {}) => new Response(new Uint8Array([37, 80, 68, 70]), {
  headers: { 'Content-Type': 'application/pdf', ...headers }
});
let client;
beforeEach(() => {
  global.fetch = jest.fn();
  client = canvas.createApiClient({ canvasDomain: 'https://canvas.example.edu', accessToken: 'synthetic-test-token' });
});
afterEach(() => { global.fetch = originalFetch; });

test('lists course files beyond the first page and preserves source identity', async () => {
  global.fetch.mockResolvedValueOnce(json([metadata()], {
    headers: { Link: '<https://canvas.example.edu/api/v1/courses/2/files?page=2>; rel="next"' }
  })).mockResolvedValueOnce(json([metadata({ id: 5, filename: 'second.pdf' })]));
  expect(await canvas.getCourseFiles(client, '2')).toMatchObject([
    { id: '4', courseId: '2', filename: 'lesson.pdf', mimeType: 'application/pdf' },
    { id: '5', courseId: '2', filename: 'second.pdf' }
  ]);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('verifies course membership before issuing a signed download without credentials', async () => {
  global.fetch.mockResolvedValueOnce(json(metadata()))
    .mockResolvedValueOnce(json({ public_url: 'https://qa.s3.amazonaws.com/lesson.pdf?synthetic=1' }))
    .mockResolvedValueOnce(bytes());
  expect(await canvas.downloadFile(client, '2', '4', { via: 'public-url', maxBytes: 100 })).toMatchObject({ size: 4, filename: 'lesson.pdf' });
  expect(global.fetch.mock.calls[0][0].pathname).toBe('/api/v1/courses/2/files/4');
  const [, request] = global.fetch.mock.calls[2];
  expect(request.headers.Authorization).toBeUndefined();
  expect(request.credentials).toBe('omit');
});

test('does not download a file refused by the course-scoped lookup', async () => {
  global.fetch.mockResolvedValueOnce(json({ errors: [{ message: 'Not Found' }] }, { status: 404 }));
  await expect(canvas.downloadFile(client, '2', '999', { via: 'public-url' })).rejects.toMatchObject({ statusCode: 404 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('preserves a missing-permission failure instead of reporting an empty course', async () => {
  global.fetch.mockResolvedValueOnce(json({ errors: [{ message: 'Forbidden' }] }, { status: 403 }));
  await expect(canvas.getCourseFiles(client, '2')).rejects.toMatchObject({ statusCode: 403 });
});

test.each([true, false])('rejects oversized bytes with declared content-length=%s', async declared => {
  global.fetch.mockResolvedValueOnce(json(metadata())).mockResolvedValueOnce(bytes(declared ? { 'Content-Length': '4' } : {}));
  await expect(canvas.downloadFile(client, '2', '4', { maxBytes: 1 })).rejects.toMatchObject({ statusCode: 413 });
});

test('rejects a partial download instead of accepting corrupt source material', async () => {
  global.fetch.mockResolvedValueOnce(json(metadata({ size: 8 }))).mockResolvedValueOnce(bytes());
  await expect(canvas.downloadFile(client, '2', '4')).rejects.toMatchObject({ statusCode: 502 });
});

test('rejects a login HTML response masquerading as a downloaded file', async () => {
  global.fetch.mockResolvedValueOnce(json(metadata())).mockResolvedValueOnce(new Response('<html>Sign in</html>', {
    headers: { 'Content-Type': 'text/html' }
  }));
  await expect(canvas.downloadFile(client, '2', '4')).rejects.toMatchObject({ statusCode: 502 });
});

test('refuses a file download URL outside approved Canvas storage hosts', async () => {
  global.fetch.mockResolvedValueOnce(json(metadata({ url: 'https://attacker.example/lesson.pdf' })));
  await expect(canvas.downloadFile(client, '2', '4')).rejects.toMatchObject({ statusCode: 502 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
