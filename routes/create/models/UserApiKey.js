import mongoose from 'mongoose';

import { encrypt, decrypt } from '../services/encryptionService.js';

// TODO: Define SUPPORTED_PROVIDERS array: openai, anthropic, google.
//       This will be used as the enum for the provider field.
const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'google'];
const userApiKeySchema = new mongoose.Schema({
  // TODO: user field — ObjectId reference to User, required, indexed.
  //       Unlike CanvasToken, do NOT add unique: true here because one user
  //       can have multiple keys (one per provider).
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // TODO: provider field — String enum from SUPPORTED_PROVIDERS, required.
  //       This tells LiteLLM which backend to route to.
  provider: {
    type: String,
    enum: SUPPORTED_PROVIDERS,
    required: true
  },
  modelName: {
    type: String,
    required: true,
    trim: true
  },
  // TODO: encryptedKey field — String, required.
  //       Use Mongoose setter to encrypt on save, getter to decrypt on read.
  //       Mirror the pattern in CanvasToken.js accessToken field.
  encryptedKey: {
    type: String,
    required: true,
    set: encrypt,
    get: decrypt
  },
  // TODO: label field — optional String so the user can name their key
  //       (e.g. "My personal OpenAI key"). Useful when listed in Settings UI.
  label: {
    type: String,
    trim: true
  },
  // TODO: keyHint field — optional String, store only the last 4 characters
  //       of the original key (plain text, not encrypted) so the UI can show
  //       something like "sk-...ab12" without exposing the full key.
  keyHint: {
    type: String,
    maxlength: 4
  },
  // TODO: isActive field — Boolean, default true.
  //       Allows disabling a key without deleting it.
  isActive: {
    type: Boolean,
    default: true
  },
  // TODO: lastUsedAt field — Date, default null.
  //       Update this each time the key is used to call an LLM.
  lastUsedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  collection: 'user_api_keys',
  // TODO: Configure toJSON and toObject so getters are applied correctly
  //       but the decrypted key is never included in JSON responses.
  //       Reference CanvasToken.js toJSON/toObject options.
  toJSON: { getters: false }, // Don't decrypt when serializing
  toObject: { getters: true }
});

// TODO: Add a compound index on (user, provider) to enforce one key per
//       provider per user at the database level.
userApiKeySchema.index({ user: 1, provider: 1 }, { unique: true });
// TODO: Add an instance method getDecryptedKey() that returns the decrypted
//       API key. This is the only place the full key should be exposed,
//       and only used server-side when making LLM calls.
userApiKeySchema.methods.getDecryptedKey = function() {
  return decrypt(this.encryptedKey);
}
// TODO: Add a static method findActiveKeyForUser(userId, provider) that
//       queries for an active key matching the user and provider.
userApiKeySchema.statics.findActiveKeyForUser = function(userId, provider) {
  return this.findOne({ user: userId, provider: provider, isActive: true });
}
export default mongoose.model('UserApiKey', userApiKeySchema);
