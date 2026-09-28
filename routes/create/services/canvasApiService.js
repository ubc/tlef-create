import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { canvasConfig, createCanvasConnection } from './canvasToolkitConnection.js';
import { createCanvasTokenStore } from './canvasTokenStore.js';

const config = canvasConfig();
const connection = createCanvasConnection({ config, tokenStore: createCanvasTokenStore(config.canvasDomain) });

export const isConfigured = () => Boolean(config.clientId && config.clientSecret);
export const getBaseUrl = () => config.canvasDomain;
export const getAuthorizationUrl = state => connection.getAuthorizationUrl(state);
export const exchangeCode = (code, userId) => connection.exchangeCode(code, userId);
export const hasValidToken = userId => connection.hasValidToken(userId);
export const deleteToken = userId => connection.disconnect(userId);

// Modules/pages/LTI placement are CREATE-specific operations, sent through
// the toolkit's authenticated client. Lists always follow Canvas pagination.
async function canvasRequest(userId, path, options = {}) {
  const client = await connection.getClient(userId);
  if (options.method === 'POST') return client.post(path, JSON.parse(options.body));
  return client.getAll(path);
}

/**
 * List courses where user is an instructor
 */
export async function listCourses(userId) {
  const courses = await canvas.getCourses(await connection.getClient(userId));
  return courses.map(c => ({
    id: c.raw.id,
    name: c.name,
    courseCode: c.code,
    term: c.raw.term?.name
  }));
}

/**
 * List modules for a course
 */
export async function listModules(userId, courseId) {
  const modules = await canvasRequest(userId, `/courses/${courseId}/modules?per_page=100`);
  return modules.map(m => ({
    id: m.id,
    name: m.name,
    position: m.position,
    itemCount: m.items_count
  }));
}

/**
 * Create a Module in a Canvas course
 */
export async function createModule(userId, courseId, name) {
  return canvasRequest(userId, `/courses/${courseId}/modules`, {
    method: 'POST',
    body: JSON.stringify({
      module: {
        name,
        published: true
      }
    })
  });
}

/**
 * Create a Page in a Canvas course
 */
export async function createPage(userId, courseId, title, bodyHtml) {
  return canvasRequest(userId, `/courses/${courseId}/pages`, {
    method: 'POST',
    body: JSON.stringify({
      wiki_page: {
        title,
        body: bodyHtml,
        published: true,
        editing_roles: 'teachers'
      }
    })
  });
}

/**
 * Add a page as a module item
 */
export async function createModuleItem(userId, courseId, moduleId, pageUrl, title) {
  return canvasRequest(userId, `/courses/${courseId}/modules/${moduleId}/items`, {
    method: 'POST',
    body: JSON.stringify({
      module_item: {
        type: 'Page',
        page_url: pageUrl,
        title
      }
    })
  });
}

/**
 * Ensure the LTI tool is installed in a Canvas course.
 * Returns the external_tool_id needed for creating module items.
 */
export async function ensureLtiToolInstalled(userId, courseId) {
  const ltiClientId = process.env.LTI_CLIENT_ID;
  if (!ltiClientId) {
    throw new Error('LTI_CLIENT_ID not configured');
  }

  // Check course-level tools first, then account-level
  const courseTools = await canvasRequest(userId, `/courses/${courseId}/external_tools?per_page=100`);
  console.log('🔍 Canvas external tools found:', JSON.stringify(courseTools.map(t => ({ id: t.id, name: t.name, developer_key_id: t.developer_key_id })), null, 2));

  const existing = courseTools.find(t =>
    String(t.developer_key_id) === String(ltiClientId) ||
    String(t.developer_key_id) === String(ltiClientId).replace(/^10+/, '') ||
    t.name?.trim() === 'TLEF-CREATE' ||
    t.name?.trim() === 'CREATE-LTI'
  );
  if (existing) {
    console.log('✅ Found LTI tool:', existing.id, existing.name);
    return existing.id;
  }

  // Also check account-level tools (visible to all courses)
  try {
    const accountTools = await canvasRequest(userId, `/accounts/self/external_tools?per_page=100`);
    console.log('🔍 Account-level tools found:', JSON.stringify(accountTools.map(t => ({ id: t.id, name: t.name, developer_key_id: t.developer_key_id })), null, 2));
    const accountTool = accountTools.find(t =>
      String(t.developer_key_id) === String(ltiClientId) ||
      t.name === 'TLEF-CREATE' ||
      t.name === 'CREATE-LTI'
    );
    if (accountTool) {
      return accountTool.id;
    }
  } catch (err) {
    console.log('⚠️ Account-level tools check failed:', err.message);
  }

  // Tool not found — try to auto-install it via client_id
  console.log('🔧 LTI tool not found, attempting auto-install via client_id...');
  try {
    const installed = await canvasRequest(userId, `/courses/${courseId}/external_tools`, {
      method: 'POST',
      body: JSON.stringify({ client_id: ltiClientId })
    });
    console.log('✅ LTI tool auto-installed:', installed.id, installed.name);
    return installed.id;
  } catch (installErr) {
    console.log('❌ Auto-install failed:', installErr.message);
    throw new Error('LTI tool not found. Please install the TLEF-CREATE LTI tool in Canvas first (Settings → Apps → +App → By Client ID).');
  }
}

/**
 * Create an ExternalTool module item that launches via LTI
 */
export async function createExternalToolModuleItem(userId, courseId, moduleId, externalToolId, title, launchUrl) {
  return canvasRequest(userId, `/courses/${courseId}/modules/${moduleId}/items`, {
    method: 'POST',
    body: JSON.stringify({
      module_item: {
        type: 'ExternalTool',
        title,
        content_id: externalToolId,
        external_url: launchUrl,
        new_tab: false
      }
    })
  });
}
