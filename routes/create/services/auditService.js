import AuditEvent from '../models/AuditEvent.js';

const ALLOWED_METADATA_KEYS = new Set([
  'targetUserId', 'count', 'format', 'provider', 'model', 'fallback', 'rating',
  'reasonCount', 'processingStatus', 'questionType', 'deliveryTarget', 'targetFormat',
  'resultCount', 'source', 'adminView'
]);

export function sanitizeAuditMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata)
    .filter(([key, value]) => ALLOWED_METADATA_KEYS.has(key) && value !== undefined)
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 300) : value]));
}

export async function recordAuditEvent(event) {
  if (!event?.actor || !event?.action) return null;
  try {
    return await AuditEvent.create({
      actor: event.actor,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      folder: event.folder,
      quiz: event.quiz,
      status: event.status || 'success',
      requestId: event.requestId,
      route: event.route,
      method: event.method,
      statusCode: event.statusCode,
      metadata: sanitizeAuditMetadata(event.metadata)
    });
  } catch (error) {
    console.warn('[Audit] Failed to record event', { action: event.action, error: error.message });
    return null;
  }
}

export default { recordAuditEvent };
