import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import CanvasToken from '../models/CanvasToken.js';

// Adapt the existing encrypted collection to the toolkit TokenStore contract.
// Credentials issued by one Canvas instance must never be sent to another.
export function createCanvasTokenStore(baseUrl) {
  return {
    async get(userId) {
      const record = await CanvasToken.findOne({ user: userId });
      if (!record || canvas.baseUrl(record.canvasBaseUrl) !== baseUrl) return null;
      return {
        accessToken: record.accessToken,
        refreshToken: record.refreshToken || '',
        expiresAt: record.expiresAt.getTime(),
        canvasUserId: record.canvasUserId || ''
      };
    },
    async set(userId, tokens) {
      await CanvasToken.findOneAndUpdate({ user: userId }, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || null,
        expiresAt: new Date(tokens.expiresAt),
        canvasUserId: tokens.canvasUserId,
        canvasBaseUrl: baseUrl
      }, { upsert: true, new: true, runValidators: true });
    },
    async delete(userId) {
      await CanvasToken.deleteOne({ user: userId });
    }
  };
}
