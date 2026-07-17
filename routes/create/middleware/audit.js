import crypto from 'crypto';
import mongoose from 'mongoose';
import { recordAuditEvent } from '../services/auditService.js';

const RULES = [
  { pattern: /^\/folders\/[^/]+$/, type: 'course', actions: { PUT: 'course.update', DELETE: 'course.delete' } },
  { pattern: /^\/folders(?:\/|$)/, type: 'course', actions: { POST: 'course.create', PUT: 'course.update', DELETE: 'course.delete' } },
  { pattern: /^\/materials\/upload/, type: 'material', actions: { POST: 'material.upload' } },
  { pattern: /^\/materials\/url/, type: 'material', actions: { POST: 'material.add_url' } },
  { pattern: /^\/materials\/text/, type: 'material', actions: { POST: 'material.add_text' } },
  { pattern: /^\/materials\/processing\/cleanup/, type: 'material', actions: { POST: 'material.cleanup' } },
  { pattern: /^\/materials\/[^/]+\/reprocess/, type: 'material', actions: { POST: 'material.reprocess' } },
  { pattern: /^\/materials\/[^/]+\/reference\/resolve/, type: 'material', actions: { POST: 'material.resolve_reference' } },
  { pattern: /^\/materials(?:\/|$)/, type: 'material', actions: { POST: 'material.process', PUT: 'material.update', DELETE: 'material.delete' } },
  { pattern: /^\/quizzes\/[^/]+\/materials/, type: 'quiz', actions: { PUT: 'quiz.assign_materials' } },
  { pattern: /^\/quizzes\/[^/]+\/duplicate/, type: 'quiz', actions: { POST: 'quiz.duplicate' } },
  { pattern: /^\/quizzes(?:\/|$)/, type: 'quiz', actions: { POST: 'quiz.create', PUT: 'quiz.update', PATCH: 'quiz.update', DELETE: 'quiz.delete' } },
  { pattern: /^\/objectives\/generate/, type: 'objective', actions: { POST: 'objective.generate' } },
  { pattern: /^\/objectives\/classify/, type: 'objective', actions: { POST: 'objective.classify' } },
  { pattern: /^\/objectives\/enrich/, type: 'objective', actions: { POST: 'objective.enrich' } },
  { pattern: /^\/objectives\/reorder/, type: 'objective', actions: { PUT: 'objective.reorder' } },
  { pattern: /^\/objectives\/[^/]+\/regenerate/, type: 'objective', actions: { POST: 'objective.regenerate' } },
  { pattern: /^\/objectives(?:\/|$)/, type: 'objective', actions: { POST: 'objective.create', PUT: 'objective.update', PATCH: 'objective.update', DELETE: 'objective.delete' } },
  { pattern: /^\/plans\/generate/, type: 'plan', actions: { POST: 'plan.generate' } },
  { pattern: /^\/plans\/[^/]+\/approve/, type: 'plan', actions: { POST: 'plan.approve' } },
  { pattern: /^\/plans(?:\/|$)/, type: 'plan', actions: { POST: 'plan.create', PUT: 'plan.update', PATCH: 'plan.update', DELETE: 'plan.delete' } },
  { pattern: /^\/streaming\/generate/, type: 'question', actions: { POST: 'question.generate' } },
  { pattern: /^\/questions\/generate-from-plan/, type: 'question', actions: { POST: 'question.generate' } },
  { pattern: /^\/questions\/reorder/, type: 'question', actions: { PUT: 'question.reorder' } },
  { pattern: /^\/questions\/[^/]+\/review/, type: 'question', actions: { PUT: 'question.review' } },
  { pattern: /^\/questions\/[^/]+\/regenerate/, type: 'question', actions: { POST: 'question.regenerate' } },
  { pattern: /^\/questions(?:\/|$)/, type: 'question', actions: { POST: 'question.create', PUT: 'question.update', PATCH: 'question.update', DELETE: 'question.delete' } },
  { pattern: /^\/export(?:\/|$)/, type: 'export', actions: { POST: 'export.create', DELETE: 'export.delete' } },
  { pattern: /^\/course-prompts\/validate/, type: 'prompt', actions: { POST: 'prompt.validate' } },
  { pattern: /^\/course-prompts\/folder\/[^/]+\/apply/, type: 'prompt', actions: { POST: 'prompt.apply' } },
  { pattern: /^\/course-prompts\/folder\/[^/]+\/reset/, type: 'prompt', actions: { POST: 'prompt.reset' } },
  { pattern: /^\/course-prompts(?:\/|$)/, type: 'prompt', actions: { POST: 'prompt.create', PUT: 'prompt.update', PATCH: 'prompt.update', DELETE: 'prompt.delete' } },
  { pattern: /^\/help\/chat/, type: 'help', actions: { POST: 'help.ask' } },
  { pattern: /^\/help\/interactions\/[^/]+\/rating/, type: 'help', actions: { PATCH: 'help.rate' } },
  { pattern: /^\/apiKey(?:\/|$)/, type: 'api-key', actions: { POST: 'api_key.create', PATCH: 'api_key.update', DELETE: 'api_key.delete' } },
  { pattern: /^\/admin\/reports(?:\/|$)/, type: 'report', actions: { POST: 'report.create', PUT: 'report.update' } },
  { pattern: /^\/admin\/users\/env-key-permission\/all/, type: 'permission', actions: { PATCH: 'permission.update_all' } },
  { pattern: /^\/admin\/users\/[^/]+\/env-key-permission/, type: 'permission', actions: { PATCH: 'permission.update' } },
  { pattern: /^\/admin(?:\/|$)/, type: 'admin', actions: { POST: 'admin.create', PUT: 'admin.update', PATCH: 'admin.update', DELETE: 'admin.delete' } }
];

function validId(value) {
  return mongoose.isValidObjectId(value) ? value : undefined;
}

export function classifyAuditAction(method, route) {
  for (const rule of RULES) {
    const action = rule.actions[method];
    if (action && rule.pattern.test(route)) return { action, resourceType: rule.type };
  }
  return null;
}

function inferIds(req, route) {
  const segments = route.split('/').filter(Boolean);
  const routeId = segments.find(segment => mongoose.isValidObjectId(segment));
  const resourceId = validId(routeId);
  return {
    resourceId,
    folder: validId(req.body?.folderId || req.body?.folder || req.body?.courseId || (route.startsWith('/folders/') ? resourceId : undefined)),
    quiz: validId(req.body?.quizId || req.body?.quiz || (route.startsWith('/quizzes/') || route.startsWith('/export/') ? resourceId : undefined))
  };
}

export function auditMutations(req, res, next) {
  const route = req.path;
  const classification = classifyAuditAction(req.method, route);
  if (!classification) return next();

  const requestId = req.get('x-request-id') || crypto.randomUUID();
  res.on('finish', () => {
    const actor = req.user?.id || req.user?._id;
    if (!actor) return;
    const ids = inferIds(req, route);
    void recordAuditEvent({
      actor,
      ...classification,
      ...ids,
      status: res.statusCode < 400 ? 'success' : 'failed',
      requestId,
      route,
      method: req.method,
      statusCode: res.statusCode
    });
  });
  return next();
}

export default auditMutations;
