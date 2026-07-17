import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import helpKnowledgeService from '../services/helpKnowledgeService.js';
import { answerHelpQuestion } from '../services/helpChatService.js';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ERROR_CODES, HTTP_STATUS } from '../config/constants.js';
import HelpInteraction from '../models/HelpInteraction.js';

const router = express.Router();

function writeEvent(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.flush?.();
}

router.get('/status', authenticateToken, asyncHandler(async (_req, res) => {
  const status = await helpKnowledgeService.getStatus();
  return successResponse(res, status, 'CREATE Guide knowledge is ready');
}));

router.post('/chat', authenticateToken, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 2000) {
    return errorResponse(
      res,
      'Message must be between 1 and 2,000 characters',
      ERROR_CODES.VALIDATION_ERROR,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
  const context = req.body?.context && typeof req.body.context === 'object' ? {
    route: String(req.body.context.route || '').slice(0, 500),
    pageTitle: String(req.body.context.pageTitle || '').slice(0, 160),
    activeTab: String(req.body.context.activeTab || '').slice(0, 100)
  } : {};

  const startedAt = Date.now();
  let interaction;
  try {
    interaction = await HelpInteraction.create({
      user: req.user.id,
      question: message,
      context,
      status: 'processing'
    });
  } catch (error) {
    console.error('[CREATE Guide] Failed to create interaction', error);
    return errorResponse(
      res,
      'CREATE Guide could not start this request. Please try again.',
      'HELP_INTERACTION_ERROR',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  writeEvent(res, 'status', { status: 'retrieving', message: 'Searching CREATE help...' });

  try {
    let sourcesSent = false;
    const result = await answerHelpQuestion({
      message,
      history,
      context,
      userId: req.user.id,
      onChunk: chunk => {
        if (!sourcesSent) {
          sourcesSent = true;
          writeEvent(res, 'status', { status: 'answering', message: 'Writing an answer...' });
        }
        writeEvent(res, 'text-chunk', { chunk });
      }
    });

    const safeSources = result.sources.map(({ content, score, ...source }) => source);
    await HelpInteraction.findByIdAndUpdate(interaction._id, {
      answer: String(result.answer || '').slice(0, 20000),
      sources: safeSources.map(source => ({
        title: source.title,
        section: source.section,
        sourcePath: source.sourcePath,
        navigationPath: source.navigationPath
      })),
      model: result.model || undefined,
      fallback: Boolean(result.fallback),
      status: 'completed',
      durationMs: Date.now() - startedAt
    });

    writeEvent(res, 'sources', {
      sources: safeSources
    });
    writeEvent(res, 'complete', {
      model: result.model,
      fallback: result.fallback,
      interactionId: interaction._id
    });
  } catch (error) {
    console.error('[CREATE Guide] Chat failed', error);
    await HelpInteraction.findByIdAndUpdate(interaction._id, {
      status: 'failed',
      errorCode: String(error.code || error.name || 'HELP_CHAT_ERROR').slice(0, 120),
      durationMs: Date.now() - startedAt
    }).catch(updateError => console.warn('[CREATE Guide] Failed to record chat failure', updateError.message));
    writeEvent(res, 'error', { message: 'CREATE Guide could not answer this question. Please try again.' });
  } finally {
    res.end();
  }
});

router.patch('/interactions/:id/rating', authenticateToken, asyncHandler(async (req, res) => {
  const value = req.body?.value;
  const allowedValues = new Set(['helpful', 'not-helpful']);
  const allowedReasons = new Set(['incorrect', 'outdated', 'unclear', 'incomplete', 'other']);
  const reasons = Array.isArray(req.body?.reasons)
    ? [...new Set(req.body.reasons.filter(reason => allowedReasons.has(reason)))].slice(0, 5)
    : [];
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';

  if (!allowedValues.has(value)) {
    return errorResponse(res, 'Rating must be helpful or not-helpful', ERROR_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
  }

  const interaction = await HelpInteraction.findOne({
    _id: req.params.id,
    user: req.user.id,
    status: 'completed'
  });
  if (!interaction) {
    return errorResponse(res, 'Completed help interaction not found', ERROR_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }

  interaction.rating = {
    value,
    reasons: value === 'not-helpful' ? reasons : [],
    comment: value === 'not-helpful' ? comment : '',
    ratedAt: new Date()
  };
  await interaction.save();

  return successResponse(res, {
    interactionId: interaction._id,
    rating: interaction.rating
  }, 'CREATE Guide feedback saved');
}));

export default router;
