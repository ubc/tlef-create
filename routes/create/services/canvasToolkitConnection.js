import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';

// CREATE owns the session and encrypted storage; UBC owns the Canvas protocol.
export const CANVAS_SCOPES = [
  'url:GET|/api/v1/courses',
  'url:GET|/api/v1/courses/:course_id/modules',
  'url:POST|/api/v1/courses/:course_id/modules',
  'url:POST|/api/v1/courses/:course_id/pages',
  'url:POST|/api/v1/courses/:course_id/modules/:module_id/items',
  'url:GET|/api/v1/courses/:course_id/external_tools',
  'url:GET|/api/v1/accounts/:account_id/external_tools',
  'url:POST|/api/v1/courses/:course_id/external_tools'
];

export function canvasBaseUrl(env = process.env) {
  return canvas.baseUrl(env.CANVAS_DOMAIN || env.CANVAS_BASE_URL || 'https://canvas.instructure.com');
}

export function canvasConfig(env = process.env) {
  return {
    canvasDomain: canvasBaseUrl(env),
    clientId: env.CANVAS_CLIENT_ID,
    clientSecret: env.CANVAS_CLIENT_SECRET,
    redirectUri: env.CANVAS_REDIRECT_URI || `http://localhost:${env.PORT || 8051}/api/create/canvas/oauth/callback`
  };
}

function disconnected() {
  return Object.assign(new Error('Please reconnect your Canvas account.'), { status: 401, code: 'CANVAS_RECONNECT_REQUIRED' });
}

export function createCanvasConnection({ config, tokenStore }) {
  const refreshes = new Map();
  async function refresh(userId, rejectedAccessToken) {
    if (refreshes.has(userId)) return refreshes.get(userId);
    const work = (async () => {
      const previous = await tokenStore.get(userId);
      if (!previous) throw disconnected();
      // Another request may already have refreshed the rejected token.
      if (rejectedAccessToken && previous.accessToken !== rejectedAccessToken && previous.expiresAt > Date.now()) return previous;
      if (!previous.refreshToken) throw disconnected();
      try {
        const result = await canvas.refreshTokens(config, previous.refreshToken);
        const tokens = { ...previous, ...result, refreshToken: result.refreshToken ?? previous.refreshToken };
        await tokenStore.set(userId, tokens);
        return tokens;
      } catch (error) {
        // A network outage must not erase a recoverable connection.
        if (error instanceof canvas.CanvasOAuthError && error.canvasError === 'invalid_grant') {
          await tokenStore.delete(userId);
          throw disconnected();
        }
        throw error;
      }
    })();
    refreshes.set(userId, work);
    try { return await work; } finally { refreshes.delete(userId); }
  }

  return {
    getAuthorizationUrl: state => canvas.buildAuthorizeUrl(config, { state, scopes: CANVAS_SCOPES }),
    async exchangeCode(code, userId) {
      const previous = await tokenStore.get(userId);
      const result = await canvas.exchangeCodeForTokens(config, code);
      const sameIdentity = previous?.canvasUserId && previous.canvasUserId === result.canvasUserId;
      await tokenStore.set(userId, {
        ...result,
        refreshToken: result.refreshToken ?? (sameIdentity ? previous?.refreshToken : undefined) ?? ''
      });
    },
    async getClient(userId) {
      let tokens = await tokenStore.get(userId);
      if (!tokens) throw disconnected();
      if (tokens.expiresAt <= Date.now() + 60_000 && tokens.refreshToken) tokens = await refresh(userId);
      if (tokens.expiresAt <= Date.now()) throw disconnected();
      return canvas.createApiClient({
        canvasDomain: config.canvasDomain,
        accessToken: tokens.accessToken,
        onUnauthorized: async () => (await refresh(userId, tokens.accessToken)).accessToken
      });
    },
    async hasValidToken(userId) {
      const tokens = await tokenStore.get(userId);
      return Boolean(tokens && (tokens.expiresAt > Date.now() || tokens.refreshToken));
    },
    async disconnect(userId) {
      const tokens = await tokenStore.get(userId);
      let revoked = false;
      if (tokens) {
        // Match the toolkit logout contract: already-expired tokens must not
        // prevent removal of the local connection. Remote revocation is best effort.
        try { await canvas.revokeToken(config, tokens.accessToken); revoked = true; }
        catch { /* Canvas may already have invalidated this grant. */ }
      }
      await tokenStore.delete(userId);
      return { revoked };
    }
  };
}
