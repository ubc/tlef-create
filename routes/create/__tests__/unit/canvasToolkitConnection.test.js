import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { canvasBaseUrl, canvasConfig, createCanvasConnection, CANVAS_SCOPES } from '../../services/canvasToolkitConnection.js';
import CanvasToken from '../../models/CanvasToken.js';
import { createCanvasTokenStore } from '../../services/canvasTokenStore.js';

const config = { canvasDomain: 'https://canvas.example.edu', clientId: 'client', clientSecret: 'test-secret', redirectUri: 'http://localhost:8051/api/create/canvas/oauth/callback' };
const fresh = () => ({ accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: Date.now() + 3600000, canvasUserId: '42' });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
let tokens;
let store;
let connection;
const originalFetch = global.fetch;
beforeEach(() => {
  tokens = fresh();
  store = { get: jest.fn(async () => tokens), set: jest.fn(async (_id, value) => { tokens = value; }), delete: jest.fn(async () => { tokens = null; }) };
  connection = createCanvasConnection({ config, tokenStore: store });
  global.fetch = jest.fn();
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

describe('official UBC Canvas toolkit connection', () => {
  test('supports toolkit domain and legacy local URL with the correct CREATE callback', () => {
    expect(canvasBaseUrl({ CANVAS_DOMAIN: 'ubc.instructure.com', CANVAS_BASE_URL: 'http://localhost' })).toBe('https://ubc.instructure.com');
    expect(canvasBaseUrl({ CANVAS_BASE_URL: 'http://localhost:8080/' })).toBe('http://localhost:8080');
    expect(canvasConfig({}).redirectUri).toBe('http://localhost:8051/api/create/canvas/oauth/callback');
  });
  test('builds the official OAuth URL with state and every export scope', () => {
    const url = new URL(connection.getAuthorizationUrl('random-state'));
    expect(url.pathname).toBe('/login/oauth2/auth');
    expect(url.searchParams.get('state')).toBe('random-state');
    expect(url.searchParams.get('scope').split(' ')).toEqual(CANVAS_SCOPES);
    expect(CANVAS_SCOPES).toContain('url:POST|/api/v1/courses/:course_id/external_tools');
  });
  test('exchanges a code through the real toolkit and preserves omitted refresh tokens', async () => {
    global.fetch.mockResolvedValue(json({ access_token: 'next', expires_in: 3600, user: { id: 42 } }));
    await connection.exchangeCode('code', 'owner');
    expect(tokens.accessToken).toBe('next');
    expect(tokens.refreshToken).toBe('test-refresh');
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://canvas.example.edu/login/oauth2/token');
    expect(options.body).toBeInstanceOf(URLSearchParams);
    expect(options.body.get('grant_type')).toBe('authorization_code');
  });
  test('does not reuse a known different Canvas identity refresh token', async () => {
    global.fetch.mockResolvedValue(json({ access_token: 'next', user: { id: 99 } }));
    await connection.exchangeCode('code', 'owner');
    expect(tokens.refreshToken).toBe('');
  });
  test('shares concurrent refreshes and retains the existing refresh token', async () => {
    tokens.expiresAt = Date.now() - 1;
    global.fetch.mockResolvedValue(json({ access_token: 'renewed', expires_in: 3600 }));
    await Promise.all([connection.getClient('owner'), connection.getClient('owner')]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(tokens.accessToken).toBe('renewed');
    expect(tokens.refreshToken).toBe('test-refresh');
  });
  test('refreshes once after a Canvas API 401 and retries the request', async () => {
    global.fetch.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ access_token: 'renewed' })).mockResolvedValueOnce(json([{ id: 1, name: 'Course', course_code: 'C101' }]));
    const result = await canvas.getCourses(await connection.getClient('owner'));
    expect(result[0].code).toBe('C101');
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer renewed');
  });
  test('follows Canvas pagination rather than silently dropping later courses', async () => {
    global.fetch.mockResolvedValueOnce(json([{ id: 1, name: 'One', course_code: 'ONE' }], 200, { Link: '<https://canvas.example.edu/api/v1/courses?page=2>; rel="next"' })).mockResolvedValueOnce(json([{ id: 2, name: 'Two', course_code: 'TWO' }]));
    expect((await canvas.getCourses(await connection.getClient('owner'))).map(c => c.id)).toEqual(['1', '2']);
  });
  test('refuses a pagination link that would send credentials to another origin', async () => {
    global.fetch.mockResolvedValue(json([], 200, { Link: '<https://other.example/api/v1/courses>; rel="next"' }));
    await expect(canvas.getCourses(await connection.getClient('owner'))).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  test('keeps encrypted credentials recoverable when refresh has a network failure', async () => {
    tokens.expiresAt = 0;
    global.fetch.mockRejectedValue(new Error('offline'));
    await expect(connection.getClient('owner')).rejects.toThrow('offline');
    expect(store.delete).not.toHaveBeenCalled();
  });
  test('clears revoked refresh credentials and requests reconnection', async () => {
    tokens.expiresAt = 0;
    global.fetch.mockResolvedValue(json({ error: 'invalid_grant' }, 400));
    await expect(connection.getClient('owner')).rejects.toMatchObject({ code: 'CANVAS_RECONNECT_REQUIRED' });
    expect(store.delete).toHaveBeenCalledWith('owner');
  });
  test('does not send an expired token with no refresh token', async () => {
    tokens.expiresAt = 0; tokens.refreshToken = '';
    await expect(connection.getClient('owner')).rejects.toMatchObject({ code: 'CANVAS_RECONNECT_REQUIRED' });
    expect(await connection.hasValidToken('owner')).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('revokes the Canvas grant before clearing local storage on disconnect', async () => {
    global.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    await connection.disconnect('owner');
    expect(global.fetch.mock.calls[0][1].method).toBe('DELETE');
    expect(store.delete).toHaveBeenCalledWith('owner');
  });
  test('allows local disconnect when remote revocation cannot be confirmed', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    expect(await connection.disconnect('owner')).toEqual({ revoked: false });
    expect(store.delete).toHaveBeenCalledWith('owner');
  });
});

describe('CREATE encrypted token storage adapter', () => {
  test('reads existing encrypted token records without double-decrypting', async () => {
    const record = new CanvasToken({ user: '507f1f77bcf86cd799439011', accessToken: 'test:access:with:colons', refreshToken: 'test:refresh:with:colons', expiresAt: new Date(Date.now() + 3600000), canvasBaseUrl: config.canvasDomain });
    expect(record.get('accessToken', null, { getters: false })).not.toBe('test:access:with:colons');
    jest.spyOn(CanvasToken, 'findOne').mockResolvedValue(record);
    const result = await createCanvasTokenStore(config.canvasDomain).get('owner');
    expect(result.accessToken).toBe('test:access:with:colons');
    expect(record.getAccessToken()).toBe(result.accessToken);
    expect(record.getRefreshToken()).toBe(result.refreshToken);
  });
  test('refuses tokens issued by a different Canvas host', async () => {
    jest.spyOn(CanvasToken, 'findOne').mockResolvedValue({ canvasBaseUrl: 'https://different.example' });
    expect(await createCanvasTokenStore(config.canvasDomain).get('owner')).toBeNull();
  });
});
