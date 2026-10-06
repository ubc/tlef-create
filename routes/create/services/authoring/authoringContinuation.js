import { requestedAuthoringMode } from './authoringMode.js';

export const MAX_AUTOMATIC_CONTINUATIONS = 2;
const clauses = text => text.split(/[.!?。！？;；\n]|\bbut\b|但是/i).map(value => value.trim()).filter(Boolean);
const questionDeferral = /\b(?:do not|don't|not yet|no need to)\s+(?:\w+\s+){0,3}(?:generate|create|make|prepare|write|draft)\b[^.!?;\n]{0,50}\b(?:questions?|quiz|quizzes)\b|(?:不要|不|别|暂不|先不)(?:生成|出|创建|制作|设计)[^。！？；\n]{0,20}(?:题|测验)/i;
const planFirst = /\b(?:only|just)\s+(?:a\s+)?(?:plan|blueprint|objectives?)\b|\b(?:review|approve|confirm)\b[^.!?;\n]{0,50}\b(?:before|first)\b|\b(?:before|until|after)\b[^.!?;\n]{0,50}\b(?:approval|approve|confirmation|confirm|review)\b|(?:先|只|仅)[^。！？；\n]{0,30}(?:计划|方案)[^。！？；\n]{0,20}(?:确认|审批|审阅)|(?:计划|方案)[^。！？；\n]{0,20}(?:供我|让我|等待|等我)(?:确认|审批|审阅)/i;
const construction = /\b(?:create|generate|make|draft|prepare|write|produce|build|brainstorm|give me|i want|i would like)\b|生成|创建|制作|设计|出题|拟定|给我|提出|我想要|构思/gi;

function directTarget(clause, target) {
  for (const match of clause.matchAll(construction)) {
    if (target === 'questions' && /brainstorm|构思/i.test(match[0])) continue;
    const before = clause.slice(Math.max(0, match.index - 25), match.index);
    if (/\b(?:do not|don't|not|without|how to|whether to)\s*$|(?:不要|不|别|暂不|先不|如何|怎么|是否)$/.test(before)) continue;
    const span = clause.slice(match.index, match.index + 140);
    const endpoint = target === 'questions'
      ? /\b(?:questions?|quiz|quizzes)\b|题目|试题|测验|出题|(?:道|个)?(?:[^\d，。！？；\n]{0,20})题/.exec(span)
      : /\b(?:learning\s+objectives?|learning\s+outcomes?|LOs?)\b|学习目标|教学目标/.exec(span);
    if (!endpoint) continue;
    const prefix = span.slice(0, endpoint.index);
    if (target === 'questions' && /\b(?:plan|blueprint|objectives?|outcomes?)\b|计划|方案|学习目标|教学目标/.test(prefix)) continue;
    return clause.slice(match.index, match.index + Math.min(600, endpoint.index + endpoint[0].length));
  }
  return null;
}

// Only instructor text supplies generation authorization. Source text and
// model-generated plans cannot turn an LO request into a question request.
export function authoringWorkflowForRequest(previous, input, requestId, { clarification = false } = {}) {
  const text = String(input || '');
  const retained = previous?.version === 1 ? structuredClone(previous)
    : { version: 1, target: 'plan', autoContinue: false, automaticContinuations: 0 };
  if (clarification) return retained;
  const parts = clauses(text);
  const held = questionDeferral.test(text) || planFirst.test(text) || requestedAuthoringMode(text) === 'explore';
  const questionQuote = parts.map(part => directTarget(part, 'questions')).find(Boolean);
  const objectiveQuote = parts.map(part => directTarget(part, 'objectives')).find(Boolean);
  if (questionQuote && !held) return { version: 1, target: 'questions', autoContinue: true,
    authorization: { requestId, quote: questionQuote }, automaticContinuations: 0 };
  if (objectiveQuote && (!questionQuote || held)) return { version: 1, target: 'objectives', autoContinue: false,
    authorization: { requestId, quote: objectiveQuote }, automaticContinuations: 0 };
  const nativeQuote = parts.find(part => requestedAuthoringMode(part) === 'build' && !planFirst.test(part)
    && !/\b(?:plan|blueprint|objectives?|outcomes?)\b|计划|方案|学习目标|教学目标/i.test(part)
    && /\b(?:create|generate|make|draft|prepare|build)\b|生成|创建|制作|构建/i.test(part));
  if (nativeQuote && !planFirst.test(text) && requestedAuthoringMode(text) !== 'explore') return { version: 1, target: 'plan', autoContinue: false, automaticContinuations: 0,
    activityAuthorization: { requestId, quote: nativeQuote.slice(0, 600) }, questionGenerationAllowed: !questionDeferral.test(text) };
  if (held) return { ...retained, target: 'plan', autoContinue: false, automaticContinuations: 0, activityAuthorization: undefined };
  return retained;
}

const recoverable = new Set(['ANSWER_INVALID', 'RUBRIC_INVALID', 'INSTRUCTION_MISMATCH', 'FEEDBACK_INVALID',
  'ARITHMETIC_INVALID_SCHEMA', 'ARITHMETIC_FALSE_EQUALITY', 'ARITHMETIC_DIVISION_BY_ZERO',
  'ARITHMETIC_UNSUPPORTED_EXPRESSION', 'FEEDBACK_TEXT_LIMIT', 'QUESTION_DUPLICATE_DETECTED',
  'QUESTION_DUPLICATE', 'QUESTION_SLICE_MISMATCH', 'QUESTION_PLANNED_SLICE_MISMATCH']);

export function automaticContinuationDecision(workflow, assistant) {
  if (workflow?.target !== 'questions' || workflow.autoContinue !== true || !workflow.authorization?.quote
    || (workflow.automaticContinuations || 0) >= MAX_AUTOMATIC_CONTINUATIONS) return { allowed: false };
  const failed = (assistant?.generation?.items || []).filter(item => item.status === 'failed');
  if (!failed.length) return { allowed: false };
  const indexOnly = failed.every(item => item.failure?.code === 'MATERIAL_INDEX_MISSING');
  if (indexOnly) return { allowed: true, kind: 'restore-material-search', indices: failed.map(item => item.index) };
  if (!failed.every(item => recoverable.has(item.reason) || recoverable.has(item.code)
    || recoverable.has(item.failure?.code))) return { allowed: false };
  return { allowed: true, kind: 'repair-questions', indices: failed.map(item => item.index) };
}
