import { createRequire } from 'module';
import { renderContent } from './lumiService.js';
import Quiz from '../models/Quiz.js';
import { submitScore } from './gradePassbackService.js';
import { renderMixedActivityPreview, renderNativeH5PPreview } from './h5pNativePreviewService.js';
import { buildMixedActivityItemDocument } from './mixedActivityService.js';
import { createH5PPreviewToken, verifyH5PPreviewToken } from '../utils/h5pPreviewToken.js';

const require = createRequire(import.meta.url);
const lti = require('ltijs').Provider;

const LTI_KEY = process.env.LTI_KEY || 'LTIKEY-default-change-in-production';
const LTI_PORT = parseInt(process.env.LTI_PORT || '7737', 10);
const MONGODB_URI = process.env.MONGODB_URI;
// LTI_PUBLIC_URL must be reachable from Canvas. If Canvas is in Docker, use host.docker.internal
const LTI_PUBLIC_URL = process.env.LTI_PUBLIC_URL || `http://localhost:${LTI_PORT}`;

/**
 * Start the LTI 1.3 server on a separate port
 */
export async function startLtiServer() {
  if (!MONGODB_URI) {
    console.error('❌ LTI: MONGODB_URI not set, skipping LTI server startup');
    return;
  }

  // Setup ltijs with MongoDB
  lti.setup(LTI_KEY, {
    url: MONGODB_URI
  }, {
    appRoute: '/',
    loginRoute: '/login',
    keysetRoute: '/keys',
    devMode: process.env.NODE_ENV !== 'production',
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax'
    }
  });

  // Whitelist H5P content routes (so they don't require LTI token)
  lti.whitelist(
    lti.appRoute(),
    '/h5p/play',
    '/h5p/content',
    '/h5p/libraries',
    /^\/h5p\/mixed\//
  );

  // Main LTI launch handler — student opens assignment in Canvas
  lti.onConnect(async (token, req, res) => {
    try {
      console.log('🔗 LTI Launch received');

      // Extract quiz export ID from custom params or launch URL
      const quizExportId = token.platformContext?.custom?.quizExportId
        || req.query?.quizExportId
        || new URL(token.platformContext?.targetLinkUri || '', 'http://localhost').searchParams.get('quizExportId');

      console.log('🔗 LTI Launch - quizExportId:', quizExportId);

      if (!quizExportId) {
        return res.status(400).send('Missing quiz export ID');
      }

      // Find the quiz export with this resource link ID
      const quiz = await Quiz.findOne({
        'exports.canvasExport.resourceLinkId': quizExportId
      });

      if (!quiz) {
        return res.status(404).send('Quiz not found for this resource');
      }

      const exportRecord = quiz.exports.find(
        e => e.canvasExport?.resourceLinkId === quizExportId
      );

      if (exportRecord?.canvasExport?.playerMode === 'mixed-activity') {
        const snapshot = exportRecord.canvasExport.mixedActivitySnapshot;
        const items = (snapshot?.questions || []).map((question, index) => ({
          title: `Question ${index + 1}`,
          url: `/h5p/mixed/${encodeURIComponent(quizExportId)}/${encodeURIComponent(String(question._id))}?token=${encodeURIComponent(createH5PPreviewToken({
            userId: quiz.createdBy,
            quizId: quiz._id,
            questionId: question._id
          }))}`
        }));
        if (items.length === 0) return res.status(404).send('Mixed Activity snapshot is empty');
        res.removeHeader('Content-Security-Policy');
        res.setHeader('Content-Type', 'text/html');
        return res.send(renderMixedActivityPreview({
          title: snapshot.title || quiz.name,
          items,
          scoreEndpoint: typeof req.query?.ltik === 'string'
            ? `/score?ltik=${encodeURIComponent(req.query.ltik)}`
            : '/score'
        }));
      }

      if (!exportRecord?.lumiContentId) {
        return res.status(404).send('H5P content not found for this quiz');
      }

      // Render H5P content via Lumi
      const html = await renderContent(exportRecord.lumiContentId);

      // Remove CSP header to allow H5P inline scripts
      res.removeHeader('Content-Security-Policy');
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      console.error('❌ LTI launch error:', error);
      return res.status(500).send('Error loading quiz content');
    }
  });

  lti.app.get('/h5p/mixed/:resourceLinkId/:questionId', async (req, res) => {
    try {
      const token = verifyH5PPreviewToken(req.query.token, { questionId: req.params.questionId });
      if (!token) return res.status(401).send('Mixed Activity preview expired');

      const quiz = await Quiz.findOne({
        _id: token.quizId,
        createdBy: token.userId,
        'exports.canvasExport.resourceLinkId': req.params.resourceLinkId
      });
      const exportRecord = quiz?.exports.find(
        entry => entry.canvasExport?.resourceLinkId === req.params.resourceLinkId
      );
      const snapshot = exportRecord?.canvasExport?.mixedActivitySnapshot;
      if (!snapshot) return res.status(404).send('Mixed Activity snapshot not found');

      const document = await buildMixedActivityItemDocument(snapshot, req.params.questionId);
      const mainServerUrl = process.env.H5P_ASSETS_URL || `http://localhost:${process.env.PORT || 8051}`;
      const html = await renderNativeH5PPreview(document, {
        contentId: `lti-${req.params.questionId}`,
        libraryBasePath: `${mainServerUrl}/api/create/h5p-preview/libs`,
        coreBasePath: `${mainServerUrl}/api/create/h5p-preview/core`,
        contentBasePath: `${mainServerUrl}/api/create/h5p-preview/content`,
        xapiBridge: { questionId: req.params.questionId }
      });
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.type('text/html').send(html);
    } catch (error) {
      console.error('❌ LTI mixed activity item error:', error);
      return res.status(500).send('Error loading Mixed Activity question');
    }
  });

  // Deep Linking handler (for future use)
  lti.onDeepLinking(async (token, req, res) => {
    // This would allow professors to pick content from within Canvas
    // For now, we handle this through our own Canvas API integration
    return res.send('Deep linking not yet implemented. Use TLEF-CREATE to export quizzes.');
  });

  // Score submission endpoint (called by xAPI script in player page)
  lti.app.post('/score', async (req, res) => {
    try {
      const { score, maxScore, resourceLinkId } = req.body;
      const token = res.locals.token;

      if (token && score !== undefined && maxScore) {
        await submitScore(token, score, maxScore);
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Missing score data or LTI token' });
    } catch (error) {
      console.error('❌ Score submission error:', error);
      return res.status(500).json({ error: 'Failed to submit score' });
    }
  });

  // Deploy on separate port
  await lti.deploy({ port: LTI_PORT });

  // Register Canvas platform (if not already registered)
  await registerCanvasPlatform();

  console.log(`✅ LTI 1.3 server running on port ${LTI_PORT}`);
  console.log(`   JWKS: ${LTI_PUBLIC_URL}/keys`);
  console.log(`   Launch: ${LTI_PUBLIC_URL}/`);
}

/**
 * Register Canvas as an LTI platform
 */
async function registerCanvasPlatform() {
  const canvasUrl = process.env.CANVAS_BASE_URL || 'https://canvas.instructure.com';
  const clientId = process.env.LTI_CLIENT_ID;

  if (!clientId) {
    console.warn('⚠️  LTI_CLIENT_ID not set — skip Canvas platform registration');
    console.warn('   Set it after creating an LTI Developer Key in Canvas');
    return;
  }

  try {
    const existing = await lti.getPlatform(canvasUrl, clientId);
    if (existing) {
      console.log('ℹ️  Canvas platform already registered');
      return;
    }
  } catch {
    // Not registered yet, continue
  }

  await lti.registerPlatform({
    url: canvasUrl,
    name: 'Canvas LMS',
    clientId,
    authenticationEndpoint: `${canvasUrl}/api/lti/authorize_redirect`,
    accesstokenEndpoint: `${canvasUrl}/login/oauth2/token`,
    authConfig: {
      method: 'JWK_SET',
      key: `${canvasUrl}/api/lti/security/jwks`
    }
  });

  console.log('✅ Canvas platform registered for LTI 1.3');
}

/**
 * Build the HTML page that renders H5P content and captures xAPI scores
 */
function buildPlayerPage(playerModel, ltiToken, resourceLinkId) {
  // playerModel from Lumi contains scripts, styles, and integration data
  const scripts = playerModel.scripts?.map(s => `<script src="${s}"></script>`).join('\n') || '';
  const styles = playerModel.styles?.map(s => `<link rel="stylesheet" href="${s}">`).join('\n') || '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TLEF-CREATE Quiz</title>
  ${styles}
  <style>
    body { margin: 0; padding: 16px; font-family: -apple-system, sans-serif; }
    .h5p-content { max-width: 900px; margin: 0 auto; }
  </style>
</head>
<body>
  ${playerModel.embedCode || '<div class="h5p-content">Loading...</div>'}
  ${scripts}
  <script>
    // Capture xAPI completion events and send score back to Canvas
    if (window.H5P && window.H5P.externalDispatcher) {
      window.H5P.externalDispatcher.on('xAPI', function(event) {
        var statement = event.data.statement;
        if (statement.result && statement.result.score && statement.verb.id.indexOf('completed') !== -1) {
          var score = statement.result.score.raw;
          var maxScore = statement.result.score.max;

          fetch('/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              score: score,
              maxScore: maxScore,
              resourceLinkId: '${resourceLinkId}'
            })
          }).then(function(res) {
            console.log('Score submitted:', score + '/' + maxScore);
          }).catch(function(err) {
            console.error('Failed to submit score:', err);
          });
        }
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Get the LTI provider instance (for advanced operations)
 */
export function getLtiProvider() {
  return lti;
}
