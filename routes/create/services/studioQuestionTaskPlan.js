import { normalizePlanningSources } from './studioTeachingBrief.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'H5P_ASSISTANT_INVALID_TASK_PLAN', status: 400 }); };
const cleanText = (value, label, limit) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`${label} must contain 1–${limit} characters.`);
  return value.trim();
};

export function needsQuestionTaskReallocation(plan) {
  return Array.isArray(plan) && plan.some(row => row?.questionTasks !== undefined
    && (!Array.isArray(row.questionTasks) || row.questionTasks.length !== row.count));
}

// Rebuilding per-item tasks must not change the teacher's row allocation.
export function assertQuestionTaskAllocation(requested, rebuilt) {
  if (!Array.isArray(requested) || !Array.isArray(rebuilt) || !requested.length || requested.length !== rebuilt.length) fail('The rebuilt plan must preserve every requested activity row.');
  for (let index = 0; index < requested.length; index++) {
    const expected = requested[index]; const actual = rebuilt[index];
    if (!expected || !actual || expected.questionType !== actual.questionType || expected.count !== actual.count
      || (expected.difficulty || 'moderate') !== (actual.difficulty || 'moderate')
      || !Array.isArray(expected.objectiveIds) || !Array.isArray(actual.objectiveIds)
      || expected.objectiveIds.length !== actual.objectiveIds.length || expected.objectiveIds.some((id, position) => id !== actual.objectiveIds[position])) {
      fail('The rebuilt tasks changed a requested objective, type, difficulty or question count. Review the plan before saving.');
    }
  }
  return rebuilt;
}

export function validateQuestionTasks(row, { trustedSources, required = false, promptBased = false } = {}) {
  if (row.questionTasks === undefined && !required) return undefined;
  if (!Array.isArray(row.questionTasks) || row.questionTasks.length !== row.count || row.count < 1 || row.count > 20) fail('Every planned question must have one distinct assessment task.');
  const known = trustedSources == null ? null : new Set(normalizePlanningSources(trustedSources).filter(source => source.excerpt?.trim()).map(source => source.id));
  const tasks = row.questionTasks.map((task, index) => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) fail('A planned question task is invalid.');
    if (!Array.isArray(task.sourceIds) || task.sourceIds.length > 8 || (!promptBased && !task.sourceIds.length)
      || task.sourceIds.some(id => typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || (known && !known.has(id)))
      || new Set(task.sourceIds).size !== task.sourceIds.length) fail('Question tasks must cite only available source IDs.');
    if (task.visualRequirement && task.visualRequirement !== 'none') fail('A text-only question task cannot depend on an unavailable visual asset.');
    const instructions = cleanText(task.instructions, 'Question task instructions', 1800);
    if (/as shown in (?:the|this) (?:diagram|figure|image|chart)|(?:refer to|use|read) (?:the )?(?:following|below|attached) (?:diagram|figure|image|chart)|如图所示|下图|附图/iu.test(instructions)) fail('A question task refers to a visual asset that this text-only plan does not provide.');
    const id = cleanText(task.id || `task-${row.id || 'row'}-${index + 1}`, 'Question task ID', 120);
    if (!/^[\w-]+$/.test(id)) fail('The question task ID is invalid.');
    return { id,
      focus: cleanText(task.focus, 'Question task focus', 180), instructions,
      sourceIds: [...task.sourceIds], visualRequirement: 'none' };
  });
  const distinct = key => new Set(tasks.map(task => task[key].toLocaleLowerCase().replace(/\s+/g, ' ').trim())).size === tasks.length;
  if (!distinct('id') || !distinct('focus') || !distinct('instructions')) fail('Repeated question tasks need distinct focuses and instructions before generation.');
  return tasks;
}

/** Check the complete allocation, including tasks split across activity rows. */
export function assertDistinctQuestionTasks(plan) {
  const ids = new Set(); const focuses = new Set(); const instructions = new Set();
  const normalize = value => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  for (const row of plan) {
    for (const task of row.questionTasks || []) {
      const objective = row.objectiveIds[0];
      const focus = JSON.stringify([objective, normalize(task.focus)]);
      const instruction = JSON.stringify([objective, row.questionType, normalize(task.instructions)]);
      if (ids.has(task.id)) fail('Question task IDs must be unique across the activity plan.');
      if (focuses.has(focus) || instructions.has(instruction)) fail('Repeated question tasks need distinct focuses and instructions across the activity plan.');
      ids.add(task.id); focuses.add(focus); instructions.add(instruction);
    }
  }
}

// The public config carries IDs only. The server supplies the owned snapshot;
// arbitrary client excerpts never become grounding evidence.
export function resolveQuestionTaskEvidence({ sourceIds, trustedSources = [], materialIds = [] } = {}) {
  if (!Array.isArray(sourceIds) || sourceIds.length > 8 || sourceIds.some(id => typeof id !== 'string') || new Set(sourceIds).size !== sourceIds.length) fail('The question task source selection is invalid.');
  const allowed = new Set(materialIds.map(String));
  const byId = new Map(normalizePlanningSources(trustedSources).map(source => [source.id, source]));
  return sourceIds.map(id => {
    const source = byId.get(id);
    if (!source || !source.excerpt?.trim() || !allowed.has(String(source.materialId))) fail('The question task evidence is outside the approved material snapshot.');
    const { excerpt, id: _id, ...metadata } = source;
    return { content: excerpt, metadata, ...(Number.isFinite(source.relevanceScore) ? { score: source.relevanceScore } : {}) };
  });
}
