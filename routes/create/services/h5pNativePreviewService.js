import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import { H5P_CORE_SCRIPTS, H5P_CORE_STYLES, runtimeAssetUrl } from '../config/h5pRuntime.js';

const require = createRequire(import.meta.url);
const coreTranslations = require('@lumieducation/h5p-server/build/assets/translations/client/en.json');

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LIBRARY_PATH = path.resolve(SERVICE_DIR, '../h5p-libs');
const nativePreviewAssetCache = new Map();

function assertNativeDocument(document) {
  if (
    typeof document?.library !== 'string'
    || !document.library.trim()
    || !document.metadata
    || typeof document.metadata !== 'object'
    || document.parameters === undefined
  ) {
    const error = new Error('The native H5P preview document is malformed.');
    error.code = 'INVALID_NATIVE_H5P_PREVIEW_DOCUMENT';
    throw error;
  }
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolve runtime assets declared by a native H5P document. The traversal only
 * follows preloaded dependencies: H5PEditor dependencies belong to the authoring
 * surface and must not be executed in the learner preview.
 */
export async function resolveNativePreviewAssets(h5pJson, options = {}) {
  const libraryPath = options.libraryPath || DEFAULT_LIBRARY_PATH;
  const cacheKey = !options.libraryPath && options.cache !== false
    ? JSON.stringify(h5pJson?.preloadedDependencies || [])
    : null;
  if (cacheKey && nativePreviewAssetCache.has(cacheKey)) {
    const cached = nativePreviewAssetCache.get(cacheKey);
    return {
      cssFiles: [...cached.cssFiles],
      jsFiles: [...cached.jsFiles],
      missingFiles: [...cached.missingFiles]
    };
  }
  const queue = (h5pJson?.preloadedDependencies || [])
    .filter(dependency => !dependency.machineName?.startsWith('H5PEditor'));
  const libraries = new Map();
  const dependencies = new Map();
  const visited = new Set();

  while (queue.length > 0) {
    const dependency = queue.shift();
    const key = `${dependency.machineName}-${dependency.majorVersion}.${dependency.minorVersion}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const libraryJsonPath = path.join(libraryPath, key, 'library.json');
    let libraryJson;
    try {
      libraryJson = JSON.parse(await fs.readFile(libraryJsonPath, 'utf-8'));
    } catch {
      libraries.set(key, { css: [], js: [] });
      dependencies.set(key, []);
      libraries.get(key).missingDescriptor = `${key}/library.json`;
      continue;
    }

    const childDependencies = (libraryJson.preloadedDependencies || [])
      .filter(child => !child.machineName?.startsWith('H5PEditor'));
    const childKeys = childDependencies.map(
      child => `${child.machineName}-${child.majorVersion}.${child.minorVersion}`
    );
    libraries.set(key, {
      css: (libraryJson.preloadedCss || []).map(file => `${key}/${file.path}`),
      js: (libraryJson.preloadedJs || []).map(file => `${key}/${file.path}`)
    });
    dependencies.set(key, childKeys);
    queue.push(...childDependencies);
  }

  const reverseDependencies = new Map();
  const inDegree = new Map();
  for (const key of dependencies.keys()) {
    reverseDependencies.set(key, []);
    inDegree.set(key, 0);
  }
  for (const [key, childKeys] of dependencies) {
    for (const childKey of childKeys) {
      if (!reverseDependencies.has(childKey)) reverseDependencies.set(childKey, []);
      reverseDependencies.get(childKey).push(key);
      inDegree.set(key, (inDegree.get(key) || 0) + 1);
    }
  }

  const sorted = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([key]) => key);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    for (const parent of reverseDependencies.get(current) || []) {
      inDegree.set(parent, inDegree.get(parent) - 1);
      if (inDegree.get(parent) === 0) sorted.push(parent);
    }
  }
  for (const key of dependencies.keys()) {
    if (!sorted.includes(key)) sorted.push(key);
  }

  const cssFiles = [];
  const jsFiles = [];
  const missingFiles = [];
  for (const key of sorted) {
    const library = libraries.get(key);
    if (!library) continue;
    if (library.missingDescriptor) missingFiles.push(library.missingDescriptor);
    for (const relativePath of library.css) {
      try {
        await fs.access(path.join(libraryPath, relativePath));
        cssFiles.push(relativePath);
      } catch {
        missingFiles.push(relativePath);
      }
    }
    for (const relativePath of library.js) {
      try {
        await fs.access(path.join(libraryPath, relativePath));
        jsFiles.push(relativePath);
      } catch {
        missingFiles.push(relativePath);
      }
    }
  }

  const result = { cssFiles, jsFiles, missingFiles };
  if (cacheKey && missingFiles.length === 0) nativePreviewAssetCache.set(cacheKey, result);
  return result;
}

/**
 * Render the exact native document used by Studio and package export without
 * persisting a second H5P record.
 */
export async function renderNativeH5PPreview(document, options = {}) {
  assertNativeDocument(document);
  const libraryBasePath = options.libraryBasePath || '/api/create/h5p-preview/libs';
  const coreBasePath = options.coreBasePath || '/api/create/h5p-preview/core';
  const { cssFiles, jsFiles, missingFiles } = await resolveNativePreviewAssets(
    document.metadata,
    options
  );

  if (missingFiles.length > 0) {
    const error = new Error(`Missing H5P preview assets: ${missingFiles.join(', ')}`);
    error.code = 'MISSING_H5P_PREVIEW_ASSETS';
    error.missingFiles = missingFiles;
    throw error;
  }

  const title = document.metadata.title || options.title || 'H5P Preview';
  const contentId = options.contentId || 'preview-container';
  const coreCssTags = H5P_CORE_STYLES
    .map(asset => `  <link rel="stylesheet" href="${escapeHtml(runtimeAssetUrl(coreBasePath, asset))}">`).join('\n');
  const coreJsTags = H5P_CORE_SCRIPTS
    .map(asset => `  <script src="${escapeHtml(runtimeAssetUrl(coreBasePath, asset))}"></script>`).join('\n');
  const integration = serializeForInlineScript({
    baseUrl: '', url: '/api/create/h5p-preview', urlLibraries: libraryBasePath,
    postUserStatistics: false, saveFreq: false, user: { name: 'Preview', mail: '' },
    loadedJs: [], loadedCss: [], core: { scripts: [], styles: [] },
    l10n: { H5P: coreTranslations },
    contents: { [`cid-${contentId}`]: {
      library: document.library, jsonContent: JSON.stringify(document.parameters),
      metadata: document.metadata, contentUrl: options.contentBasePath || '/api/create/h5p-preview/content',
      displayOptions: { frame: false, export: false, embed: false, copyright: false, icon: false },
      contentUserData: [{ state: false }]
    } }
  });
  const cssTags = cssFiles
    .map(file => `  <link rel="stylesheet" href="${libraryBasePath}/${file}">`)
    .join('\n');
  const jsTags = jsFiles
    .map(file => `  <script src="${libraryBasePath}/${file}"></script>`)
    .join('\n');
  const runnable = serializeForInlineScript({
    library: document.library,
    params: document.parameters,
    subContentId: 'preview-container',
    metadata: document.metadata
  });
  const xapiBridge = options.xapiBridge ? serializeForInlineScript({
    questionId: String(options.xapiBridge.questionId || contentId)
  }) : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
${coreCssTags}
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
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--h5p-theme-font-name);
      background: #f9fafb;
    }
    #h5p-native-preview {
      width: 100%;
      min-height: 240px;
      max-width: 1100px;
      margin: 0 auto;
    }
    #h5p-native-preview.h5p-content { width: 100% !important; }
    @media (max-width: 480px) {
      body { padding: 0; }
      #h5p-native-preview.h5p-content { padding: 0; border: 0; }
    }
  </style>
${cssTags}
</head>
<body>
  <div id="h5p-native-preview" class="h5p-content h5p-initialized h5p-large"></div>
  <script>
    window.H5PIntegration = ${integration};
    H5PIntegration.siteUrl = window.location.origin;
    // Read-only sandboxed previews do not use core's localStorage/offline queue.
    // Keep the official runtime, then initialize this runnable explicitly once.
    window.H5P = { preventInit: true };
  </script>
${coreJsTags}
${jsTags}
  <script>
    H5P.jQuery(document).ready(function() {
      var runnable = ${runnable};
      var container = H5P.jQuery('#h5p-native-preview');
      H5P.init(document.createElement('div'));
      var instance = H5P.newRunnable(runnable, ${serializeForInlineScript(contentId)}, container, false, {
        metadata: runnable.metadata || {}, standalone: true
      });
      if (instance) H5P.instances.push(instance);

      ${xapiBridge ? `var bridge = ${xapiBridge};
      if (H5P.externalDispatcher) {
        H5P.externalDispatcher.on('xAPI', function(event) {
          window.parent.postMessage({
            type: 'tlef:h5p-xapi',
            questionId: bridge.questionId,
            statement: event && event.data && event.data.statement
          }, '*');
        });
      }` : ''}

      var reportHeight = function() {
        var previewRoot = document.getElementById('h5p-native-preview');
        if (!previewRoot) return;
        var rootRect = previewRoot.getBoundingClientRect();
        var bodyStyle = window.getComputedStyle(document.body);
        var paddingBottom = Number.parseFloat(bodyStyle.paddingBottom) || 0;
        var contentBottom = window.scrollY + rootRect.top
          + Math.max(rootRect.height, previewRoot.scrollHeight);
        window.parent.postMessage({
          type: 'tlef:h5p-preview-height',
          height: Math.ceil(contentBottom + paddingBottom)
        }, '*');
      };
      if (window.ResizeObserver) {
        new ResizeObserver(reportHeight).observe(document.getElementById('h5p-native-preview'));
      }
      reportHeight();
      window.setTimeout(reportHeight, 250);
      window.setTimeout(reportHeight, 1000);
    });
  </script>
</body>
</html>`;
}

/**
 * Render a CREATE Mixed Activity as isolated native H5P players. Each question
 * keeps its own root library, so standalone-only activities do not have to be
 * embedded in H5P.Column. The child players report their size to this shell,
 * which in turn reports the total height to the CREATE preview iframe.
 */
export function renderMixedActivityPreview({ title = 'Mixed Activity', items = [], scoreEndpoint = '' } = {}) {
  const cards = items.map((item, index) => `
    <section class="mixed-item">
      <h2 class="mixed-item-title">${escapeHtml(item.title || `Activity ${index + 1}`)}</h2>
      <div class="mixed-item-loading" role="status">Loading activity…</div>
      <iframe
        class="mixed-item-frame"
        src="about:blank"
        data-src="${escapeHtml(item.url)}"
        title="${escapeHtml(item.title || `Activity ${index + 1}`)}"
        loading="lazy"
        sandbox="allow-scripts"
      ></iframe>
    </section>`).join('\n');
  const scoreConfig = serializeForInlineScript({ scoreEndpoint });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f8fafc; color: #111827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .mixed-activity { width: 100%; max-width: 1100px; margin: 0 auto; padding: 16px; }
    .mixed-item { overflow: hidden; margin: 0 0 16px; border: 1px solid #dbe3ef; border-radius: 12px; background: #fff; }
    .mixed-item-title { margin: 0; padding: 12px 16px 0; color: #475569; font-size: 14px; font-weight: 650; }
    .mixed-item-loading { padding: 24px 16px; color: #64748b; font-size: 14px; }
    .mixed-item[data-loaded="true"] .mixed-item-loading { display: none; }
    .mixed-item-frame { display: block; width: 100%; min-height: 260px; border: 0; background: #fff; }
    @media (max-width: 480px) { .mixed-activity { padding: 0; } .mixed-item { border-width: 0 0 1px; border-radius: 0; } }
  </style>
</head>
<body>
  <main class="mixed-activity">${cards}</main>
  <script>
    (function() {
      var config = ${scoreConfig};
      var frames = Array.prototype.slice.call(document.querySelectorAll('.mixed-item-frame'));
      var scores = {};
      var nextFrameIndex = 0;
      var startNextFrame = function() {
        if (nextFrameIndex >= frames.length) return false;
        var frame = frames[nextFrameIndex++];
        if (!frame.dataset.src || frame.dataset.started === 'true') return startNextFrame();
        frame.dataset.started = 'true';
        frame.src = frame.dataset.src;
        return true;
      };
      var reportHeight = function() {
        window.parent.postMessage({
          type: 'tlef:h5p-preview-height',
          height: Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))
        }, '*');
      };
      window.addEventListener('message', function(event) {
        var frame = frames.find(function(candidate) { return candidate.contentWindow === event.source; });
        if (!frame) return;
        if (event.data && event.data.type === 'tlef:h5p-xapi' && config.scoreEndpoint) {
          var statement = event.data.statement;
          var result = statement && statement.result;
          var verb = statement && statement.verb && statement.verb.id || '';
          if (result && result.score && /(?:answered|completed)$/.test(verb)) {
            scores[event.data.questionId] = { raw: Number(result.score.raw) || 0, max: Number(result.score.max) || 0 };
            var aggregate = Object.keys(scores).reduce(function(total, key) {
              total.raw += scores[key].raw;
              total.max += scores[key].max;
              return total;
            }, { raw: 0, max: 0 });
            if (Object.keys(scores).length === frames.length && aggregate.max > 0) fetch(config.scoreEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ score: aggregate.raw, maxScore: aggregate.max })
            });
          }
          return;
        }
        if (!event.data || event.data.type !== 'tlef:h5p-preview-height') return;
        var height = Number(event.data.height);
        if (Number.isFinite(height) && height > 0) frame.style.height = Math.max(260, Math.ceil(height)) + 'px';
        reportHeight();
      });
      frames.forEach(function(frame) {
        frame.addEventListener('load', function() {
          if (frame.dataset.started !== 'true') return;
          frame.closest('.mixed-item').dataset.loaded = 'true';
          reportHeight();
        });
      });
      if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.querySelector('.mixed-activity'));
      reportHeight();
      // Show useful content immediately, then stagger the remaining full H5P
      // runtimes so entering Preview does not launch every library at once.
      var immediateFrames = Math.min(frames.length, 4);
      for (var immediateIndex = 0; immediateIndex < immediateFrames; immediateIndex += 1) startNextFrame();
      var stagedLoader = window.setInterval(function() {
        if (!startNextFrame()) window.clearInterval(stagedLoader);
      }, 500);
    }());
  </script>
</body>
</html>`;
}
