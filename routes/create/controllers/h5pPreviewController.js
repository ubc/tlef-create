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
import Quiz from '../models/Quiz.js';
import { convertQuestionToH5P } from '../services/h5pExportService.js';
import LIBRARY_REGISTRY, { getNeededLibraries } from '../config/h5pLibraryRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Upload directory for extracted H5P previews
const UPLOAD_BASE = path.join(__dirname, '..', 'uploads', 'h5p-preview');
const H5P_LIBS_DIR = path.join(__dirname, '..', 'h5p-libs');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour TTL for extracted files

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

/**
 * GET /quiz/:quizId/render — Render quiz questions as real H5P content in-browser.
 * Each question gets its own numbered header + H5P.newRunnable() instance.
 * Supports ?lo=<loId> to filter by a specific learning objective.
 */
router.get('/quiz/:quizId/render', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const loFilter = req.query.lo || null;

  // Fetch quiz with populated questions and learning objectives
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

  // Filter by learning objective if specified
  if (loFilter && loFilter !== 'null') {
    const loIndex = parseInt(loFilter, 10);
    if (!isNaN(loIndex) && quiz.learningObjectives && quiz.learningObjectives[loIndex]) {
      const targetLOText = quiz.learningObjectives[loIndex].text;
      questions = questions.filter(q => {
        const loText = q.learningObjective?.text;
        return loText === targetLOText;
      });
    }
  }

  if (questions.length === 0) {
    res.removeHeader('Content-Security-Policy');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    return res.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { margin:0; padding:40px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#666; text-align:center; }
</style></head><body><p>No questions to display.</p></body></html>`);
  }

  // Convert each question to H5P format
  const h5pQuestions = [];
  for (const question of questions) {
    const h5pContent = convertQuestionToH5P(question, quiz);
    if (h5pContent) {
      h5pQuestions.push({ question, h5pContent });
    }
  }

  // Determine needed libraries from all question types
  const questionTypes = new Set(questions.map(q => q.type));
  const neededLibNames = getNeededLibraries(questionTypes, {
    hasMixedContent: false,
    isFlashcardOnly: questionTypes.size === 1 && questionTypes.has('flashcard')
  });

  // Build a synthetic h5p.json with those dependencies for resolveDependencies
  const preloadedDependencies = [];
  for (const libName of neededLibNames) {
    const lib = LIBRARY_REGISTRY[libName];
    if (lib) {
      preloadedDependencies.push({
        machineName: libName,
        majorVersion: lib.majorVersion,
        minorVersion: lib.minorVersion
      });
    }
  }

  const syntheticH5pJson = {
    title: quiz.name || 'Quiz Preview',
    mainLibrary: 'H5P.Column',
    preloadedDependencies
  };

  // Resolve CSS/JS dependencies in correct load order.
  // Read directly from h5p-libs (no temp dir or symlinks needed).
  const { cssFiles, jsFiles } = await resolveLibraryDependencies(syntheticH5pJson);

  const libBasePath = '/h5p-libs';
  const cssTags = cssFiles.map(f => `  <link rel="stylesheet" href="${libBasePath}/${f}">`).join('\n');
  const jsTags = jsFiles.map(f => `  <script src="${libBasePath}/${f}" onerror="window.__h5pLoadErrors=(window.__h5pLoadErrors||[]);window.__h5pLoadErrors.push('${f.replace(/'/g, "\\'")}')"></script>`).join('\n');

  // Build per-question HTML blocks and H5P.newRunnable() calls
  const questionBlocks = [];
  const runnableCalls = [];

  h5pQuestions.forEach(({ question, h5pContent }, idx) => {
    const num = idx + 1;
    const typeLabel = formatQuestionType(question.type);
    const difficulty = question.difficulty ? ` \u00b7 ${capitalize(question.difficulty)}` : '';
    const containerId = `h5p-question-${idx}`;

    questionBlocks.push(`
      <div class="question-block">
        <div class="question-header">
          <span class="question-number">Q${num}</span>
          <span class="question-meta">${escapeHtml(typeLabel)}${escapeHtml(difficulty)}</span>
        </div>
        <div id="${containerId}" class="h5p-question-container"></div>
      </div>`);

    runnableCalls.push(`
      (function() {
        var library = ${JSON.stringify(h5pContent)};
        var $container = jQuery('#${containerId}');
        $container.addClass('h5p-content');
        H5P.newRunnable(library, 'preview-${quizId}-${idx}', $container, false, {
          metadata: library.metadata || {}
        });
      })();`);
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(quiz.name || 'Quiz Preview')}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f9fafb;
    }
    .questions-container { max-width: 960px; margin: 0 auto; }
    .question-block {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .question-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: #f3f4f6;
      border-bottom: 1px solid #e5e7eb;
      font-size: 14px;
      color: #374151;
    }
    .question-number {
      font-weight: 700;
      color: #2563eb;
    }
    .question-meta {
      color: #6b7280;
    }
    .h5p-question-container {
      padding: 8px;
    }
    .h5p-content { max-width: none; }

    /* Ensure H5P buttons are visible */
    .h5p-question-buttons { margin-top: 1em; }
    .h5p-joubelui-button { cursor: pointer; }
  </style>
${cssTags}
</head>
<body>
  <div class="questions-container">
${questionBlocks.join('\n')}
  </div>

  <script>
    // Track JS errors during library loading (must be before library scripts)
    window.__h5pErrors = [];
    window.__h5pLoadErrors = [];
    window.onerror = function(msg, src, line, col, err) {
      window.__h5pErrors.push({msg: msg, src: src, line: line});
      console.error('H5P Script Error:', msg, 'in', src, 'line', line);
    };
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
  <script src="/api/create/h5p-preview/core/h5p-core.js"></script>
${jsTags}

  <script>
    H5P.jQuery = jQuery;
    H5P.$body = jQuery('body');
    H5P.$window = jQuery(window);

    jQuery(document).ready(function() {
      // Log load failures and available constructors for debugging
      if (window.__h5pLoadErrors.length > 0) {
        console.error('H5P: Failed to load scripts:', window.__h5pLoadErrors);
      }
      if (window.__h5pErrors.length > 0) {
        console.error('H5P: JS errors during loading:', window.__h5pErrors);
      }

${runnableCalls.join('\n')}
    });
  </script>
</body>
</html>`;

  res.removeHeader('Content-Security-Policy');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.type('text/html').send(html);
}));

/**
 * GET /:id/render — Generate and serve the full HTML page for rendering H5P content
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
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; }
    .h5p-content { max-width: 960px; margin: 0 auto; }
    .h5p-question-content { font-size: 16px; line-height: 1.5; }
    .h5p-question-introduction { margin-bottom: 1em; }

    /* Ensure buttons are visible */
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
 * Resolve library dependencies directly from h5p-libs directory.
 * No temp directory, symlinks, or file copying needed — files are served
 * via the /h5p-libs static route.
 * Uses topological sort (Kahn's algorithm) to ensure correct load order.
 */
async function resolveLibraryDependencies(h5pJson) {
  const deps = h5pJson.preloadedDependencies || [];

  const libMap = new Map();
  const adjacency = new Map();

  // BFS to discover all libraries and their transitive dependencies
  const queue = [...deps];
  const visited = new Set();

  while (queue.length > 0) {
    const dep = queue.shift();
    const key = `${dep.machineName}-${dep.majorVersion}.${dep.minorVersion}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const dirName = key;
    const libJsonPath = path.join(H5P_LIBS_DIR, dirName, 'library.json');

    let libDirExists = false;
    try {
      await fs.access(libJsonPath);
      libDirExists = true;
    } catch {
      // Library not found — skip
    }

    if (!libDirExists) {
      libMap.set(key, { dirName, css: [], js: [], deps: [] });
      adjacency.set(key, []);
      continue;
    }

    const libJson = JSON.parse(await fs.readFile(libJsonPath, 'utf-8'));

    const css = (libJson.preloadedCss || []).map(f => `${dirName}/${f.path}`);
    const js = (libJson.preloadedJs || []).map(f => `${dirName}/${f.path}`);
    const subDeps = libJson.preloadedDependencies || [];
    const subDepKeys = subDeps.map(d => `${d.machineName}-${d.majorVersion}.${d.minorVersion}`);

    libMap.set(key, { dirName, css, js, deps: subDepKeys });
    adjacency.set(key, subDepKeys);

    for (const subDep of subDeps) {
      queue.push(subDep);
    }
  }

  // Build reverse adjacency and in-degree for Kahn's algorithm
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

  // Kahn's algorithm — topological sort
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
  // Add any remaining nodes (cycles) at the end
  for (const key of adjacency.keys()) {
    if (!sorted.includes(key)) sorted.push(key);
  }

  // Collect CSS and JS in dependency order, verifying files exist on disk.
  // f is like "H5P.DragText-1.10/dist/h5p-drag-text.js" and H5P_LIBS_DIR
  // is the parent containing those library directories.
  const cssFiles = [];
  const jsFiles = [];
  for (const key of sorted) {
    const lib = libMap.get(key);
    if (!lib) continue;
    for (const f of lib.css) {
      try {
        await fs.access(path.join(H5P_LIBS_DIR, f));
        cssFiles.push(f);
      } catch { /* skip missing */ }
    }
    for (const f of lib.js) {
      try {
        await fs.access(path.join(H5P_LIBS_DIR, f));
        jsFiles.push(f);
      } catch { /* skip missing */ }
    }
  }

  return { cssFiles, jsFiles };
}

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

/**
 * Format a question type for display
 */
function formatQuestionType(type) {
  const labels = {
    'multiple-choice': 'Multiple Choice',
    'true-false': 'True / False',
    'flashcard': 'Flashcard',
    'matching': 'Matching',
    'ordering': 'Ordering',
    'cloze': 'Fill in the Blanks',
    'summary': 'Summary',
    'discussion': 'Discussion'
  };
  return labels[type] || type;
}

/**
 * Capitalize the first letter
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default router;
