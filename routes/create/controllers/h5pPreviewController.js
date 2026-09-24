import { renderLegacyH5PPreview } from '../services/h5pLegacyPreviewService.js';
import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateQuizId } from '../middleware/validator.js';
import { allowSandboxedH5PAsset } from '../middleware/h5pAssetHeaders.js';
import Quiz from '../models/Quiz.js';
import { buildNativeH5PDocument } from '../services/h5pExportService.js';
import { renderNativeH5PPreview } from '../services/h5pNativePreviewService.js';
import { getH5PTypeAdapter } from '../config/h5pTypeAdapterRegistry.js';
import { createH5PPreviewToken, verifyH5PPreviewToken } from '../utils/h5pPreviewToken.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Upload directory for extracted H5P previews
const UPLOAD_BASE = path.join(__dirname, '..', 'uploads', 'h5p-preview');
const H5P_LIBS_DIR = path.join(__dirname, '..', 'h5p-libs');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour TTL for extracted files

function applyGeneratedPreviewHeaders(res, { nested = false } = {}) {
  if (nested) {
    // Mixed Activity children sit inside the already sandboxed, same-site
    // preview shell. X-Frame-Options compares the child's opaque sandbox
    // ancestor and blocks it even though the top-level CREATE page is same-site.
    res.removeHeader('X-Frame-Options');
  } else {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Security-Policy',
    "sandbox allow-scripts; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'"
  );
}

function renderPreviewMessage(title, message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body { margin:0; padding:40px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#475569; text-align:center; background:#f8fafc; }
.preview-message { max-width:640px; margin:60px auto; padding:28px; border:1px solid #e2e8f0; border-radius:12px; background:#fff; }
h1 { margin:0 0 10px; color:#172033; font-size:20px; } p { margin:0; line-height:1.55; }
</style></head><body><main class="preview-message"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

// Configure multer for .h5p file uploads (in-memory, max 50MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.h5p') || file.mimetype === 'application/zip') {
      cb(null, true);
    } else {
      cb(new Error('Only .h5p files are allowed'));
    }
  }
});

/**
 * POST /upload — Accept .h5p file, extract, return metadata
 */
router.post('/upload', upload.single('h5pFile'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return errorResponse(res, 'No .h5p file provided', 'NO_FILE', HTTP_STATUS.BAD_REQUEST);
  }

  const id = uuidv4();
  const extractDir = path.join(UPLOAD_BASE, id);

  // Ensure upload directory exists
  await fs.mkdir(extractDir, { recursive: true });

  // Extract the .h5p ZIP
  const zip = new AdmZip(req.file.buffer);
  zip.extractAllTo(extractDir, true);

  // Parse h5p.json
  const h5pJsonPath = path.join(extractDir, 'h5p.json');
  let h5pJson;
  try {
    const raw = await fs.readFile(h5pJsonPath, 'utf-8');
    h5pJson = JSON.parse(raw);
  } catch (e) {
    // Clean up on failure
    await fs.rm(extractDir, { recursive: true, force: true });
    return errorResponse(res, 'Invalid .h5p file: missing or malformed h5p.json', 'INVALID_H5P', HTTP_STATUS.BAD_REQUEST);
  }

  // Run cleanup of old extracted dirs (fire-and-forget)
  cleanupOldPreviews().catch(() => {});

  return successResponse(res, {
    id,
    title: h5pJson.title || 'Untitled',
    mainLibrary: h5pJson.mainLibrary,
    preloadedDependencies: h5pJson.preloadedDependencies || []
  }, 'H5P file uploaded and extracted');
}));

/**
 * GET /core/h5p-core.js — Serve the minimal H5P runtime
 */
router.get('/core/h5p-core.js', allowSandboxedH5PAsset, asyncHandler(async (req, res) => {
  const corePath = path.join(__dirname, '..', 'h5p-core', 'h5p-core.js');
  res.type('application/javascript').sendFile(corePath);
}));

router.get('/core/js/jquery.js', allowSandboxedH5PAsset, asyncHandler(async (_req, res) => {
  const jqueryPath = path.join(__dirname, '..', 'h5p-core', 'js', 'jquery.js');
  res.type('application/javascript').sendFile(jqueryPath);
}));

// Serve the same pinned official core used by Studio, including fonts/theme CSS.
router.use('/core', allowSandboxedH5PAsset, express.static(path.join(__dirname, '..', 'h5p-core'), {
  dotfiles: 'deny', index: false, fallthrough: false
}));

/**
 * GET /libs/* — Serve H5P library files (JS, CSS, fonts, images).
 * Uses the existing /api/create/h5p-preview/ route so no nginx config is needed.
 */
router.get('/libs/*', allowSandboxedH5PAsset, (req, res) => {
  const requestedPath = req.params[0];

  // Security: prevent directory traversal
  if (requestedPath.includes('..')) {
    console.log('[H5P-LIBS] BLOCKED traversal attempt:', requestedPath);
    return res.status(400).send('Invalid path');
  }

  const filePath = path.join(H5P_LIBS_DIR, requestedPath);
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).send('Library file not found');
    }
  });
});

/**
 * GET /quiz/:quizId/render — Render the same native H5P document used by
 * package export and H5P Studio, without persisting a Studio draft.
 * Supports ?lo=<loId> to filter by a specific learning objective.
 */
router.get('/quiz/:quizId/render-item/:questionId', validateQuizId, asyncHandler(async (req, res) => {
  const token = verifyH5PPreviewToken(req.query.token, {
    quizId: req.params.quizId,
    questionId: req.params.questionId
  });
  if (!token) {
    applyGeneratedPreviewHeaders(res, { nested: true });
    return res.status(HTTP_STATUS.UNAUTHORIZED).type('text/html').send(renderPreviewMessage('Preview expired', 'Return to CREATE and open Preview again.'));
  }

  const quiz = await Quiz.findOne({ _id: req.params.quizId, createdBy: token.userId })
    .populate({ path: 'questions', options: { sort: { order: 1 } } });

  if (!quiz) {
    return res.status(HTTP_STATUS.NOT_FOUND).type('text/html').send(renderPreviewMessage('Activity unavailable', 'This Learning Object could not be found.'));
  }

  const isColumnGroup = req.params.questionId.startsWith('column-group-');
  const requestedIds = isColumnGroup
    ? String(req.query.ids || '').split(',').filter(Boolean).slice(0, 100)
    : [req.params.questionId];
  const requestedIdSet = new Set(requestedIds);
  const selectedQuestions = quiz.questions.filter(item => requestedIdSet.has(item._id.toString()));
  const validColumnGroup = isColumnGroup
    && selectedQuestions.length === requestedIdSet.size
    && selectedQuestions.every(item => getH5PTypeAdapter(item.type)?.containers.includes('column'));
  const question = selectedQuestions[0];
  if ((!isColumnGroup && !question) || (isColumnGroup && !validColumnGroup)) {
    return res.status(HTTP_STATUS.NOT_FOUND).type('text/html').send(renderPreviewMessage('Activity unavailable', 'This question is no longer part of the Learning Object.'));
  }

  const adapter = getH5PTypeAdapter(question.type);
  const itemContainer = isColumnGroup
    ? 'column'
    : (adapter?.containers.includes('standalone') ? 'standalone' : 'column');
  const itemQuiz = quiz.toObject();
  itemQuiz.questions = isColumnGroup ? selectedQuestions : [question];

  try {
    const document = await buildNativeH5PDocument(itemQuiz, { containerMode: itemContainer });
    const html = await renderNativeH5PPreview(document, { contentId: `mixed-${req.params.questionId}` });
    applyGeneratedPreviewHeaders(res, { nested: true });
    return res.type('text/html').send(html);
  } catch (error) {
    console.error('[H5P Preview] Mixed activity item failed', { type: question.type, code: error.code, message: error.message });
    applyGeneratedPreviewHeaders(res, { nested: true });
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).type('text/html').send(renderPreviewMessage(
      'Question could not be rendered',
      error.code === 'QUESTION_TYPE_UNAVAILABLE' ? error.message : 'A required H5P component could not be loaded.'
    ));
  }
}));

router.get('/quiz/:quizId/render', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const loFilter = req.query.lo || null;
  const supportedContainerModes = new Set(['column', 'question-set', 'interactive-book', 'standalone', 'mixed-activity']);
  const requestedContainerMode = String(req.query.containerMode || '');
  if (requestedContainerMode && !supportedContainerModes.has(requestedContainerMode)) {
    return errorResponse(
      res,
      'Choose a supported H5P preview format.',
      'INVALID_H5P_PREVIEW_FORMAT',
      HTTP_STATUS.BAD_REQUEST
    );
  }
  const containerMode = requestedContainerMode || null;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: req.user.id })
    .populate({
      path: 'questions',
      populate: { path: 'learningObjective', select: 'text order' },
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives', 'text order');

  if (!quiz) {
    return errorResponse(res, 'Quiz not found', 'NOT_FOUND', HTTP_STATUS.NOT_FOUND);
  }

  let questions = quiz.questions || [];
  let filteredByObjective = false;

  if (loFilter && loFilter !== 'null') {
    const filterValue = String(loFilter);
    let targetObjective = quiz.learningObjectives?.find(
      objective => objective._id.toString() === filterValue
    );

    // Keep old index-based preview URLs working while the UI migrates to ids.
    if (!targetObjective && /^\d+$/.test(filterValue)) {
      targetObjective = quiz.learningObjectives?.[Number.parseInt(filterValue, 10)];
    }

    if (!targetObjective) {
      return errorResponse(
        res,
        'The selected Learning Objective is no longer available.',
        'LEARNING_OBJECTIVE_NOT_FOUND',
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const targetObjectiveId = targetObjective._id.toString();
    questions = questions.filter(
      question => question.learningObjective?._id?.toString() === targetObjectiveId
    );
    filteredByObjective = true;
  }

  if (questions.length === 0) {
    applyGeneratedPreviewHeaders(res);
    return res.type('text/html').send(renderPreviewMessage(
      'No questions to preview',
      'Add a question or choose another Learning Objective.'
    ));
  }

  if (containerMode === 'standalone' && questions.length === 1 && questions[0].type === 'branching-scenario') {
    try {
      const source = quiz.toObject();
      source.questions = questions.map(question => question.toObject?.() || question);
      const document = await buildNativeH5PDocument(source, { containerMode: 'standalone' });
      const html = await renderNativeH5PPreview(document, { contentId: `branching-${quizId}` });
      applyGeneratedPreviewHeaders(res);
      return res.type('text/html').send(html);
    } catch (error) {
      console.error('[H5P Preview] Branching Scenario could not render', { code: error.code, message: error.message });
      applyGeneratedPreviewHeaders(res);
      return res.status(HTTP_STATUS.BAD_REQUEST).type('text/html').send(renderPreviewMessage(
        'Branching Scenario needs review',
        error.code === 'INVALID_BRANCHING_SCENARIO_CONTENT'
          ? error.message
          : 'A required H5P component could not be loaded. Please contact support.'
      ));
    }
  }

  const html = await renderLegacyH5PPreview(quiz.toObject(), questions, containerMode || 'column');
  applyGeneratedPreviewHeaders(res);
  return res.type('text/html').send(html);
}));

/**
 * GET /:id/render — Render an uploaded and extracted H5P package.
 */
router.get('/:id/render', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const extractDir = path.join(UPLOAD_BASE, id);

  // Verify the extracted directory exists
  try {
    await fs.access(extractDir);
  } catch {
    return errorResponse(res, 'Preview not found. It may have expired.', 'NOT_FOUND', HTTP_STATUS.NOT_FOUND);
  }

  // Read h5p.json
  const h5pJson = JSON.parse(await fs.readFile(path.join(extractDir, 'h5p.json'), 'utf-8'));

  // Read content.json
  let contentJson;
  try {
    contentJson = JSON.parse(await fs.readFile(path.join(extractDir, 'content', 'content.json'), 'utf-8'));
  } catch {
    return errorResponse(res, 'Missing content/content.json in H5P package', 'INVALID_H5P', HTTP_STATUS.BAD_REQUEST);
  }

  const mainLib = h5pJson.mainLibrary;
  const mainDependency = (h5pJson.preloadedDependencies || []).find(
    dependency => dependency.machineName === mainLib
  );
  if (!mainDependency) {
    return errorResponse(res, 'The package does not declare its main H5P library.', 'INVALID_H5P', HTTP_STATUS.BAD_REQUEST);
  }

  // A package must contain its own matching runtime assets. Do not silently
  // fill missing files with a different installed patch of the same library.
  const basePath = `/h5p-preview-files/${id}`;
  applyGeneratedPreviewHeaders(res);
  try {
    const html = await renderNativeH5PPreview({
      library: `${mainLib} ${mainDependency.majorVersion}.${mainDependency.minorVersion}`,
      metadata: h5pJson,
      parameters: contentJson
    }, {
      libraryPath: extractDir,
      libraryBasePath: basePath,
      contentBasePath: `${basePath}/content`,
      contentId: id
    });
    return res.type('text/html').send(html);
  } catch (error) {
    console.error('[H5P Preview] Uploaded package preview failed', { code: error.code, message: error.message });
    return res.status(HTTP_STATUS.BAD_REQUEST).type('text/html').send(renderPreviewMessage(
      'Preview could not be created',
      'This package is missing a required H5P component. Export a complete package from its authoring tool and try again.'
    ));
  }
}));

/**
 * Clean up extracted preview directories older than MAX_AGE_MS
 */
async function cleanupOldPreviews() {
  try {
    await fs.access(UPLOAD_BASE);
  } catch {
    return; // Directory doesn't exist yet
  }

  const entries = await fs.readdir(UPLOAD_BASE, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(UPLOAD_BASE, entry.name);
    try {
      const stat = await fs.stat(dirPath);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        await fs.rm(dirPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
}

/**
 * Simple HTML escape
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
