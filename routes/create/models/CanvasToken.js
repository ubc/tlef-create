import mongoose from 'mongoose';
import { encrypt, decrypt } from '../services/encryptionService.js';

const canvasTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  accessToken: {
    type: String,
    required: true,
    set: encrypt,
    get: decrypt
  },
  refreshToken: {
    type: String,
    set: encrypt,
    get: decrypt
  },
  expiresAt: {
    type: Date,
    required: true
  },
  canvasBaseUrl: {
    type: String,
    required: true
  }
}, {
  timestamps: true,
  collection: 'canvas_tokens',
  toJSON: { getters: false }, // Don't decrypt when serializing
  toObject: { getters: true }
});

canvasTokenSchema.methods.isExpired = function () {
  return new Date() >= this.expiresAt;
};

canvasTokenSchema.methods.needsRefresh = function () {
  // Refresh if expires within 5 minutes
  const fiveMinutes = 5 * 60 * 1000;
  return new Date() >= new Date(this.expiresAt.getTime() - fiveMinutes);
};

canvasTokenSchema.methods.getAccessToken = function () {
  return decrypt(this.accessToken);
};

canvasTokenSchema.methods.getRefreshToken = function () {
  return this.refreshToken ? decrypt(this.refreshToken) : null;
};

export default mongoose.model('CanvasToken', canvasTokenSchema);
