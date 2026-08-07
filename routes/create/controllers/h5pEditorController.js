import crypto from 'crypto';
import express from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import H5PContent from '../models/H5PContent.js';
import Quiz from '../models/Quiz.js';
import { authenticateToken } from '../middleware/auth.js';
import { HTTP_STATUS } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { errorResponse, notFoundResponse, successResponse } from '../utils/responseFormatter.js';
import { buildNativeH5PDocument } from '../services/h5pExportService.js';
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

// H5P Core AJAX, library, temporary-file, and editor asset routes.
router.use('/runtime', handleRuntimeUpload, attachLumiUser, delegateToLumiRuntime);

router.get('/contents', asyncHandler(async (req, res) => {
  const filter = { owner: req.user.id };
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

  const html = await renderContent(req.params.contentId, toLumiUser(req.user));
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
