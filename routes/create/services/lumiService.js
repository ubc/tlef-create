import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs/promises';

// Use createRequire for CJS packages
const require = createRequire(import.meta.url);
const H5PServer = require('@lumieducation/h5p-server');
const H5PExpress = require('@lumieducation/h5p-express');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, '..');
const H5P_LIBS_DIR = path.join(BASE_DIR, 'h5p-libs');
const H5P_CONTENT_DIR = path.join(BASE_DIR, 'uploads', 'h5p-content');
const H5P_TEMP_DIR = path.join(BASE_DIR, 'uploads', 'h5p-temp');

let h5pEditor = null;
let h5pPlayer = null;

/**
 * Simple in-memory key-value storage for Lumi cache
 */
class InMemoryStorage {
  constructor() {
    this.storage = new Map();
  }
  async load(key) {
    return this.storage.get(key);
  }
  async save(key, value) {
    this.storage.set(key, value);
  }
}

/**
 * System user for Lumi operations (not tied to any real user)
 */
const systemUser = {
  id: 'system',
  name: 'TLEF-CREATE System',
  email: 'system@tlef-create.local',
  type: 'local'
};

/**
 * Initialize the Lumi H5P server
 */
export async function initializeLumi() {
  // Ensure directories exist
  await fs.mkdir(H5P_CONTENT_DIR, { recursive: true });
  await fs.mkdir(H5P_TEMP_DIR, { recursive: true });

  // Create config
  // baseUrl is prepended to librariesUrl/contentFilesUrl, so keep it short
  const config = new H5PServer.H5PConfig();
  config.baseUrl = '/api/create/h5p';
  config.contentFilesUrlPlayerOverride = '/content';
  config.librariesUrl = '/libraries';

  // File-based storage implementations
  const libraryStorage = new H5PServer.fsImplementations.FileLibraryStorage(H5P_LIBS_DIR);
  const contentStorage = new H5PServer.fsImplementations.FileContentStorage(H5P_CONTENT_DIR);
  const temporaryStorage = new H5PServer.fsImplementations.DirectoryTemporaryFileStorage(H5P_TEMP_DIR);
  const cache = new InMemoryStorage();

  // Create H5P Editor (needed for importing packages)
  h5pEditor = new H5PServer.H5PEditor(
    cache,
    config,
    libraryStorage,
    contentStorage,
    temporaryStorage
  );

  // Create H5P Player (needed for rendering content)
  h5pPlayer = new H5PServer.H5PPlayer(
    libraryStorage,
    contentStorage,
    config
  );

  console.log('✅ Lumi H5P server initialized');
  console.log(`   Libraries: ${H5P_LIBS_DIR}`);
  console.log(`   Content: ${H5P_CONTENT_DIR}`);

  return { h5pEditor, h5pPlayer };
}

/**
 * Import a .h5p file into Lumi's content storage
 * @param {string} h5pFilePath - Full path to the .h5p file
 * @returns {string} contentId
 */
export async function importH5PContent(h5pFilePath) {
  if (!h5pEditor) {
    throw new Error('Lumi H5P server not initialized. Call initializeLumi() first.');
  }

  const result = await h5pEditor.packageImporter.addPackageLibrariesAndContent(
    h5pFilePath,
    systemUser
  );

  console.log(`✅ H5P content imported: ${result.id}`);
  return result.id;
}

/**
 * Render H5P content as HTML
 * @param {string} contentId - Lumi content ID
 * @returns {string} HTML string
 */
export async function renderContent(contentId) {
  if (!h5pPlayer) {
    throw new Error('Lumi H5P player not initialized. Call initializeLumi() first.');
  }

  let html = await h5pPlayer.render(contentId, systemUser, 'en');

  if (typeof html === 'string') {
    // When rendered inside Canvas LTI iframe, relative paths go to :7737 instead of :8051
    // Convert all /api/create/h5p/ paths to absolute URLs pointing to the main server
    const mainServerUrl = process.env.H5P_ASSETS_URL || `http://localhost:${process.env.PORT || 8051}`;
    html = html.replace(/(['"])(\/api\/create\/h5p\/)/g, `$1${mainServerUrl}/api/create/h5p/`);

    // Inject jQuery-to-H5P bridge script right after jquery.js loads
    // H5P core expects H5P.jQuery to be set before h5p.js runs
    html = html.replace(
      /(<script src="[^"]*jquery\.js[^"]*"><\/script>)/,
      `$1\n    <script src="${mainServerUrl}/api/create/h5p/core/js/h5p-jquery-bridge.js"></script>`
    );
  }

  return html;
}

/**
 * Get the H5P Editor instance (for advanced operations)
 */
export function getEditor() {
  return h5pEditor;
}

/**
 * Get the H5P Player instance (for Express routes)
 */
export function getPlayer() {
  return h5pPlayer;
}

/**
 * Get the Express router for H5P Ajax/player routes
 * This serves H5P library files, content files, etc.
 */
export function getH5PExpressRouter() {
  if (!h5pEditor || !h5pPlayer) {
    throw new Error('Lumi H5P server not initialized.');
  }

  return H5PExpress.h5pAjaxExpressRouter(
    h5pEditor,
    path.join(H5P_CONTENT_DIR),
    path.join(H5P_LIBS_DIR)
  );
}

/**
 * Check if a content ID exists
 * @param {string} contentId
 * @returns {boolean}
 */
export async function contentExists(contentId) {
  if (!h5pEditor) return false;
  try {
    await h5pEditor.contentManager.contentExists(contentId);
    return true;
  } catch {
    return false;
  }
}
