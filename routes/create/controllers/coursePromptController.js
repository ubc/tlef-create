import express from 'express';
import CoursePromptOverride from '../models/CoursePromptOverride.js';
import Folder from '../models/Folder.js';
import SystemPromptTemplate from '../models/SystemPromptTemplate.js';
import UserPromptOverride from '../models/UserPromptOverride.js';
import { authenticateToken } from '../middleware/auth.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ERROR_CODES, HTTP_STATUS } from '../config/constants.js';
import { GENERAL_SYSTEM_PROMPTS } from '../services/coursePromptDefaults.js';
import llmService from '../services/llmService.js';

const router = express.Router();

const APPROACHES = ['support', 'assess', 'gamify'];
const PROMPT_TYPES = [
  'quiz-blueprint',
  'learning-objectives',
  'question-generation',
  'coverage-map',
  'history-summary',
  'question-validation'
];

const APPROACH_DEPENDENT_PROMPT_TYPES = new Set([
  'quiz-blueprint',
  'question-generation'
]);

function normalizePromptType(promptType) {
  return PROMPT_TYPES.includes(promptType) ? promptType : 'quiz-blueprint';
}

function normalizeApproach(approach, promptType) {
  if (APPROACH_DEPENDENT_PROMPT_TYPES.has(promptType)) {
    return APPROACHES.includes(approach) ? approach : 'support';
  }
  return 'general';
}

function normalizePromptName(value, fallback = 'Course prompt') {
  return (value?.trim() || fallback).slice(0, 120);
}

async function getOwnedFolder(folderId, userId) {
  return Folder.findOne({ _id: folderId, instructor: userId });
}

export function validatePromptContent(customInnerPrompt, promptType) {
  const errors = [];
  const warnings = [];
  const suggestions = [];
  const trimmed = customInnerPrompt?.trim() || '';

  if (!trimmed) {
    errors.push('Prompt cannot be empty.');
  }

  if (trimmed.length > 12000) {
    errors.push('Prompt must be 12,000 characters or fewer.');
  }

  if (trimmed.length < 80) {
    warnings.push('Prompt is very short and may not provide enough guidance.');
  }

  const openingTemplateTokens = (trimmed.match(/\{\{/g) || []).length;
  const closingTemplateTokens = (trimmed.match(/\}\}/g) || []).length;
  if (openingTemplateTokens !== closingTemplateTokens) {
    errors.push('Prompt contains an unmatched template placeholder. Check all {{...}} tokens.');
  }

  if (/\b(ignore|disregard|override)\b.{0,30}\b(previous|system|developer)\b/i.test(trimmed)) {
    warnings.push('This prompt asks the model to ignore higher-level instructions and may behave unpredictably.');
  }

  if (
    ['learning-objectives', 'quiz-blueprint', 'question-generation', 'coverage-map', 'question-validation'].includes(promptType)
    && !/(source|evidence|material|ground)/i.test(trimmed)
  ) {
    suggestions.push('Consider asking the model to ground outputs in uploaded materials or source evidence.');
  }

  if (
    ['quiz-blueprint', 'question-generation', 'history-summary', 'question-validation'].includes(promptType)
    && !/(avoid|duplicate|similar|history|coverage|novel)/i.test(trimmed)
  ) {
    suggestions.push('Consider adding an instruction to avoid duplicate or overly similar outputs.');
  }

  return {
    status: errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warning' : 'valid',
    errors,
    warnings,
    suggestions,
    validatedAt: new Date()
  };
}

async function validatePromptWithAI(customInnerPrompt, promptType, userId) {
  const validation = validatePromptContent(customInnerPrompt, promptType);
  if (validation.status === 'invalid') {
    validation.aiReview = { attempted: false, available: false };
    return validation;
  }

  try {
    const aiReview = await llmService.reviewCoursePrompt({
      userId,
      promptType,
      customInnerPrompt
    });
    validation.warnings = [...new Set([...validation.warnings, ...aiReview.warnings])];
    validation.suggestions = [...new Set([...validation.suggestions, ...aiReview.suggestions])];
    validation.status = validation.warnings.length > 0 ? 'warning' : 'valid';
    validation.aiReview = {
      attempted: true,
      available: true,
      provider: aiReview.provider,
      model: aiReview.model
    };
  } catch (error) {
    console.warn('Course prompt AI review unavailable:', error.message);
    validation.aiReview = {
      attempted: true,
      available: false,
      error: error.message
    };
  }

  return validation;
}

async function createActiveOverride({
  folderId,
  userId,
  promptType,
  approach,
  name,
  customInnerPrompt,
  validation,
  sourceOverride,
  sourceFolder
}) {
  const [activeOverride, latestOverride] = await Promise.all([
    CoursePromptOverride.findOne({
      folder: folderId,
      user: userId,
      promptType,
      approach,
      isActive: true
    }).sort({ version: -1 }),
    CoursePromptOverride.findOne({
      folder: folderId,
      user: userId,
      promptType,
      approach
    }).sort({ version: -1 })
  ]);

  const newOverride = await CoursePromptOverride.create({
    folder: folderId,
    user: userId,
    promptType,
    approach,
    name,
    customInnerPrompt,
    version: latestOverride ? latestOverride.version + 1 : 1,
    isActive: true,
    validation,
    parentVersion: activeOverride?._id,
    sourceOverride,
    sourceFolder
  });

  await CoursePromptOverride.updateMany({
    _id: { $ne: newOverride._id },
    folder: folderId,
    user: userId,
    promptType,
    approach,
    isActive: true
  }, {
    $set: { isActive: false }
  });

  return newOverride;
}

async function resolveEffectivePrompt({ folderId, userId, promptType, approach }) {
  const isApproachDependent = APPROACH_DEPENDENT_PROMPT_TYPES.has(promptType);
  const systemTemplate = isApproachDependent && APPROACHES.includes(approach)
    ? await SystemPromptTemplate.findOne({ approach, isActive: true }).lean()
    : null;

  const userOverride = isApproachDependent && APPROACHES.includes(approach)
    ? await UserPromptOverride.findOne({ user: userId, approach, isActive: true }).lean()
    : null;

  const courseOverride = await CoursePromptOverride.findOne({
    folder: folderId,
    user: userId,
    promptType,
    approach,
    isActive: true
  }).sort({ version: -1 }).lean();

  const innerPrompt =
    courseOverride?.customInnerPrompt ||
    userOverride?.customInnerPrompt ||
    systemTemplate?.innerPrompt ||
    GENERAL_SYSTEM_PROMPTS[promptType] ||
    '';

  return {
    promptType,
    approach,
    source: courseOverride ? 'course' : userOverride ? 'user' : 'system',
    innerPrompt,
    outerPrompt: systemTemplate?.outerPrompt || '',
    systemDefault: systemTemplate?.innerPrompt || GENERAL_SYSTEM_PROMPTS[promptType] || '',
    activeOverride: courseOverride,
    userOverride,
    systemTemplate
  };
}

router.post('/validate', authenticateToken, asyncHandler(async (req, res) => {
  const promptType = normalizePromptType(req.body.promptType);
  const validation = await validatePromptWithAI(
    req.body.customInnerPrompt || '',
    promptType,
    req.user.id
  );

  return successResponse(res, { validation }, 'Prompt validation completed');
}));

router.get('/library', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const promptType = normalizePromptType(req.query.promptType);
  const approach = normalizeApproach(req.query.approach, promptType);
  const excludeFolderId = req.query.excludeFolderId;
  const query = {
    user: userId,
    promptType,
    approach
  };

  if (excludeFolderId) {
    query.folder = { $ne: excludeFolderId };
  }

  const library = await CoursePromptOverride.find(query)
    .populate('folder', 'name')
    .sort({ updatedAt: -1, version: -1 })
    .limit(50)
    .lean();

  return successResponse(
    res,
    { library: library.filter(item => item.folder) },
    'Prompt library retrieved successfully'
  );
}));

router.get('/folder/:folderId', authenticateToken, asyncHandler(async (req, res) => {
  const { folderId } = req.params;
  const userId = req.user.id;
  const promptType = normalizePromptType(req.query.promptType);
  const approach = normalizeApproach(req.query.approach, promptType);

  const folder = await getOwnedFolder(folderId, userId);
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  const effectivePrompt = await resolveEffectivePrompt({
    folderId,
    userId,
    promptType,
    approach
  });

  return successResponse(res, { prompt: effectivePrompt }, 'Course prompt retrieved successfully');
}));

router.get('/folder/:folderId/history', authenticateToken, asyncHandler(async (req, res) => {
  const { folderId } = req.params;
  const userId = req.user.id;
  const promptType = normalizePromptType(req.query.promptType);
  const approach = normalizeApproach(req.query.approach, promptType);

  const folder = await getOwnedFolder(folderId, userId);
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  const history = await CoursePromptOverride.find({
    folder: folderId,
    user: userId,
    promptType,
    approach
  }).sort({ version: -1, createdAt: -1 }).lean();

  return successResponse(res, { history }, 'Course prompt history retrieved successfully');
}));

router.put('/folder/:folderId', authenticateToken, asyncHandler(async (req, res) => {
  const { folderId } = req.params;
  const userId = req.user.id;
  const promptType = normalizePromptType(req.body.promptType);
  const approach = normalizeApproach(req.body.approach, promptType);
  const customInnerPrompt = req.body.customInnerPrompt?.trim() || '';
  const name = normalizePromptName(req.body.name);
  const validation = await validatePromptWithAI(customInnerPrompt, promptType, userId);

  const folder = await getOwnedFolder(folderId, userId);
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  if (validation.status === 'invalid') {
    return errorResponse(
      res,
      'Prompt validation failed',
      ERROR_CODES.VALIDATION_ERROR,
      HTTP_STATUS.BAD_REQUEST,
      { validation }
    );
  }

  const override = await createActiveOverride({
    folderId,
    userId,
    promptType,
    approach,
    name,
    customInnerPrompt,
    validation
  });

  return successResponse(res, { prompt: override, validation }, 'Course prompt saved successfully');
}));

router.post('/folder/:folderId/apply/:overrideId', authenticateToken, asyncHandler(async (req, res) => {
  const { folderId, overrideId } = req.params;
  const userId = req.user.id;
  const folder = await getOwnedFolder(folderId, userId);
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  const sourceOverride = await CoursePromptOverride.findOne({
    _id: overrideId,
    user: userId
  }).populate('folder', 'name');
  if (!sourceOverride) {
    return notFoundResponse(res, 'Prompt version');
  }

  const validation = validatePromptContent(
    sourceOverride.customInnerPrompt,
    sourceOverride.promptType
  );
  const storedValidation = sourceOverride.validation?.toObject?.() || sourceOverride.validation;
  if (storedValidation?.aiReview) {
    validation.warnings = [...new Set([...validation.warnings, ...(storedValidation.warnings || [])])];
    validation.suggestions = [...new Set([...validation.suggestions, ...(storedValidation.suggestions || [])])];
    validation.status = validation.warnings.length > 0 ? 'warning' : 'valid';
    validation.aiReview = storedValidation.aiReview;
  }
  if (validation.status === 'invalid') {
    return errorResponse(
      res,
      'Saved prompt is no longer valid and cannot be applied',
      ERROR_CODES.VALIDATION_ERROR,
      HTTP_STATUS.BAD_REQUEST,
      { validation }
    );
  }

  const sourceFolderName = sourceOverride.folder?.name || 'another course';
  const override = await createActiveOverride({
    folderId,
    userId,
    promptType: sourceOverride.promptType,
    approach: sourceOverride.approach,
    name: normalizePromptName(
      req.body.name,
      `${sourceOverride.name} (from ${sourceFolderName})`
    ),
    customInnerPrompt: sourceOverride.customInnerPrompt,
    validation,
    sourceOverride: sourceOverride._id,
    sourceFolder: sourceOverride.folder?._id || sourceOverride.folder
  });

  const prompt = await resolveEffectivePrompt({
    folderId,
    userId,
    promptType: sourceOverride.promptType,
    approach: sourceOverride.approach
  });

  return successResponse(
    res,
    { prompt, appliedOverride: override, validation },
    'Prompt applied to course successfully'
  );
}));

router.post('/folder/:folderId/reset', authenticateToken, asyncHandler(async (req, res) => {
  const { folderId } = req.params;
  const userId = req.user.id;
  const promptType = normalizePromptType(req.body.promptType || req.query.promptType);
  const approach = normalizeApproach(req.body.approach || req.query.approach, promptType);

  const folder = await getOwnedFolder(folderId, userId);
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  await CoursePromptOverride.updateMany({
    folder: folderId,
    user: userId,
    promptType,
    approach,
    isActive: true
  }, {
    $set: { isActive: false }
  });

  const effectivePrompt = await resolveEffectivePrompt({
    folderId,
    userId,
    promptType,
    approach
  });

  return successResponse(res, { prompt: effectivePrompt }, 'Course prompt reset to default successfully');
}));

export default router;
