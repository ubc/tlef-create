import CanvasToken from '../models/CanvasToken.js';

// Supports both canvas.instructure.com (cloud) and local Canvas instances
const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL || 'https://canvas.instructure.com';
const CANVAS_CLIENT_ID = process.env.CANVAS_CLIENT_ID;
const CANVAS_CLIENT_SECRET = process.env.CANVAS_CLIENT_SECRET;
const CANVAS_REDIRECT_URI = process.env.CANVAS_REDIRECT_URI || `http://localhost:${process.env.PORT || 7736}/api/create/canvas/oauth/callback`;

/**
 * Check if Canvas integration is properly configured
 */
export function isConfigured() {
  return !!(CANVAS_CLIENT_ID && CANVAS_CLIENT_SECRET);
}

/**
 * Build Canvas OAuth2 authorization URL
 */
export function getAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: CANVAS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: CANVAS_REDIRECT_URI,
    state,
    scope: 'url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/modules url:POST|/api/v1/courses/:course_id/modules url:POST|/api/v1/courses/:course_id/pages url:POST|/api/v1/courses/:course_id/modules/:module_id/items url:GET|/api/v1/courses/:course_id/external_tools url:GET|/api/v1/accounts/:account_id/external_tools'
  });
  return `${CANVAS_BASE_URL}/login/oauth2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens and save to DB
 */
export async function exchangeCode(code, userId) {
  const response = await fetch(`${CANVAS_BASE_URL}/login/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CANVAS_CLIENT_ID,
      client_secret: CANVAS_CLIENT_SECRET,
      redirect_uri: CANVAS_REDIRECT_URI,
      code
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Canvas OAuth2 token exchange failed: ${error}`);
  }

  const data = await response.json();

  // Canvas tokens expire in 1 hour by default
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

  const token = await CanvasToken.findOneAndUpdate(
    { user: userId },
    {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt,
      canvasBaseUrl: CANVAS_BASE_URL
    },
    { upsert: true, new: true }
  );

  return token;
}

/**
 * Refresh token if needed, return valid access token
 */
async function getValidToken(userId) {
  const tokenDoc = await CanvasToken.findOne({ user: userId });
  if (!tokenDoc) {
    throw new Error('No Canvas token found. Please connect to Canvas first.');
  }

  if (tokenDoc.needsRefresh() && tokenDoc.getRefreshToken()) {
    const response = await fetch(`${CANVAS_BASE_URL}/login/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CANVAS_CLIENT_ID,
        client_secret: CANVAS_CLIENT_SECRET,
        refresh_token: tokenDoc.getRefreshToken()
      })
    });

    if (!response.ok) {
      // Refresh failed — delete token, force re-auth
      await CanvasToken.deleteOne({ user: userId });
      throw new Error('Canvas token expired. Please reconnect to Canvas.');
    }

    const data = await response.json();
    tokenDoc.accessToken = data.access_token;
    if (data.refresh_token) {
      tokenDoc.refreshToken = data.refresh_token;
    }
    tokenDoc.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
    await tokenDoc.save();
  }

  return tokenDoc.getAccessToken();
}

/**
 * Make authenticated Canvas API request
 */
async function canvasRequest(userId, path, options = {}) {
  const accessToken = await getValidToken(userId);
  const url = `${CANVAS_BASE_URL}/api/v1${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Canvas API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * List courses where user is an instructor
 */
export async function listCourses(userId) {
  // Include teacher + admin enrollments; also include all states for local Canvas dev instances
  const courses = await canvasRequest(userId, '/courses?per_page=100');
  return courses.map(c => ({
    id: c.id,
    name: c.name,
    courseCode: c.course_code,
    term: c.term?.name
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

/**
 * Delete stored Canvas token for a user
 */
export async function deleteToken(userId) {
  return CanvasToken.deleteOne({ user: userId });
}

/**
 * Check if user has a valid Canvas token
 */
export async function hasValidToken(userId) {
  const token = await CanvasToken.findOne({ user: userId });
  if (!token) return false;
  if (token.isExpired() && !token.getRefreshToken()) return false;
  return true;
}
