import crypto from 'node:crypto';
import { getH5PTypesForContainer } from '../../config/h5pTypeAdapterRegistry.js';
import { normalizeObjectiveChanges } from './courseObjectiveRevision.js';
import { normalizeClarification } from './authoringClarification.js';

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
export function validateObjectiveEdits(edits, current) {
  const owned = new Map((current || []).map(objective => [String(objective.id || objective._id), objective]));
  if (!Array.isArray(edits) || !edits.length || edits.length > 8 || edits.length !== owned.size
    || edits.some(item => !item || typeof item.id !== 'string' || !owned.has(item.id)
      || typeof item.text !== 'string' || !item.text.trim() || item.text.trim().length > 500)
    || new Set(edits.map(item => item.id)).size !== owned.size) {
    fail('Edit the current learning objectives without adding or removing their IDs. Keep each objective within 500 characters.',
      400, 'AUTHORING_OBJECTIVES_INPUT');
  }
  return [...owned].map(([id, objective]) => ({ ...objective, id, text: edits.find(item => item.id === id).text.trim() }));
}
export function parseDecision(value, questionCount, allowedQuestionTypes = getH5PTypesForContainer('column'), latestRequest) {
  if (!value || !['reply', 'revise_plan', 'revise_objectives', 'revise_question', 'revise_questions', 'revise_activity'].includes(value.action)
    || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 6000) {
    fail('The assistant returned an incomplete response. Your work is unchanged.', 422, 'AUTHORING_RESPONSE');
  }
  const batch = {};
  if (value.action === 'revise_questions') {
    if (value.scope === 'all' && value.questionIndices == null) batch.scope = 'all';
    else if (value.scope == null && Array.isArray(value.questionIndices)) batch.questionIndices = value.questionIndices;
    else fail('Choose all questions or explicit question indices for a batch revision.', 422, 'AUTHORING_RESPONSE');
    for (const field of ['questionIndices', 'removeQuestionIndices']) {
      if (value[field] == null) continue;
      if (!Array.isArray(value[field]) || value[field].length > 20
        || value[field].some(index => !Number.isInteger(index) || index < 1 || index > questionCount)
        || new Set(value[field]).size !== value[field].length) {
        fail('Batch indices must identify distinct questions in the current version.', 422, 'AUTHORING_RESPONSE');
      }
      batch[field] = [...value[field]].sort((left, right) => left - right);
    }
    if (value.targetQuestionCount != null) {
      if (!Number.isInteger(value.targetQuestionCount) || value.targetQuestionCount < 1 || value.targetQuestionCount > 20) {
        fail('Choose a batch target of 1–20 questions.', 422, 'AUTHORING_RESPONSE');
      }
      batch.targetQuestionCount = value.targetQuestionCount;
    }
    if (batch.questionIndices?.length === 0 && batch.targetQuestionCount == null && !batch.removeQuestionIndices?.length) {
      if (!value.objectiveChanges) fail('An empty selection requires a quantity change, explicit removals or authorized objective changes.', 422, 'AUTHORING_RESPONSE');
    }
    const objectives = normalizeObjectiveChanges(value.objectiveChanges, latestRequest);
    if (objectives) batch.objectiveChanges = objectives;
  } else if (['scope', 'questionIndices', 'removeQuestionIndices', 'targetQuestionCount', 'objectiveChanges'].some(field => value[field] != null)) {
    fail('Batch selection applies only to a batch question revision.', 422, 'AUTHORING_RESPONSE');
  }
  if (value.action === 'revise_question' && (!Number.isInteger(value.questionIndex)
    || value.questionIndex < 1 || value.questionIndex > questionCount)) {
    fail('Choose a question in the current version before requesting a revision.', 422, 'AUTHORING_RESPONSE');
  }
  const revision = {};
  for (const [field, allowed] of Object.entries({ questionType: allowedQuestionTypes,
    difficulty: ['easy', 'moderate', 'hard'], selectionMode: ['single', 'multiple'] })) {
    if (value[field] == null) continue;
    if (!['revise_question', 'revise_questions'].includes(value.action) || !allowed.includes(value[field])) {
      fail('The assistant returned an unsupported question change. Your work is unchanged.', 422, 'AUTHORING_RESPONSE');
    }
    revision[field] = value[field];
  }
  if (revision.selectionMode && revision.questionType && revision.questionType !== 'multiple-choice') {
    fail('Answer selection mode applies only to multiple-choice questions.', 422, 'AUTHORING_RESPONSE');
  }
  const clarification = value.clarification ?? [];
  if (!Array.isArray(clarification) || clarification.length > 3 || (value.action !== 'reply' && clarification.length)
    || clarification.some(item => !item || typeof item.question !== 'string' || !item.question.trim() || item.question.length > 300
      || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4
      || item.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 180)
      || (item.selectionMode != null && !['single', 'multiple'].includes(item.selectionMode))
      || (item.allowCustomInput != null && typeof item.allowCustomInput !== 'boolean')
      || new Set(item.options.map(option => option.trim())).size !== item.options.length)) {
    fail('The assistant returned incomplete clarification choices. Your work is unchanged.', 422, 'AUTHORING_RESPONSE');
  }
  return { action: value.action, reply: value.reply, questionIndex: value.questionIndex, ...batch, ...revision,
    clarification: clarification.map(normalizeClarification) };
}
const referenceId = value => value && typeof value === 'object'
  ? String(value._id || value.id || '') : value ? String(value) : '';
const teachingPlanSummary = snapshot => snapshot ? {
  objectives: (snapshot.learningObjectives || []).map(lo => ({ id: referenceId(lo), text: lo.text,
    sourceReferences: lo.sourceReferences || [] })),
  plan: (snapshot.settings?.planItems || []).map((row, index) => {
    const id = referenceId(row.learningObjective);
    const objective = (snapshot.learningObjectives || []).find(lo => referenceId(lo) === id);
    return { id: referenceId(row) || `row-${index}`, title: row.title || objective?.text || 'Question group',
      questionType: row.type, count: row.count, objectiveIds: id ? [id] : [], instructions: row.customPrompt || '' };
  })
} : null;
export const versionSummary = version => ({
  id: String(version._id), number: version.number, parentId: version.parentId ? String(version.parentId) : null,
  restoredFromId: version.restoredFromId ? String(version.restoredFromId) : null,
  contentId: version.contentId, title: version.title, summary: version.summary, changes: version.changes,
  representation: version.representation, state: version.state, createdAt: version.createdAt,
  reviewSummary: version.reviewSummary || null, sourceReferences: version.sourceReferences || [],
  teachingPlan: teachingPlanSummary(version.snapshot),
  teachingBrief: version.teachingBrief || null,
  questions: (version.snapshot?.questions || []).map((q, index) => ({ id: String(q._id), index: index + 1,
    type: q.type, text: q.questionText, explanation: q.explanation,
    reviewSummary: q.generationMetadata?.reviewSummary || null,
    sourceReferences: q.generationMetadata?.sourceReferences || [] }))
});
