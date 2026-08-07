import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LIBRARY_PATH = path.resolve(SERVICE_DIR, '../h5p-libs');

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

  return { cssFiles, jsFiles, missingFiles };
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
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
  </style>
${cssTags}
</head>
<body>
  <div id="h5p-native-preview" class="h5p-content"></div>
  <script src="${coreBasePath}/js/jquery.js"></script>
  <script>
    H5PIntegration = {
      baseUrl: '', url: '/api/create/h5p-preview', postUserStatistics: false,
      saveFreq: false, user: { name: 'Preview', mail: '' },
      siteUrl: window.location.origin, loadedJs: [], loadedCss: [],
      core: { scripts: [], styles: [] }, contents: {}
    };
  </script>
  <script src="${coreBasePath}/h5p-core.js"></script>
  <script>
    H5P.jQuery = jQuery;
    H5P.$body = jQuery('body');
    H5P.$window = jQuery(window);
  </script>
${jsTags}
  <script>
    jQuery(document).ready(function() {
      var runnable = ${runnable};
      var container = jQuery('#h5p-native-preview');
      H5P.newRunnable(runnable, 'preview-container', container, false, {
        metadata: runnable.metadata || {}
      });

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
