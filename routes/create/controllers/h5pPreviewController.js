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
import Quiz from '../models/Quiz.js';
import { buildNativeH5PDocument } from '../services/h5pExportService.js';
import { renderNativeH5PPreview } from '../services/h5pNativePreviewService.js';
import { resolveNativeH5PContainerMode } from '../services/h5pNativeDocumentConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Upload directory for extracted H5P previews
const UPLOAD_BASE = path.join(__dirname, '..', 'uploads', 'h5p-preview');
const H5P_LIBS_DIR = path.join(__dirname, '..', 'h5p-libs');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour TTL for extracted files

function applyGeneratedPreviewHeaders(res) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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
router.get('/core/h5p-core.js', asyncHandler(async (req, res) => {
  const corePath = path.join(__dirname, '..', 'h5p-core', 'h5p-core.js');
  res.type('application/javascript').sendFile(corePath);
}));

router.get('/core/js/jquery.js', asyncHandler(async (_req, res) => {
  const jqueryPath = path.join(__dirname, '..', 'h5p-core', 'js', 'jquery.js');
  res.type('application/javascript').sendFile(jqueryPath);
}));

/**
 * GET /libs/* — Serve H5P library files (JS, CSS, fonts, images).
 * Uses the existing /api/create/h5p-preview/ route so no nginx config is needed.
 */
router.get('/libs/*', (req, res) => {
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
router.get('/quiz/:quizId/render', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const loFilter = req.query.lo || null;
  const supportedContainerModes = new Set(['column', 'question-set', 'interactive-book', 'standalone']);
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

  const previewQuiz = quiz.toObject();
  previewQuiz.questions = questions;
  const effectiveContainerMode = resolveNativeH5PContainerMode(previewQuiz, containerMode);

  // A filtered Interactive Book preview is intentionally a one-chapter subset.
  // Keeping the saved chapter map would otherwise reference questions omitted by
  // the Learning Objective filter.
  if (filteredByObjective && effectiveContainerMode === 'interactive-book') {
    previewQuiz.chapters = [{
      title: 'Filtered questions',
      questionIds: questions.map(question => question._id),
      containerType: 'column',
      passPercentage: 50
    }];
  }

  try {
    const nativeDocument = await buildNativeH5PDocument(previewQuiz, {
      containerMode: effectiveContainerMode
    });
    const html = await renderNativeH5PPreview(nativeDocument);

    applyGeneratedPreviewHeaders(res);
    return res.type('text/html').send(html);
  } catch (error) {
    console.error('[H5P Preview] Native preview failed', {
      code: error.code || 'UNKNOWN',
      message: error.message
    });
    applyGeneratedPreviewHeaders(res);
    const status = error.code === 'INVALID_STANDALONE_H5P_SOURCE'
      ? HTTP_STATUS.BAD_REQUEST
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    return res.status(status).type('text/html').send(renderPreviewMessage(
      'Preview could not be created',
      error.code === 'INVALID_STANDALONE_H5P_SOURCE'
        ? error.message
        : 'CREATE could not load every H5P component required by this Learning Object. Try again after restarting the server or contact support.'
    ));
  }
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

  // Resolve all dependencies (topological sort)
  const { cssFiles, jsFiles } = await resolveDependencies(h5pJson, extractDir);

  // Build the base path for static files
  const basePath = `/h5p-preview-files/${id}`;

  // Build the main library string "H5P.MultiChoice 1.16"
  const mainLib = h5pJson.mainLibrary;
  const mainDep = (h5pJson.preloadedDependencies || []).find(d => d.machineName === mainLib);
  const mainLibString = mainDep
    ? `${mainLib} ${mainDep.majorVersion}.${mainDep.minorVersion}`
    : mainLib;

  // Generate CSS link tags
  const cssTags = cssFiles.map(f => `  <link rel="stylesheet" href="${basePath}/${f}">`).join('\n');

  // Generate JS script tags
  const jsTags = jsFiles.map(f => `  <script src="${basePath}/${f}"></script>`).join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(h5pJson.title || 'H5P Preview')}</title>
  <style>
    :root {
      --h5p-theme-main-cta-base: #2374e3;
      --h5p-theme-main-cta-dark: #1a5bbf;
      --h5p-theme-main-cta-light: #5a9af0;
      --h5p-theme-secondary-cta-base: #4a4a4a;
      --h5p-theme-secondary-cta-dark: #2a2a2a;
      --h5p-theme-secondary-cta-light: #6a6a6a;
      --h5p-theme-contrast-cta: #ffffff;
      --h5p-theme-contrast-cta-light: #f0f4ff;
      --h5p-theme-contrast-cta-white: #ffffff;
      --h5p-theme-secondary-contrast-cta: #ffffff;
      --h5p-theme-secondary-contrast-cta-hover: #f5f5f5;
      --h5p-theme-alternative-base: #ffffff;
      --h5p-theme-alternative-dark: #f3f4f6;
      --h5p-theme-alternative-darker: #e5e7eb;
      --h5p-theme-alternative-light: #f9fafb;
      --h5p-theme-ui-base: #f9fafb;
      --h5p-theme-text-primary: #111827;
      --h5p-theme-text-secondary: #374151;
      --h5p-theme-text-third: #6b7280;
      --h5p-theme-stroke-1: #e5e7eb;
      --h5p-theme-font-name: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --h5p-theme-font-size-s: 12px;
      --h5p-theme-font-size-m: 16px;
      --h5p-theme-font-size-l: 20px;
      --h5p-theme-font-size-xl: 24px;
      --h5p-theme-font-size-xxl: 32px;
      --h5p-theme-spacing-xxs: 4px;
      --h5p-theme-spacing-xs: 8px;
      --h5p-theme-spacing-s: 12px;
      --h5p-theme-spacing-m: 16px;
      --h5p-theme-spacing-l: 24px;
      --h5p-theme-border-radius-small: 4px;
      --h5p-theme-border-radius-medium: 6px;
      --h5p-theme-border-radius-large: 12px;
      --h5p-theme-feedback-correct-main: #166534;
      --h5p-theme-feedback-correct-secondary: #dcfce7;
      --h5p-theme-feedback-correct-third: #86efac;
      --h5p-theme-feedback-incorrect-main: #991b1b;
      --h5p-theme-feedback-incorrect-secondary: #fee2e2;
      --h5p-theme-feedback-incorrect-third: #fca5a5;
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; }
    .h5p-content { max-width: 960px; margin: 0 auto; }
    .h5p-question-content { font-size: 16px; line-height: 1.5; }
    .h5p-question-introduction { margin-bottom: 1em; }
    .h5p-question-buttons { margin-top: 1em; }
    .h5p-joubelui-button { cursor: pointer; }
  </style>
${cssTags}
</head>
<body>
  <div id="h5p-container" class="h5p-content"></div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
  <script src="/api/create/h5p-preview/core/h5p-core.js"></script>
${jsTags}

  <script>
    // Ensure H5P.jQuery is set after jQuery loads
    H5P.jQuery = jQuery;
    H5P.$body = jQuery('body');
    H5P.$window = jQuery(window);

    var integration = {
      basePath: '${basePath}',
      contentPath: '${basePath}/content',
      contentId: '${id}',
      mainLibrary: '${mainLibString}',
      title: ${JSON.stringify(h5pJson.title || 'H5P Preview')},
      contentData: ${JSON.stringify(contentJson)},
      metadata: ${JSON.stringify(h5pJson.metadata || { title: h5pJson.title || 'H5P Preview' })}
    };

    jQuery(document).ready(function() {
      H5P.init(document.getElementById('h5p-container'), integration);
    });
  </script>
</body>
</html>`;

  // Override Helmet's CSP to allow framing and inline scripts/CDN resources
  res.removeHeader('Content-Security-Policy');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.type('text/html').send(html);
}));


/**
 * Resolve the full dependency tree from h5p.json into ordered CSS and JS file lists.
 * Uses topological sort (Kahn's algorithm) to ensure correct load order.
 * Used by the upload-based preview (/:id/render).
 */
async function resolveDependencies(h5pJson, extractDir) {
  const deps = h5pJson.preloadedDependencies || [];

  // Map: "machineName-major.minor" → { dirName, css[], js[], deps[] }
  const libMap = new Map();
  const adjacency = new Map(); // key → [dependency keys]
  const inDegree = new Map();

  // BFS to discover all libraries and their transitive dependencies
  const queue = [...deps];
  const visited = new Set();

  while (queue.length > 0) {
    const dep = queue.shift();
    const key = `${dep.machineName}-${dep.majorVersion}.${dep.minorVersion}`;
    if (visited.has(key)) continue;
    visited.add(key);

    // Find the library directory — could be in extracted H5P or in h5p-libs
    const dirName = `${dep.machineName}-${dep.majorVersion}.${dep.minorVersion}`;
    let libJsonPath = path.join(extractDir, dirName, 'library.json');
    let libBasePath = dirName; // relative path for URL generation
    let libDirExists = false;

    try {
      await fs.access(libJsonPath);
      libDirExists = true;
    } catch {
      // Try the shared h5p-libs directory
      libJsonPath = path.join(H5P_LIBS_DIR, dirName, 'library.json');
      try {
        await fs.access(libJsonPath);
        libDirExists = true;
      } catch {
        // Library not found — skip
      }
    }

    if (!libDirExists) {
      libMap.set(key, { dirName, css: [], js: [], deps: [] });
      adjacency.set(key, []);
      inDegree.set(key, inDegree.get(key) || 0);
      continue;
    }

    const libJson = JSON.parse(await fs.readFile(libJsonPath, 'utf-8'));

    // Merge from shared h5p-libs into extracted dir so static serving works.
    // Always merge (not just when missing) because the .h5p archive may contain
    // incomplete library dirs (e.g. metadata only, no dist/ build artifacts).
    const extractedLibDir = path.join(extractDir, dirName);
    const sharedLibDir = path.join(H5P_LIBS_DIR, dirName);
    try {
      await fs.access(sharedLibDir);
      await mergeDir(sharedLibDir, extractedLibDir);
    } catch {
      // Shared lib not available, rely on whatever's in the archive
    }

    const css = (libJson.preloadedCss || []).map(f => `${dirName}/${f.path}`);
    const js = (libJson.preloadedJs || []).map(f => `${dirName}/${f.path}`);
    const subDeps = libJson.preloadedDependencies || [];
    const subDepKeys = subDeps.map(d => `${d.machineName}-${d.majorVersion}.${d.minorVersion}`);

    libMap.set(key, { dirName, css, js, deps: subDepKeys });
    adjacency.set(key, subDepKeys);

    if (!inDegree.has(key)) {
      inDegree.set(key, 0);
    }

    // Enqueue sub-dependencies
    for (const subDep of subDeps) {
      queue.push(subDep);
    }
  }

  // Build in-degree counts
  for (const [key, depKeys] of adjacency) {
    for (const depKey of depKeys) {
      inDegree.set(depKey, (inDegree.get(depKey) || 0));
    }
  }
  // A depends on B means B must load before A → A has edge to B
  // In-degree: count how many things depend on each lib (incoming edges)
  // Actually, for topological sort with Kahn's, we need: if A depends on B, then B must come first.
  // So the edge is B → A (B must come before A), and A's in-degree increases.
  const reverseAdj = new Map();
  const realInDegree = new Map();
  for (const key of adjacency.keys()) {
    reverseAdj.set(key, []);
    realInDegree.set(key, 0);
  }
  for (const [key, depKeys] of adjacency) {
    for (const depKey of depKeys) {
      if (!reverseAdj.has(depKey)) reverseAdj.set(depKey, []);
      reverseAdj.get(depKey).push(key);
      realInDegree.set(key, (realInDegree.get(key) || 0) + 1);
    }
  }

  // Kahn's algorithm
  const sorted = [];
  const q = [];
  for (const [key, deg] of realInDegree) {
    if (deg === 0) q.push(key);
  }

  while (q.length > 0) {
    const current = q.shift();
    sorted.push(current);
    for (const neighbor of (reverseAdj.get(current) || [])) {
      realInDegree.set(neighbor, realInDegree.get(neighbor) - 1);
      if (realInDegree.get(neighbor) === 0) {
        q.push(neighbor);
      }
    }
  }

  // If there are nodes not in sorted (cycle), add them at the end
  for (const key of adjacency.keys()) {
    if (!sorted.includes(key)) {
      sorted.push(key);
    }
  }

  // Collect CSS and JS in dependency order, filtering out files that don't exist on disk
  const cssFiles = [];
  const jsFiles = [];
  for (const key of sorted) {
    const lib = libMap.get(key);
    if (lib) {
      for (const f of lib.css) {
        const fullPath = path.join(extractDir, f);
        try {
          await fs.access(fullPath);
          cssFiles.push(f);
        } catch {
          // File doesn't exist (e.g. missing dist/ build), skip it
        }
      }
      for (const f of lib.js) {
        const fullPath = path.join(extractDir, f);
        try {
          await fs.access(fullPath);
          jsFiles.push(f);
        } catch {
          // File doesn't exist (e.g. missing dist/ build), skip it
        }
      }
    }
  }

  return { cssFiles, jsFiles };
}

/**
 * Recursively merge src into dest — copies files that don't already exist in dest.
 * This fills in missing build artifacts (dist/) without overwriting archive contents.
 */
async function mergeDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await mergeDir(srcPath, destPath);
    } else {
      try {
        await fs.access(destPath);
        // File already exists in archive, skip
      } catch {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

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
