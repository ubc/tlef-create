import mongoose from 'mongoose';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.CANVAS_TOKEN_SECRET || process.env.SESSION_SECRET || 'default-encryption-key';

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  const [ivHex, encrypted] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

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
