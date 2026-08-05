import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs/promises';
import H5PContent from '../models/H5PContent.js';

// Use createRequire for CJS packages
const require = createRequire(import.meta.url);
const H5PServer = require('@lumieducation/h5p-server');
const H5PExpress = require('@lumieducation/h5p-express');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, '..');
const H5P_LIBS_DIR = path.join(BASE_DIR, 'h5p-libs');
const H5P_CORE_DIR = path.join(BASE_DIR, 'h5p-core');
const H5P_EDITOR_CORE_DIR = path.join(BASE_DIR, 'h5p-editor-core');
const H5P_CONTENT_DIR = path.join(BASE_DIR, 'uploads', 'h5p-content');
const H5P_TEMP_DIR = path.join(BASE_DIR, 'uploads', 'h5p-temp');

let h5pEditor = null;
let h5pPlayer = null;
const pendingContentOwners = new Map();

/**
 * The vendored H5P Core keeps jQuery and H5P separate. H5P's browser runtime
 * expects H5P.jQuery to exist before h5p.js and every editor widget execute.
 * Lumi returns both the top-level editor scripts and the scripts copied into
 * the editor iframe, so the bridge must be inserted into both ordered lists.
 */
function insertH5PJQueryBridge(scripts = []) {
  const jqueryIndex = scripts.findIndex(script => /\/core\/js\/jquery\.js(?:\?|$)/.test(script));
  if (jqueryIndex < 0) return scripts;

  const jqueryUrl = scripts[jqueryIndex];
  const bridgeUrl = jqueryUrl.replace(/jquery\.js(?=\?|$)/, 'h5p-jquery-bridge.js');
  if (scripts.includes(bridgeUrl)) return scripts;

  return [
    ...scripts.slice(0, jqueryIndex + 1),
    bridgeUrl,
    ...scripts.slice(jqueryIndex + 1)
  ];
}

function prepareEditorModel(model) {
  return {
    ...model,
    scripts: insertH5PJQueryBridge(model.scripts),
    integration: {
      ...model.integration,
      editor: {
        ...model.integration?.editor,
        assets: {
          ...model.integration?.editor?.assets,
          js: insertH5PJQueryBridge(model.integration?.editor?.assets?.js)
        }
      }
    }
  };
}

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
 * Convert CREATE's authenticated user shape into Lumi's IUser contract.
 * The H5P user id deliberately matches the Mongo User id used for ownership.
 */
export function toLumiUser(user) {
  const fullUser = user?.fullUser || user || {};
  const id = user?.id || fullUser?._id || fullUser?.id;

  if (!id) {
    throw new Error('An authenticated CREATE user is required for H5P editing.');
  }

  return {
    id: id.toString(),
    name: fullUser.displayName || fullUser.cwlId || user?.cwlId || 'CREATE author',
    email: fullUser.email || undefined,
    type: 'local'
  };
}

/**
 * Lumi's file storage does not know about Mongo ownership. This permission
 * adapter makes the H5PContent record the authorization boundary while still
 * allowing the internal system account to import generated packages.
 */
class CreateH5PPermissionSystem {
  async checkForUserData(actingUser, _permission, contentId, affectedUserId) {
    if (!actingUser) return false;
    if (actingUser.id === systemUser.id) return true;
    if (affectedUserId && affectedUserId !== actingUser.id) return false;
    return this.checkForContent(actingUser, H5PServer.ContentPermission.View, contentId);
  }

  async checkForGeneralAction(actingUser, permission) {
    if (actingUser?.id === systemUser.id) return true;
    // Authors can use restricted libraries that are already installed, but
    // they cannot install or update executable H5P libraries from the Hub.
    return permission === H5PServer.GeneralPermission.CreateRestricted;
  }

  async checkForContent(actingUser, permission, contentId) {
    if (!actingUser) return false;
    if (actingUser.id === systemUser.id) return true;
    if (permission === H5PServer.ContentPermission.Create && !contentId) return true;
    if (!contentId) return false;

    if (pendingContentOwners.get(contentId.toString()) === actingUser.id.toString()) {
      return true;
    }

    return Boolean(await H5PContent.exists({
      owner: actingUser.id,
      lumiContentId: contentId.toString()
    }));
  }

  async checkForTemporaryFile(actingUser) {
    return Boolean(actingUser?.id);
  }
}

class CreateFileContentStorage extends H5PServer.fsImplementations.FileContentStorage {
  async addContent(metadata, content, user, contentId) {
    const savedContentId = await super.addContent(metadata, content, user, contentId);
    if (!contentId && user?.id && user.id !== systemUser.id) {
      pendingContentOwners.set(savedContentId.toString(), user.id.toString());
    }
    return savedContentId;
  }

  async deleteContent(contentId, user) {
    try {
      return await super.deleteContent(contentId, user);
    } finally {
      pendingContentOwners.delete(contentId.toString());
    }
  }
}

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
  config.baseUrl = '/api/create/h5p-editor/runtime';
  config.contentFilesUrlPlayerOverride = '/content';
  config.librariesUrl = '/libraries';
  config.sendUsageStatistics = false;

  // File-based storage implementations
  const libraryStorage = new H5PServer.fsImplementations.FileLibraryStorage(H5P_LIBS_DIR);
  const contentStorage = new CreateFileContentStorage(H5P_CONTENT_DIR);
  const temporaryStorage = new H5PServer.fsImplementations.DirectoryTemporaryFileStorage(H5P_TEMP_DIR);
  const cache = new InMemoryStorage();

  // Create H5P Editor (needed for importing packages)
  h5pEditor = new H5PServer.H5PEditor(
    cache,
    config,
    libraryStorage,
    contentStorage,
    temporaryStorage,
    undefined,
    undefined,
    { permissionSystem: new CreateH5PPermissionSystem() }
  );
  // The React/web-component integration consumes the editor model directly.
  // Include the jQuery bridge in both the host page and editor iframe before
  // the H5P core scripts initialize.
  h5pEditor.setRenderer(prepareEditorModel);

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
export async function importH5PContent(h5pFilePath, user = systemUser) {
  if (!h5pEditor) {
    throw new Error('Lumi H5P server not initialized. Call initializeLumi() first.');
  }

  const result = await h5pEditor.packageImporter.addPackageLibrariesAndContent(
    h5pFilePath,
    user
  );

  console.log(`✅ H5P content imported: ${result.id}`);
  return result.id;
}

/**
 * Render H5P content as HTML
 * @param {string} contentId - Lumi content ID
 * @returns {string} HTML string
 */
export async function renderContent(contentId, user = systemUser) {
  if (!h5pPlayer) {
    throw new Error('Lumi H5P player not initialized. Call initializeLumi() first.');
  }

  let html = await h5pPlayer.render(contentId, user, 'en');

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
    H5P_CORE_DIR,
    H5P_EDITOR_CORE_DIR
  );
}

export function getSystemUser() {
  return systemUser;
}

export function finalizeContentOwnership(contentId) {
  if (contentId) pendingContentOwners.delete(contentId.toString());
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
