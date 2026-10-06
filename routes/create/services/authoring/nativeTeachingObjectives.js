import { normalizePlanningSources } from '../studioTeachingBrief.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'AUTHORING_OBJECTIVE_EDIT', status: 400 }); };
const start = 'BEGIN SAVED ACTIVITY LEARNING GOALS';
const end = 'END SAVED ACTIVITY LEARNING GOALS';

// This is a text edit to server-owned goals, not permission to replace the
// source snapshot, remove a goal, or introduce another goal identity.
export function reviseNativeTeachingObjectives({ brief, objectives, trustedSources = [], materialIds = [] } = {}) {
  const existing = brief?.objectives;
  if (!Array.isArray(existing) || !existing.length || existing.length > 8 || !Array.isArray(objectives)
    || objectives.length !== existing.length || !Array.isArray(materialIds)) fail('Edit the complete current set of activity learning objectives.');
  const byId = new Map(existing.map(objective => [objective.id, objective]));
  if (byId.size !== existing.length || existing.some(objective => typeof objective.id !== 'string' || !/^[\w-]{1,100}$/.test(objective.id))) fail('The saved activity objective identities are invalid.');
  const allowed = new Set(materialIds.map(String));
  const sources = new Map(normalizePlanningSources(trustedSources).map(source => [source.id, source]));
  for (const objective of existing) {
    if (!Array.isArray(objective.sourceIds) || objective.sourceIds.some(id => !sources.get(id)?.excerpt?.trim()
      || !allowed.has(String(sources.get(id).materialId)))) fail('A saved learning objective refers to evidence outside the selected source snapshot.');
  }
  const submitted = new Map();
  for (const objective of objectives) {
    if (!objective || typeof objective !== 'object' || Array.isArray(objective)
      || Object.keys(objective).some(key => !['id', 'text'].includes(key)) || !byId.has(objective.id) || submitted.has(objective.id)
      || typeof objective.text !== 'string' || !objective.text.trim() || objective.text.length > 500) fail('Use each current objective ID once and keep its text between 1 and 500 characters.');
    submitted.set(objective.id, objective.text.trim());
  }
  const next = structuredClone(brief?.toObject?.() || brief);
  next.objectives = existing.map(objective => ({ ...(objective.toObject?.() || objective), text: submitted.get(objective.id) }));
  return next;
}

export function replaceNativeLearningGoals(instructions, objectives) {
  if (typeof instructions !== 'string' || !Array.isArray(objectives) || !objectives.length || objectives.length > 8
    || objectives.some(objective => !objective || typeof objective.id !== 'string' || !/^[\w-]{1,100}$/.test(objective.id)
      || typeof objective.text !== 'string' || !objective.text.trim() || objective.text.length > 500)) fail('The activity instructions and goals are invalid.');
  let text = instructions;
  const begins = [...text.matchAll(/^BEGIN SAVED ACTIVITY LEARNING GOALS$/gm)];
  const ends = [...text.matchAll(/^END SAVED ACTIVITY LEARNING GOALS$/gm)];
  if (begins.length || ends.length) {
    const first = begins[0]?.index;
    const last = ends[0]?.index;
    if (begins.length !== 1 || ends.length !== 1 || last < first) fail('The saved learning-goal block is invalid.');
    text = `${text.slice(0, first).trimEnd()}${text.slice(last + end.length)}`.trimEnd();
  } else {
    // A previous application version appended one JSON line at the very end.
    text = text.replace(/\n\nPROPOSED TEACHING GOALS \(editable recommendations; preserve the instructor data and exclusions\): [^\n]*$/u, '').trimEnd();
  }
  const result = `${text}\n\n${start}\n${JSON.stringify(objectives.map(({ id, text: goal }) => ({ id, text: goal })))}\n${end}`;
  if (result.length > 12000) fail('Shorten the activity instructions or learning objectives to fit 12,000 characters.');
  return result;
}
