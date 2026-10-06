import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import { digest, fail, objectId } from './authoringContracts.js';
import { isMaterialReady } from '../../utils/generationReadiness.js';

export const TASK_CONTEXT_LIMITS = { observations: 12, pending: 5, provenance: 4, summary: 400, excerpt: 800, characters: 12000 };
const sourceTools = new Set(['list_materials', 'read_material', 'search_materials', 'read_objectives', 'select_materials', 'select_objectives']);
const cut = (value, length) => String(value || '').slice(0, length);
const distinctIds = (values, limit) => [...new Set((Array.isArray(values) ? values : []).map(String).filter(objectId))].slice(0, limit);
const scopeChange = /\b(?:exclude|omit|skip|leave out|only (?:use|cover|teach)|focus on|switch (?:topic|chapter)|instead of)\b|\b(?:chapter|lecture|unit|section)\s*\d+\b|排除|不要(?:使用|覆盖)|只(?:使用|用|讲|教|覆盖)|仅(?:使用|用|讲|教|覆盖)|(?:更换|切换)(?:主题|材料)|第\s*[\d一二三四五六七八九十]+\s*[章节]/i;
const exclusionClause = /\b(?:exclude|omit|skip|leave out|do not use|don't use|do not cover|don't cover)\b|排除|不要(?:使用|用|覆盖)|不(?:使用|用|覆盖)/i;

export const authoringSourceVersion = row => row.updatedAt ? new Date(row.updatedAt).toISOString() : String(row.checksum || row.processingMetadata?.processedAt || '');
export function authoringScopeHash(session) {
  return digest({ owner: String(session.owner), courseId: String(session.courseId), contextCourse: session.contextCourse === true,
    materialIds: distinctIds(session.materialIds, 20).sort(), objectiveIds: distinctIds(session.objectiveIds, 8).sort(),
    requirements: Object.fromEntries(['topic', 'mustCover', 'exclusions'].map(key => [key, session.teachingRequirements?.fields?.[key]?.value || ''])) });
}

export function authoringMaterialExcluded(session, material, latestRequest = '') {
  const exclusions = [session.teachingRequirements?.fields?.exclusions?.value || '',
    ...String(latestRequest).split(/[,，;；.!?。！？\n]|\bbut\b|但是/i).filter(clause => exclusionClause.test(clause))].join('\n').toLocaleLowerCase();
  const name = String(material.name || '').trim().toLocaleLowerCase();
  const id = String(material._id || material.id || '');
  return !!exclusions && ((id && exclusions.includes(id.toLocaleLowerCase())) || (name.length >= 3 && exclusions.includes(name)));
}

export function allowedObjectiveSourceReferences(references, materialIds) {
  const allowed = new Set((materialIds || []).map(String));
  return (references || []).filter(reference => allowed.has(String(reference.materialId || '')));
}

const emptyContext = (session, scopeRequestId = '') => ({ version: 1, scopeHash: authoringScopeHash(session), scopeRequestId,
  observations: [], pending: [], selectedObjectiveIds: [], selectedMaterialIds: [] });
function boundedContext(context) {
  context.observations = context.observations.slice(-TASK_CONTEXT_LIMITS.observations);
  context.pending = context.pending.slice(-TASK_CONTEXT_LIMITS.pending);
  while (JSON.stringify(context).length > TASK_CONTEXT_LIMITS.characters && context.observations.length) context.observations.shift();
  const retained = new Set(context.observations.map(observation => observation.id));
  context.pending = context.pending.filter(item => retained.has(item.observationId));
  return context;
}

function summarizeObservation(observation, runId, index) {
  if (!sourceTools.has(observation.tool) || observation.result?.error || !observation.scopeHash) return null;
  const result = observation.result || {};
  const provenance = [];
  const material = (row, start, end) => {
    if (!objectId(row?.id) || !row.sourceVersion) return null;
    provenance.push({ kind: 'material', id: row.id, sourceVersion: cut(row.sourceVersion, 100),
      ...(Number.isInteger(start) ? { start, end } : {}) });
    return { id: row.id, name: cut(row.name, 255) };
  };
  const objective = row => {
    if (!objectId(row?.id) || !objectId(row.quizId) || !row.sourceVersion) return null;
    provenance.push({ kind: 'objective', id: row.id, quizId: row.quizId, sourceVersion: cut(row.sourceVersion, 100) });
    return { id: row.id, text: cut(row.text, TASK_CONTEXT_LIMITS.excerpt / TASK_CONTEXT_LIMITS.provenance) };
  };
  let data = {};
  if (observation.tool === 'read_material') {
    const row = material(result.material, result.offset, result.offset + String(result.text || '').length);
    if (!row) return null;
    data = { material: row, offset: result.offset, end: result.offset + String(result.text || '').length,
      totalCharacters: result.totalCharacters, excerpt: cut(result.text, TASK_CONTEXT_LIMITS.excerpt), nextOffset: result.nextOffset ?? null };
  } else if (observation.tool === 'search_materials') {
    data = { query: cut(observation.arguments?.query, 300), scannedMaterials: result.scannedMaterials,
      results: (result.results || []).slice(0, TASK_CONTEXT_LIMITS.provenance).flatMap(row => {
        const label = material(row.material, row.offset, row.offset + String(row.excerpt || '').length);
        return label ? [{ material: label, offset: row.offset, excerpt: cut(row.excerpt, TASK_CONTEXT_LIMITS.excerpt / TASK_CONTEXT_LIMITS.provenance) }] : [];
      }), nextOffset: result.nextOffset ?? null };
  } else if (observation.tool === 'read_objectives' || observation.tool === 'select_objectives') {
    data = { objectives: (result.objectives || []).slice(0, TASK_CONTEXT_LIMITS.provenance).map(objective).filter(Boolean), nextOffset: result.nextOffset ?? null };
  } else data = { materials: (result.materials || []).slice(0, TASK_CONTEXT_LIMITS.provenance).map(row => material(row)).filter(Boolean), nextOffset: result.nextOffset ?? null };
  if (!provenance.length) return null;
  return { id: `${runId}:${index}`, runId: String(runId), tool: observation.tool, scopeHash: observation.scopeHash,
    summary: cut(result.summary, TASK_CONTEXT_LIMITS.summary), recordedAt: new Date().toISOString(), data, provenance };
}

function pendingCheck(observation) {
  if (!Number.isInteger(observation.data.nextOffset)) return null;
  const args = observation.tool === 'read_material' ? { materialId: observation.data.material.id, offset: observation.data.nextOffset }
    : observation.tool === 'search_materials' ? { query: observation.data.query, offset: observation.data.nextOffset }
      : { offset: observation.data.nextOffset };
  return { observationId: observation.id, tool: observation.tool, arguments: args,
    summary: observation.tool === 'read_material' ? 'Unread source text remains after this recorded range.' : 'Another page remains unchecked. Continue only if it fits the current teaching scope.' };
}

// Persist only actual server tool observations. Material text and old tool
// outputs cannot become instructor requirements or authorize another action.
export function mergeAuthoringTaskContext(previous, session, run, state, latestRequest = '', { observationNamespace = '' } = {}) {
  const requestId = String(run.input?.requestId || run.requestId || run._id);
  const scopeHash = authoringScopeHash(session);
  const changed = scopeChange.test(latestRequest) && previous?.scopeRequestId !== requestId;
  const next = emptyContext(session, scopeChange.test(latestRequest) ? requestId : cut(previous?.scopeRequestId, 80));
  if (previous?.version === 1 && previous.scopeHash === scopeHash && !changed) {
    next.observations = Array.isArray(previous.observations) ? structuredClone(previous.observations.slice(-TASK_CONTEXT_LIMITS.observations)) : [];
    next.selectedObjectiveIds = distinctIds(previous.selectedObjectiveIds, 8);
    next.selectedMaterialIds = distinctIds(previous.selectedMaterialIds, 20);
  }
  const entries = new Map(next.observations.map(observation => [observation.id, observation]));
  // Separate actual server reading stages in one run while keeping each stage's
  // replay stable and retaining the real run identity in every observation.
  const namespace = /^[a-z][a-z-]{0,39}$/.test(observationNamespace) ? `${observationNamespace}:` : '';
  for (const [index, observation] of (state.observations || []).entries()) {
    const row = summarizeObservation(observation, run._id, `${namespace}${index}`);
    if (row?.scopeHash === scopeHash) {
      row.recordedAt = entries.get(row.id)?.recordedAt || row.recordedAt;
      entries.set(row.id, row);
    }
  }
  next.observations = [...entries.values()];
  next.pending = next.observations.map(pendingCheck).filter(Boolean);
  next.selectedObjectiveIds = distinctIds(state.objectiveIds || next.selectedObjectiveIds, 8);
  next.selectedMaterialIds = distinctIds(state.materialIds || next.selectedMaterialIds, 20);
  next.updatedAt = new Date().toISOString();
  return boundedContext(next);
}

// A successful staged selection changes Session's selected IDs after the agent
// returns. Keep only observations inside that selected scope and rebase them.
export function rebaseAuthoringTaskContext(context, session, previousSession) {
  const next = emptyContext(session, cut(context?.scopeRequestId, 80));
  if (previousSession && context?.scopeHash !== authoringScopeHash(previousSession)) return next;
  const materialIds = (session.materialIds || []).map(String);
  const objectiveIds = (session.objectiveIds || []).map(String);
  next.observations = (context?.observations || []).filter(row => session.contextCourse === true
    || row.provenance.every(ref => (ref.kind === 'material' ? materialIds : objectiveIds).includes(ref.id)))
    .map(row => ({ ...row, scopeHash: next.scopeHash }));
  next.pending = next.observations.map(pendingCheck).filter(Boolean);
  next.selectedMaterialIds = distinctIds(context?.selectedMaterialIds, 20).filter(id => materialIds.includes(id));
  next.selectedObjectiveIds = distinctIds(context?.selectedObjectiveIds, 8).filter(id => objectiveIds.includes(id));
  return boundedContext(next);
}

export async function loadAuthoringTaskContext(session, { userId, latestRequest = '', requestId = '', signal, guard = async () => {} }) {
  const source = session.taskContext;
  const empty = emptyContext(session, scopeChange.test(latestRequest) ? String(requestId) : source?.scopeRequestId);
  signal?.throwIfAborted(); await guard();
  if (String(session.owner) !== String(userId) || !await Folder.exists({ _id: session.courseId, instructor: userId })) fail('The authorized course is no longer available.', 404, 'AUTHORING_AGENT_SCOPE');
  if (!source || source.version !== 1 || source.scopeHash !== empty.scopeHash
    || (scopeChange.test(latestRequest) && source.scopeRequestId !== String(requestId))) return empty;
  // Validate all referenced sources afresh, including an objective's live quiz
  // membership. A cached label or excerpt never expands current authorization.
  const observations = Array.isArray(source.observations) ? source.observations.slice(-TASK_CONTEXT_LIMITS.observations) : [];
  const refs = observations.flatMap(row => (row.provenance || []).slice(0, TASK_CONTEXT_LIMITS.provenance));
  const materialIds = distinctIds([...refs.filter(ref => ref.kind === 'material').map(ref => ref.id), ...(source.selectedMaterialIds || [])], 68);
  const objectiveIds = distinctIds([...refs.filter(ref => ref.kind === 'objective').map(ref => ref.id), ...(source.selectedObjectiveIds || [])], 56);
  const [materials, quizzes] = await Promise.all([
    materialIds.length ? Material.find({ _id: { $in: materialIds }, folder: session.courseId, uploadedBy: userId,
      ...(session.contextCourse === true ? {} : { $and: [{ _id: { $in: (session.materialIds || []).map(String) } }] }) }).select('name updatedAt checksum processingStatus processingMetadata').lean() : [],
    objectiveIds.length ? Quiz.find({ folder: session.courseId, createdBy: userId }).select('learningObjectives').lean() : []
  ]);
  const clauses = quizzes.flatMap(quiz => (quiz.learningObjectives || []).filter(id => objectiveIds.includes(String(id)))
    .filter(id => session.contextCourse === true || (session.objectiveIds || []).map(String).includes(String(id))).map(id => ({ _id: String(id), quiz: quiz._id })));
  const objectives = clauses.length ? await LearningObjective.find({ createdBy: userId, $or: clauses }).select('quiz updatedAt').lean() : [];
  const materialMap = new Map(materials.filter(row => isMaterialReady(row) && !authoringMaterialExcluded(session, row, latestRequest)).map(row => [String(row._id), row]));
  const objectiveMap = new Map(objectives.map(row => [String(row._id), row]));
  const valid = ref => {
    const row = (ref.kind === 'material' ? materialMap : ref.kind === 'objective' ? objectiveMap : new Map()).get(String(ref.id));
    return row && ref.sourceVersion && authoringSourceVersion(row) === ref.sourceVersion
      && (ref.kind !== 'objective' || String(row.quiz) === String(ref.quizId));
  };
  empty.observations = observations.filter(row => row.scopeHash === empty.scopeHash && row.provenance?.length
    && row.provenance.length <= TASK_CONTEXT_LIMITS.provenance && row.provenance.every(valid)).map(row => ({
    ...row, summary: cut(row.summary, TASK_CONTEXT_LIMITS.summary) }));
  empty.pending = empty.observations.map(pendingCheck).filter(Boolean);
  empty.selectedMaterialIds = distinctIds(source.selectedMaterialIds, 20).filter(id => materialMap.has(id));
  empty.selectedObjectiveIds = distinctIds(source.selectedObjectiveIds, 8).filter(id => objectiveMap.has(id));
  signal?.throwIfAborted(); await guard();
  return boundedContext(empty);
}
