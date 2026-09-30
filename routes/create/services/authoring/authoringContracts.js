import crypto from 'node:crypto';

export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const stableId = value => digest(value).slice(0, 24);
export const fail = (message, status = 409, code = 'AUTHORING_CONFLICT') => {
  throw Object.assign(new Error(message), { status, code });
};
export const objectId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
export const requestId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
export function validateCommand(body) {
  if (!requestId(body?.requestId) || !Number.isInteger(body.revision) || body.revision < 0) {
    fail('Reload this task before sending the request.', 400, 'AUTHORING_INPUT');
  }
}
export function parseDecision(value, questionCount) {
  if (!value || !['reply', 'revise_plan', 'revise_question', 'revise_activity'].includes(value.action)
    || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 6000) {
    fail('The assistant returned an incomplete response. Your work is unchanged.', 422, 'AUTHORING_RESPONSE');
  }
  if (value.action === 'revise_question' && (!Number.isInteger(value.questionIndex)
    || value.questionIndex < 1 || value.questionIndex > questionCount)) {
    fail('Choose a question in the current version before requesting a revision.', 422, 'AUTHORING_RESPONSE');
  }
  const clarification = value.clarification ?? [];
  if (!Array.isArray(clarification) || clarification.length > 3 || (value.action !== 'reply' && clarification.length)
    || clarification.some(item => !item || typeof item.question !== 'string' || !item.question.trim() || item.question.length > 300
      || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4
      || item.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 180)
      || new Set(item.options.map(option => option.trim())).size !== item.options.length)) {
    fail('The assistant returned incomplete clarification choices. Your work is unchanged.', 422, 'AUTHORING_RESPONSE');
  }
  return { action: value.action, reply: value.reply, questionIndex: value.questionIndex,
    clarification: clarification.map(item => ({ question: item.question.trim(), options: item.options.map(option => option.trim()) })) };
}
export const versionSummary = version => ({
  id: String(version._id), number: version.number, parentId: version.parentId ? String(version.parentId) : null,
  restoredFromId: version.restoredFromId ? String(version.restoredFromId) : null,
  contentId: version.contentId, title: version.title, summary: version.summary, changes: version.changes,
  representation: version.representation, state: version.state, createdAt: version.createdAt,
  questions: (version.snapshot?.questions || []).map((q, index) => ({ id: String(q._id), index: index + 1,
    type: q.type, text: q.questionText, explanation: q.explanation,
    sourceReferences: q.generationMetadata?.sourceReferences || [] }))
});
