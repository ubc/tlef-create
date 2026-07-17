import express from 'express';
import UserApiKey from '../models/UserApiKey.js';
import { authenticateToken, attachUser } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse, errorResponse, notFoundResponse, forbiddenResponse } from '../utils/responseFormatter.js';
const router = express.Router();

const ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6'
];

const GOOGLE_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-pro'
];

const OPENAI_MODELS = [
  'gpt-4o-mini',
  'gpt-5.4-nano',
  'gpt-5.4-mini',
  'gpt-5.6-luna'
];

function detectProviderFromKey(key) {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-')) return 'openai';
  if (key.startsWith('AIza')) return 'google';
  return null;
}

// POST /apiKey/models
// Detect provider from key and return available models.
router.post('/models', authenticateToken, asyncHandler(async (req, res) => {
  const { key } = req.body;
  if (!key) return errorResponse(res, 'API key is required', 'MISSING_KEY', 400);

  const provider = detectProviderFromKey(key);
  if (!provider) {
    return errorResponse(res, 'Unable to detect provider from this API key format', 'UNKNOWN_PROVIDER', 400);
  }

  if (provider === 'anthropic') {
    return successResponse(res, { provider, models: ANTHROPIC_MODELS }, 'Models retrieved');
  }

  if (provider === 'google') {
    return successResponse(res, { provider, models: GOOGLE_MODELS }, 'Models retrieved');
  }

  // OpenAI — validate the key, then return the product-supported model choices.
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!response.ok) {
      return errorResponse(res, 'Invalid OpenAI API key or insufficient permissions', 'INVALID_KEY', 401);
    }

    return successResponse(res, { provider, models: OPENAI_MODELS }, 'Models retrieved');
  } catch {
    return errorResponse(res, 'Failed to fetch models from OpenAI', 'FETCH_ERROR', 500);
  }
}));

// TODO: POST /api-keys
// Create a new API key for the logged-in user.
// - Extract provider, key, and label from request body
// - Extract keyHint from the last 4 characters of the key before encrypting
// - Save a new UserApiKey document (encryption happens automatically via setter)
// - Return the saved document without the encrypted key
router.post('/', authenticateToken, attachUser, asyncHandler(async (req, res) => {
    const { provider, key, label, modelName } = req.body;
    const keyHint = key.slice(-4);
    const apiKey = new UserApiKey({
        user: req.user.id,
        provider: provider,
        encryptedKey: key,
        modelName: modelName,
        label: label,
        keyHint: keyHint,
        isActive: true
    });

    const savedKey = await apiKey.save();
    const response = savedKey.toJSON();
    const filtered = {                                                                                                                                                                            
        _id: response._id,
        provider: response.provider,                                                                                                                                                                
        label: response.label,                                  
        keyHint: response.keyHint,
        isActive: response.isActive,
        createdAt: response.createdAt
    };
    return successResponse(res, { apiKey: filtered }, 'LLM API key created successfully');

}));

// TODO: GET /api-keys
// Return all API keys belonging to the logged-in user.
// - Query UserApiKey by user ID
// - Do NOT return the encrypted key field — only return keyHint, provider, label, isActive, lastUsedAt
router.get('/', authenticateToken, attachUser, asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const apiKeys = await UserApiKey.find({user: userId}).select('-encryptedKey');

    // Include env key info for admins or users with canUseEnvKey permission
    const user = req.user.fullUser || await (await import('../models/User.js')).default.findById(userId);
    const adminCwls = (process.env.ADMIN_CWLS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const isAdmin = adminCwls.some(a => [user?.cwlId, user?.email?.split('@')[0]].filter(Boolean).map(s => s.toLowerCase()).includes(a));

    let envKey = null;
    if (isAdmin || user?.canUseEnvKey) {
        const provider = process.env.LLM_PROVIDER || 'openai';
        const modelName = process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'gpt-4o-mini';
        envKey = { provider, modelName, isEnvKey: true };
    }

    return successResponse(res, { apiKeys, envKey }, 'Get LLM api keys successfully');
}));

// TODO: PATCH /api-keys/:id
// Update label or isActive for a specific key.
// - Only allow updating label and isActive fields (not provider or the key itself)
// - Verify the key belongs to the logged-in user before updating
router.patch('/:id', authenticateToken, attachUser, asyncHandler(async (req, res) => {
    const apiKeyId = req.params.id;
    const userId = req.user.id;
    const {label, isActive} = req.body;

    const apiKey = await UserApiKey.findOne({user: userId, _id: apiKeyId});
    if (!apiKey) {
        return notFoundResponse(res, 'ApiKey');
    }

    if (label !== undefined) {
        apiKey.label = label.trim()
    }
    if (isActive !== undefined) {
        apiKey.isActive = isActive
    }
    await apiKey.save()
    return successResponse(res, { apiKey }, 'Patched apiKey label or isActive field');
}));

// TODO: DELETE /api-keys/:id
// Delete a specific API key.
// - Verify the key belongs to the logged-in user before deleting
router.delete('/:id', authenticateToken, attachUser, asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const apiKeyId = req.params.id;
    const apiKey = await UserApiKey.findOne({user: userId, _id: apiKeyId});
    if (!apiKey) {
        return notFoundResponse(res, 'ApiKey');
    }

    await apiKey.deleteOne()
    return successResponse(res, null, 'API key deleted successfully.');
}));

export default router;
