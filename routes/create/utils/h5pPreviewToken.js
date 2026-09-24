import crypto from 'node:crypto';

const DEFAULT_TTL_SECONDS = 5 * 60;

function getSigningSecret() {
  return process.env.H5P_PREVIEW_SIGNING_SECRET
    || process.env.SESSION_SECRET
    || 'tlef-create-local-preview-secret';
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url');
}

export function createH5PPreviewToken({ userId, quizId, questionId }, options = {}) {
  const now = options.now ?? Date.now();
  const payload = Buffer.from(JSON.stringify({
    userId: String(userId),
    quizId: String(quizId),
    questionId: String(questionId),
    expiresAt: now + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyH5PPreviewToken(token, expected = {}, options = {}) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return null;

  const expectedSignature = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const now = options.now ?? Date.now();
  if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) return null;
  for (const key of ['userId', 'quizId', 'questionId']) {
    if (expected[key] !== undefined && String(parsed[key]) !== String(expected[key])) return null;
  }
  return parsed;
}
