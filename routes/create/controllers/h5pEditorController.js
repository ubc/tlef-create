import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import H5PContent from '../models/H5PContent.js';
import Quiz from '../models/Quiz.js';
import Material from '../models/Material.js';
import { authenticateToken } from '../middleware/auth.js';
import { HTTP_STATUS } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { errorResponse, notFoundResponse, successResponse } from '../utils/responseFormatter.js';
import { buildNativeH5PDocument } from '../services/h5pExportService.js';
import { getStudioCatalog } from '../services/h5pStudioCatalog.js';
import { generateStudioActivity, proposeStudioQuestionPlan, resolveStudioInstructions, validateStudioQuestionPlan, validateStudioRequestFeasibility } from '../services/h5pStudioAIService.js';
import { suggestStudioPrompt } from '../services/studioPromptHelper.js';
import { buildAssistantContext } from '../services/studioAssistantPlanning.js';
import { isMaterialReady } from '../utils/generationReadiness.js';
import { studioMediaPaths, validateStudioMediaTemplate } from '../services/h5pStudioSemantics.js';
import llmService from '../services/llmService.js';
import studioJobs, { serializeStudioJob } from '../services/studioGenerationJobs.js';
import {
  getEditor,
  getH5PExpressRouter,
  getSystemUser,
  finalizeContentOwnership,
  importH5PContent,
  renderContent,
  toLumiUser
} from '../services/lumiService.js';
import {
  buildH5PSourceFingerprint,
  buildLumiSaveResult,
  getH5PSourceUpdatedAt,
  isGeneratedH5PDraftOutdated,
  normalizeEditorPayload,
  saveNativeH5PDocumentAndRecord,
  serializeH5PContent
} from '../services/h5pEditorService.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_IMPORT_DIR = path.join(__dirname, '..', 'uploads', 'h5p-editor-imports');
const MAX_H5P_UPLOAD_BYTES = 50 * 1024 * 1024;

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_H5P_UPLOAD_BYTES, files: 1 }
});

const runtimeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_H5P_UPLOAD_BYTES, files: 1 }
}).fields([{ name: 'file', maxCount: 1 }, { name: 'h5p', maxCount: 1 }]);

let runtimeRouter;

function attachLumiUser(req, _res, next) {
  req.createUser = req.user;
  req.user = toLumiUser(req.user);
  next();
}

function handleRuntimeUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();

  runtimeUpload(req, res, error => {
    if (error) return next(error);

    const files = req.files || {};
    req.files = {};
    for (const fieldName of ['file', 'h5p']) {
      const uploaded = files[fieldName]?.[0];
      if (!uploaded) continue;
      req.files[fieldName] = {
        data: uploaded.buffer,
        mimetype: uploaded.mimetype,
        name: uploaded.originalname,
        size: uploaded.size
      };
    }
    return next();
  });
}

function delegateToLumiRuntime(req, res, next) {
  try {
    runtimeRouter ||= getH5PExpressRouter();
    return runtimeRouter(req, res, next);
  } catch (error) {
    return errorResponse(
      res,
      'The H5P editor is still starting. Please try again.',
      'H5P_EDITOR_NOT_READY',
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}

function getOwnedContent(contentId, ownerId) {
  return H5PContent.findOne({ lumiContentId: contentId, owner: ownerId });
}

async function loadQuizForEditor(quizId, userId) {
  return Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate({
      path: 'questions',
      populate: { path: 'learningObjective', select: 'text order' },
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives', 'text order updatedAt');
}

async function removeImportedContentOnFailure(contentId) {
  if (!contentId) return;
  try {
    await getEditor()?.deleteContent(contentId, getSystemUser());
  } catch (error) {
    console.error('Failed to clean up untracked H5P content:', error.message);
  }
}

router.use(authenticateToken);

router.get('/ai/catalog', (_req, res) => successResponse(res, { types: getStudioCatalog().types }));

const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10,
  keyGenerator: req => String(req.user.id),
  handler: (_req, res) => errorResponse(res, 'Please wait before generating more Studio drafts.', 'H5P_AI_RATE_LIMIT', 429)
});

const briefLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  keyGenerator: req => String(req.user.id),
  handler: (_req, res) => errorResponse(res, 'Please wait before asking the prompt helper again.', 'H5P_AI_RATE_LIMIT', 429)
});

router.post('/ai/brief', briefLimiter, asyncHandler(async (req, res) => {
  try {
    const { quizId, objectiveIds = [], materialIds = [] } = req.body || {};
    let courseContext = '';
    if (quizId) {
      if (!mongoose.isValidObjectId(quizId)) return errorResponse(res, 'Choose an owned Learning Object.', 'H5P_AI_INPUT', 400);
      const quiz = await loadQuizForEditor(quizId, String(req.user.id));
      if (!quiz) return notFoundResponse(res, 'Learning Object');
      if (!Array.isArray(objectiveIds) || objectiveIds.length > 8 || new Set(objectiveIds).size !== objectiveIds.length
        || objectiveIds.some(id => !quiz.learningObjectives.some(objective => String(objective._id) === id))
        || !Array.isArray(materialIds) || materialIds.length > 20 || new Set(materialIds).size !== materialIds.length
        || materialIds.some(id => !mongoose.isValidObjectId(id))) {
        return errorResponse(res, 'Choose valid course evidence from this Learning Object.', 'H5P_AI_INPUT', 400);
      }
      const materials = materialIds.length ? await Material.find({ _id: { $in: materialIds }, folder: quiz.folder, uploadedBy: req.user.id }) : [];
      if (materials.length !== materialIds.length) return errorResponse(res, 'Choose materials from the selected course.', 'H5P_AI_INPUT', 400);
      courseContext = JSON.stringify({ course: quiz.folder?.name || '', learningObject: quiz.name,
        objectives: quiz.learningObjectives.filter(objective => objectiveIds.includes(String(objective._id))).map(objective => objective.text),
        materials: materials.map(material => ({ name: material.name, ready: isMaterialReady(material) })) });
    } else if (objectiveIds.length || materialIds.length) {
      return errorResponse(res, 'Choose a Learning Object before selecting course evidence.', 'H5P_AI_INPUT', 400);
    }
    const suggestion = await suggestStudioPrompt({ ...req.body, evidenceSelected: !!(quizId && (objectiveIds.length || materialIds.length)),
      courseContext, userId: String(req.user.id),
      complete: options => llmService.streamCompletion(options) });
    return successResponse(res, suggestion);
  } catch (error) {
    const expected = ['H5P_AI_INVALID', 'H5P_AI_INPUT', 'NO_API_KEY'].includes(error.code);
    return errorResponse(res, expected ? error.message : 'The prompt helper is unavailable. Your instructions were not changed.',
      expected ? error.code : 'H5P_AI_FAILED', expected ? (error.status || 422) : 502);
  }
}));

router.post('/ai/plan', aiLimiter, asyncHandler(async (req, res) => {
  try {
    const { quizId, objectiveIds, materialIds } = req.body || {};
    let context = '';
    if (quizId || objectiveIds || materialIds) {
      if (!mongoose.isValidObjectId(quizId)) return errorResponse(res, 'Choose an owned Learning Object for course evidence.', 'H5P_AI_INPUT', 400);
      const quiz = await loadQuizForEditor(quizId, String(req.user.id));
      if (!quiz) return notFoundResponse(res, 'Learning Object');
      if (objectiveIds != null && (!Array.isArray(objectiveIds) || objectiveIds.length > 8 || new Set(objectiveIds).size !== objectiveIds.length
        || objectiveIds.some(id => !quiz.learningObjectives.some(objective => String(objective._id) === id)))) {
        return errorResponse(res, 'Choose up to 8 learning objectives from this Learning Object.', 'H5P_AI_INPUT', 400);
      }
      let source = '';
      if (materialIds != null) {
        if (!Array.isArray(materialIds) || materialIds.length > 20 || new Set(materialIds).size !== materialIds.length
          || materialIds.some(id => !mongoose.isValidObjectId(id))) return errorResponse(res, 'Choose up to 20 course materials.', 'H5P_AI_INPUT', 400);
        const materials = await Material.find({ _id: { $in: materialIds }, folder: quiz.folder, uploadedBy: req.user.id });
        if (materials.length !== materialIds.length || materials.some(material => !isMaterialReady(material))) {
          return errorResponse(res, 'Wait for selected course materials to finish processing.', 'MATERIALS_NOT_READY', 409);
        }
        source = (await buildAssistantContext(materials, { userId: String(req.user.id) })).context.slice(0, 12000);
      }
      context = JSON.stringify({ objectives: (objectiveIds ? quiz.learningObjectives.filter(objective => objectiveIds.includes(String(objective._id))) : materialIds ? [] : quiz.learningObjectives)
        .map(objective => objective.text), source });
    }
    const instructions = resolveStudioInstructions(req.body?.instructions,
      !!quizId && ((Array.isArray(objectiveIds) && objectiveIds.length > 0) || (Array.isArray(materialIds) && materialIds.length > 0)));
    const plan = await proposeStudioQuestionPlan({ ...req.body, instructions, context, userId: String(req.user.id),
      complete: options => llmService.streamCompletion(options) });
    return successResponse(res, { plan }, 'Review the proposed type and quantity plan before generating.');
  } catch (error) {
    const expected = ['H5P_AI_INVALID', 'H5P_AI_INPUT', 'NO_API_KEY'].includes(error.code);
    return errorResponse(res, expected ? error.message : 'Could not prepare a question plan. Your draft was not changed.',
      expected ? error.code : 'H5P_AI_FAILED', expected ? (error.status || 422) : 502);
  }
}));

// Lumi's new-content web component always opens the Hub. A saved empty draft
// lets the official editor open an exact compatible version for media setup.
router.post('/ai/template', aiLimiter, asyncHandler(async (req, res) => {
  const type = getStudioCatalog().types.find(item => item.library === req.body?.library && item.mode === 'template');
  if (!type) return errorResponse(res, 'Choose an available media/template type.', 'H5P_AI_INPUT', 400);
  const editor = getEditor();
  if (!editor) return errorResponse(res, 'The H5P editor is still starting.', 'H5P_EDITOR_NOT_READY', 503);
  try {
    const saved = await saveNativeH5PDocumentAndRecord({
      editor, user: toLumiUser(req.user), cleanupUser: getSystemUser(),
      document: { library: type.library, parameters: {}, metadata: { title: `${type.title} template`, license: 'U' } },
      createRecord: result => H5PContent.create({ owner: req.user.id, lumiContentId: result.id, title: `${type.title} template`, mainLibrary: type.machineName, source: 'editor', status: 'draft' })
    });
    finalizeContentOwnership(saved.result.id);
    return successResponse(res, { content: serializeH5PContent(saved.record) }, 'Add your media and complete the required fields before using this template.', 201);
  } catch {
    return errorResponse(res, 'The template could not be prepared. Your existing content is unchanged.', 'H5P_TEMPLATE_FAILED', 502);
  }
}));

async function generateOwnedDraft(user, body, assertActive = async () => {}) {
  const owner = String(user.id);
  const editor = getEditor();
  const reject = (message, status = 400, code = 'H5P_AI_INPUT') => { throw Object.assign(new Error(message), { status, code }); };
  if (!editor) reject('The H5P editor is still starting.', 503, 'H5P_EDITOR_NOT_READY');
  const { library, instructions, templateContentId, quizId, questionPlan, objectiveIds, materialIds } = body || {};
  const checkedPlan = validateStudioQuestionPlan(library, questionPlan);
  let template;
  let quiz;
  if (templateContentId) {
    if (typeof templateContentId !== 'string' || templateContentId.length > 200) reject('Invalid template.');
    const owned = await getOwnedContent(templateContentId, owner);
    if (!owned) reject('H5P template not found.', 404);
    template = await editor.getContent(templateContentId, toLumiUser(user));
  }
  if (quizId) {
    if (!mongoose.isValidObjectId(quizId)) reject('Invalid Quiz.');
    quiz = await loadQuizForEditor(quizId, owner);
    if (!quiz) reject('Quiz not found.', 404);
  }
  if (objectiveIds != null && (!quiz || !Array.isArray(objectiveIds) || !objectiveIds.length || objectiveIds.length > 8
    || objectiveIds.some(id => !mongoose.isValidObjectId(id)) || new Set(objectiveIds).size !== objectiveIds.length
    || objectiveIds.some(id => !quiz.learningObjectives.some(objective => String(objective._id) === id)))) {
    reject('Choose 1–8 learning objectives from the linked Learning Object.');
  }
  if (materialIds != null && (!quiz || !Array.isArray(materialIds) || !materialIds.length || materialIds.length > 20
    || materialIds.some(id => !mongoose.isValidObjectId(id)) || new Set(materialIds).size !== materialIds.length)) {
    reject('Choose 1–20 materials from the linked course.');
  }
  const effectiveInstructions = resolveStudioInstructions(instructions,
    !!quiz && ((Array.isArray(objectiveIds) && objectiveIds.length > 0) || (Array.isArray(materialIds) && materialIds.length > 0)));
  validateStudioRequestFeasibility(library, effectiveInstructions);
  let record;
  try {
    const materialContext = materialIds?.length ? await (async () => {
      const materials = await Material.find({ _id: { $in: materialIds }, folder: quiz.folder, uploadedBy: owner });
      if (materials.length !== materialIds.length || materials.some(material => !isMaterialReady(material))) {
        reject('Wait for the selected course materials to finish processing.', 409, 'MATERIALS_NOT_READY');
      }
      return (await buildAssistantContext(materials, { userId: owner })).context;
    })() : '';
    const context = quiz ? JSON.stringify({
      title: quiz.name,
      objectives: (objectiveIds ? quiz.learningObjectives.filter(objective => objectiveIds.includes(String(objective._id))) : materialIds ? [] : quiz.learningObjectives)
        .map(objective => objective.text),
      selectedMaterialEvidence: materialContext.slice(0, 14000),
      questions: objectiveIds?.length || materialIds?.length ? [] : quiz.questions.slice(0, 20)
        .map(question => ({ text: question.questionText, content: question.content, explanation: question.explanation }))
    }) : '';
    const generated = await generateStudioActivity({
      library, instructions: effectiveInstructions, template, templateContentId, questionPlan: checkedPlan, context, userId: owner,
      complete: options => llmService.streamCompletion(options)
    });
    await assertActive();
    const expectedMediaCount = studioMediaPaths(generated.document.parameters).length;
    const saved = await saveNativeH5PDocumentAndRecord({
      editor, document: generated.document, user: toLumiUser(user), cleanupUser: getSystemUser(),
      createRecord: result => H5PContent.create({
        owner, lumiContentId: result.id, title: generated.document.metadata.title,
        mainLibrary: library.split(' ')[0], source: 'ai-studio', status: 'draft',
        folder: quiz?.folder || null, quiz: quiz?._id || null,
        sourceFingerprint: quiz ? buildH5PSourceFingerprint(quiz) : null,
        sourceQuizUpdatedAt: quiz ? getH5PSourceUpdatedAt(quiz) : null,
        aiGeneration: { ...generated.provenance, templateContentId: templateContentId || undefined }
      })
    });
    record = saved.record;
    finalizeContentOwnership(saved.result.id);
    // Lumi can silently strip a failed media copy. Do not return a successful
    // AI draft unless every retained media reference survived and exists.
    const persisted = await editor.getContent(saved.result.id, toLumiUser(user));
    const copiedMedia = studioMediaPaths(persisted.params.params);
    if (copiedMedia.length !== expectedMediaCount) throw new Error('Media copy was incomplete.');
    for (const file of copiedMedia) {
      if (/^https:\/\//.test(file)) continue;
      if (!file || file.split('/').includes('..') || !(await editor.contentManager.contentFileExists(saved.result.id, file))) throw new Error('Media copy was incomplete.');
    }
    await assertActive();
    return record;
  } catch (error) {
    if (record) {
      await removeImportedContentOnFailure(record.lumiContentId);
      await H5PContent.deleteOne({ _id: record._id, owner });
    }
    throw error;
  }
}

router.post('/ai/generate', aiLimiter, asyncHandler(async (req, res) => {
  const owner = String(req.user.id);
  try {
    // Legacy synchronous callers share the same database admission control.
    // Resolve (rather than reject) the outcome so a fast validation error can
    // never become an unhandled rejection while the receipt is being created.
    let finish;
    const outcome = new Promise(resolve => { finish = resolve; });
    await studioJobs.start(owner, crypto.randomUUID(), async assertActive => {
      try {
        const record = await generateOwnedDraft(req.user, req.body, assertActive);
        finish({ record });
        return record.lumiContentId;
      } catch (error) { finish({ error }); throw error; }
    });
    const { record, error } = await outcome;
    if (error) throw error;
    return successResponse(res, { content: serializeH5PContent(record) }, 'AI draft created. Review it in the editor before use.', 201);
  } catch (error) {
    const expected = ['H5P_AI_INVALID', 'H5P_AI_INPUT', 'H5P_AI_TEMPLATE_REQUIRED', 'H5P_EDITOR_NOT_READY', 'H5P_AI_BUSY', 'H5P_AI_RATE_LIMIT', 'NO_API_KEY'].includes(error.code);
    return errorResponse(res, expected ? error.message : 'The AI draft could not be created. Check your AI model/key and try a smaller activity. Your original content is unchanged.', expected ? error.code : 'H5P_AI_FAILED', expected ? (error.status || 422) : 502);
  }
}));

router.post('/ai/jobs', asyncHandler(async (req, res) => {
  try {
    validateStudioRequestFeasibility(req.body?.library, req.body?.instructions);
    const job = await studioJobs.start(String(req.user.id), req.body?.requestId, async assertActive => {
      const record = await generateOwnedDraft(req.user, req.body, assertActive);
      return record.lumiContentId;
    });
    return successResponse(res, { job: serializeStudioJob(job) }, 'Generation request accepted.', 202);
  } catch (error) {
    return errorResponse(res, error.status ? error.message : 'Generation could not start. Please retry the same request.', error.code || 'H5P_AI_FAILED', error.status || 503);
  }
}));

router.get('/ai/jobs/:requestId', asyncHandler(async (req, res) => {
  const job = await studioJobs.get(String(req.user.id), req.params.requestId);
  if (!job) return notFoundResponse(res, 'Generation request');
  const content = job.contentId ? await getOwnedContent(job.contentId, req.user.id) : null;
  return successResponse(res, { job: serializeStudioJob(job), content: content ? serializeH5PContent(content) : null });
}));

router.get('/contents/:contentId/source', asyncHandler(async (req, res) => {
  const record = await getOwnedContent(req.params.contentId, req.user.id);
  if (!record) return notFoundResponse(res, 'H5P content');
  const quiz = record.quiz ? await loadQuizForEditor(record.quiz, req.user.id) : null;
  return successResponse(res, { source: {
    independent: true, quizId: quiz?._id?.toString() || null,
    folderId: quiz?.folder?.toString() || null, title: quiz?.name || null,
    state: !record.quiz ? 'standalone' : !quiz ? 'unavailable' : !record.sourceFingerprint ? 'unknown' : isGeneratedH5PDraftOutdated(record, quiz) ? 'changed' : 'current'
  } });
}));

// H5P Core AJAX, library, temporary-file, and editor asset routes.
router.use('/runtime', handleRuntimeUpload, attachLumiUser, delegateToLumiRuntime);

router.get('/contents', asyncHandler(async (req, res) => {
  const filter = { owner: req.user.id };
  for (const name of ['quizId', 'folderId']) {
    if (req.query[name] !== undefined && (typeof req.query[name] !== 'string' || !mongoose.isValidObjectId(req.query[name]))) {
      return errorResponse(res, 'Select a valid course or learning object.', 'VALIDATION_ERROR', 400);
    }
  }
  if (req.query.quizId) filter.quiz = req.query.quizId;
  if (req.query.folderId) filter.folder = req.query.folderId;

  const contents = await H5PContent.find(filter).sort({ updatedAt: -1 }).limit(200);
  return successResponse(res, {
    contents: contents.map(serializeH5PContent)
  });
}));

router.get('/editor-model/:contentId', asyncHandler(async (req, res) => {
  const editor = getEditor();
  if (!editor) {
    return errorResponse(res, 'The H5P editor is still starting.', 'H5P_EDITOR_NOT_READY', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  const isNew = req.params.contentId === 'new';
  if (!isNew) {
    const owned = await getOwnedContent(req.params.contentId, req.user.id);
    if (!owned) return notFoundResponse(res, 'H5P content');
  }

  const lumiUser = toLumiUser(req.user);
  const editorModel = await editor.render(isNew ? undefined : req.params.contentId, 'en', lumiUser);

  if (isNew) {
    return successResponse(res, { model: editorModel });
  }

  const content = await editor.getContent(req.params.contentId, lumiUser);
  return successResponse(res, {
    model: {
      ...editorModel,
      library: content.library,
      metadata: content.params.metadata,
      params: content.params.params
    }
  });
}));

router.post('/contents', asyncHandler(async (req, res) => {
  const editor = getEditor();
  if (!editor) {
    return errorResponse(res, 'The H5P editor is still starting.', 'H5P_EDITOR_NOT_READY', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  let normalized;
  try {
    normalized = normalizeEditorPayload(req.body);
    normalized.parameters = validateStudioMediaTemplate(normalized.library, normalized.parameters, getStudioCatalog());
  } catch (error) {
    return errorResponse(res, error.message, error.code, HTTP_STATUS.BAD_REQUEST);
  }

  const lumiUser = toLumiUser(req.user);
  const result = await editor.saveOrUpdateContentReturnMetaData(
    undefined,
    normalized.parameters,
    normalized.metadata,
    normalized.library,
    lumiUser
  );

  try {
    const record = await H5PContent.create({
      owner: req.user.id,
      lumiContentId: result.id,
      title: normalized.title,
      mainLibrary: result.metadata.mainLibrary || normalized.library.split(' ')[0],
      source: 'editor',
      lastEditedAt: new Date()
    });
    finalizeContentOwnership(result.id);
    return successResponse(res, buildLumiSaveResult(result, record), 'H5P content created', HTTP_STATUS.CREATED);
  } catch (error) {
    await removeImportedContentOnFailure(result.id);
    throw error;
  }
}));

router.patch('/contents/:contentId', asyncHandler(async (req, res) => {
  const record = await getOwnedContent(req.params.contentId, req.user.id);
  if (!record) return notFoundResponse(res, 'H5P content');

  let normalized;
  try {
    normalized = normalizeEditorPayload(req.body);
    normalized.parameters = validateStudioMediaTemplate(normalized.library, normalized.parameters, getStudioCatalog());
  } catch (error) {
    return errorResponse(res, error.message, error.code, HTTP_STATUS.BAD_REQUEST);
  }

  const editor = getEditor();
  if (!editor) {
    return errorResponse(res, 'The H5P editor is still starting.', 'H5P_EDITOR_NOT_READY', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  const result = await editor.saveOrUpdateContentReturnMetaData(
    req.params.contentId,
    normalized.parameters,
    normalized.metadata,
    normalized.library,
    toLumiUser(req.user)
  );

  record.title = normalized.title;
  record.mainLibrary = result.metadata.mainLibrary || normalized.library.split(' ')[0];
  record.lastEditedAt = new Date();
  await record.save();

  return successResponse(res, buildLumiSaveResult(result, record), 'H5P content saved');
}));

router.post('/contents/import', memoryUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !req.file.originalname.toLowerCase().endsWith('.h5p')) {
    return errorResponse(res, 'Choose a valid .h5p file.', 'INVALID_H5P_FILE', HTTP_STATUS.BAD_REQUEST);
  }

  await fs.mkdir(EDITOR_IMPORT_DIR, { recursive: true });
  const temporaryPath = path.join(EDITOR_IMPORT_DIR, `${crypto.randomBytes(16).toString('hex')}.h5p`);
  let contentId;

  try {
    await fs.writeFile(temporaryPath, req.file.buffer);
    // Author imports may use already-installed libraries only. The Lumi
    // permission system rejects attempts to install executable libraries.
    contentId = await importH5PContent(temporaryPath, toLumiUser(req.user));
    const imported = await getEditor().getContent(contentId, getSystemUser());
    const title = (imported.h5p.title || req.file.originalname.replace(/\.h5p$/i, '')).slice(0, 255);
    const record = await H5PContent.create({
      owner: req.user.id,
      lumiContentId: contentId,
      title,
      mainLibrary: imported.h5p.mainLibrary || imported.library.split(' ')[0],
      source: 'import',
      lastEditedAt: new Date()
    });
    finalizeContentOwnership(contentId);

    return successResponse(res, { content: serializeH5PContent(record) }, 'H5P content imported', HTTP_STATUS.CREATED);
  } catch (error) {
    await removeImportedContentOnFailure(contentId);
    throw error;
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
}));

router.post('/contents/from-quiz/:quizId', asyncHandler(async (req, res) => {
  const quiz = await loadQuizForEditor(req.params.quizId, req.user.id);
  if (!quiz) return notFoundResponse(res, 'Learning Object');
  if (!quiz.questions?.length) {
    return errorResponse(res, 'Generate at least one question before opening the H5P editor.', 'NO_QUESTIONS', HTTP_STATUS.BAD_REQUEST);
  }

  if (!req.body?.forceNew) {
    const existing = await H5PContent.findOne({
      owner: req.user.id,
      quiz: quiz._id,
      source: 'generated'
    }).sort({ updatedAt: -1 });
    if (existing) {
      return successResponse(res, {
        content: serializeH5PContent(existing),
        reused: true,
        sourceOutdated: isGeneratedH5PDraftOutdated(existing, quiz)
      });
    }
  }

  const editor = getEditor();
  if (!editor) {
    return errorResponse(res, 'The H5P editor is still starting.', 'H5P_EDITOR_NOT_READY', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  const nativeDocument = await buildNativeH5PDocument(quiz);
  const sourceUpdatedAt = getH5PSourceUpdatedAt(quiz);
  const sourceFingerprint = buildH5PSourceFingerprint(quiz);
  const { result, record } = await saveNativeH5PDocumentAndRecord({
    editor,
    document: nativeDocument,
    user: toLumiUser(req.user),
    cleanupUser: getSystemUser(),
    createRecord: saved => H5PContent.create({
      owner: req.user.id,
      folder: quiz.folder,
      quiz: quiz._id,
      lumiContentId: saved.id,
      title: (saved.metadata.title || quiz.name).slice(0, 255),
      mainLibrary: saved.metadata.mainLibrary || nativeDocument.library.split(' ')[0],
      source: 'generated',
      sourceQuizUpdatedAt: sourceUpdatedAt,
      sourceFingerprint,
      lastEditedAt: new Date()
    })
  });
  finalizeContentOwnership(result.id);

  return successResponse(res, {
    content: serializeH5PContent(record),
    reused: false,
    sourceOutdated: false
  }, 'Learning Object opened in H5P Studio', HTTP_STATUS.CREATED);
}));

router.get('/contents/:contentId/preview', asyncHandler(async (req, res) => {
  const record = await getOwnedContent(req.params.contentId, req.user.id);
  if (!record) return notFoundResponse(res, 'H5P content');

  const html = await renderContent(req.params.contentId, toLumiUser(req.user), {
    showFrame: true, showDownloadButton: true, showLicenseButton: true,
    showEmbedButton: false, showH5PIcon: true
  });
  res.removeHeader('Content-Security-Policy');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  return res.type('html').send(html);
}));

router.get('/contents/:contentId/download', asyncHandler(async (req, res) => {
  const record = await getOwnedContent(req.params.contentId, req.user.id);
  if (!record) return notFoundResponse(res, 'H5P content');

  const editor = getEditor();
  if (!editor) {
    return errorResponse(res, 'The H5P editor is still starting.', 'H5P_EDITOR_NOT_READY', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  const filename = `${record.title.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'h5p-content'}.h5p`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/zip');
  await editor.exportContent(req.params.contentId, res, toLumiUser(req.user));
}));

router.delete('/contents/:contentId', asyncHandler(async (req, res) => {
  const record = await getOwnedContent(req.params.contentId, req.user.id);
  if (!record) return notFoundResponse(res, 'H5P content');

  const editor = getEditor();
  if (!editor) {
    return errorResponse(res, 'The H5P editor is still starting.', 'H5P_EDITOR_NOT_READY', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  await editor.deleteContent(req.params.contentId, toLumiUser(req.user));
  await record.deleteOne();
  return successResponse(res, { contentId: req.params.contentId }, 'H5P content deleted');
}));

// Translate Lumi's stable error ids into safe, actionable author messages.
// Raw debug details can contain filesystem paths and must not reach clients.
router.use((error, _req, res, next) => {
  const errorCode = error?.errorId || error?.code;
  if (!errorCode) return next(error);

  const knownMessages = {
    'install-missing-libraries': 'This package requires H5P libraries that are not installed in CREATE. Ask an administrator to review and add the missing libraries.',
    'hub-install-denied': 'Installing H5P libraries from the Hub is restricted to CREATE administrators.',
    'h5p-server:content-missing-edit-permission': 'You do not have permission to edit this H5P content.',
    'h5p-server:content-missing-view-permission': 'You do not have permission to view this H5P content.',
    'h5p-server:content-missing-delete-permission': 'You do not have permission to delete this H5P content.'
  };

  const message = knownMessages[errorCode]
    || (errorCode === 'H5P_EDITOR_NOT_READY'
      ? 'The H5P editor is still starting. Please try again.'
      : null)
    || 'H5P could not complete this operation. Check the content fields or package and try again.';
  const status = Number.isInteger(error.httpStatusCode)
    ? error.httpStatusCode
    : HTTP_STATUS.BAD_REQUEST;

  return errorResponse(res, message, errorCode, status);
});

export default router;
