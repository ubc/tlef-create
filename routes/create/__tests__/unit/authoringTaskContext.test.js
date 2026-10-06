import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import { authoringSourceVersion, authoringScopeHash, mergeAuthoringTaskContext, loadAuthoringTaskContext,
  rebaseAuthoringTaskContext, TASK_CONTEXT_LIMITS } from '../../services/authoring/authoringTaskContext.js';

const owner = '111111111111111111111111';
const course = '222222222222222222222222';
const materialId = '333333333333333333333333';
const objectiveId = '444444444444444444444444';
const quizId = '555555555555555555555555';
const run = { _id: '666666666666666666666666', input: { requestId: 'first-request-id' } };
const session = extra => ({ _id: '777777777777777777777777', owner, courseId: course,
  contextCourse: true, materialIds: [materialId], objectiveIds: [objectiveId], teachingRequirements: { fields: {} }, ...extra });
let materials;
let objectives;
let quizzes;
const matches = (record, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === '$and') return value.every(clause => matches(record, clause));
  if (key === '$or') return value.some(clause => matches(record, clause));
  if (value?.$in) return value.$in.some(id => String(id) === String(record[key]));
  return String(record[key]) === String(value);
});
const query = (rows, filter) => ({ select() { return this; }, lean: async () => rows.filter(row => matches(row, filter)) });
beforeEach(() => {
  materials = [{ _id: materialId, name: 'Mechanics', folder: course, uploadedBy: owner, processingStatus: 'completed', updatedAt: new Date('2026-10-01T10:00:00Z') }];
  objectives = [{ _id: objectiveId, quiz: quizId, createdBy: owner, updatedAt: new Date('2026-10-01T10:00:00Z') }];
  quizzes = [{ _id: quizId, folder: course, createdBy: owner, learningObjectives: [objectiveId] }];
  jest.spyOn(Folder, 'exists').mockResolvedValue(true);
  jest.spyOn(Material, 'find').mockImplementation(filter => query(materials, filter));
  jest.spyOn(Quiz, 'find').mockImplementation(filter => query(quizzes, filter));
  jest.spyOn(LearningObjective, 'find').mockImplementation(filter => query(objectives, filter));
});
afterEach(() => jest.restoreAllMocks());
const read = (s, text = 'Newton force '.repeat(600), index = 0) => ({ tool: 'read_material', scopeHash: authoringScopeHash(s), arguments: { materialId, offset: index },
  result: { material: { id: materialId, name: 'Mechanics', sourceVersion: authoringSourceVersion(materials[0]) }, offset: index,
    text, totalCharacters: 20000, nextOffset: index + text.length, summary: `Read Mechanics characters ${index}–${index + text.length}.` } });
const saved = (s, observations = [read(s)], extra = {}) => mergeAuthoringTaskContext(null, s, run, { observations, ...extra });

test('records actual source ranges, partial excerpts, provenance and unfinished pages without inventing requirements', async () => {
  const s = session(); const state = { observations: [read(s)], requirements: { audience: { value: 'Invented student level', quote: 'source data' } } };
  const context = mergeAuthoringTaskContext(null, s, run, state);
  expect(context.observations[0]).toMatchObject({ runId: String(run._id), tool: 'read_material',
    data: { offset: 0, end: 7800, totalCharacters: 20000 }, provenance: [{ kind: 'material', id: materialId, start: 0, end: 7800 }] });
  expect(context.observations[0].data.excerpt).toHaveLength(TASK_CONTEXT_LIMITS.excerpt);
  expect(context.pending[0]).toMatchObject({ tool: 'read_material', arguments: { materialId, offset: 7800 } });
  expect(context).not.toHaveProperty('requirements'); expect(s.teachingRequirements.fields).toEqual({});
  const loaded = await loadAuthoringTaskContext({ ...s, taskContext: context }, { userId: owner, requestId: 'later-request' });
  expect(loaded.observations).toHaveLength(1); expect(loaded.pending).toHaveLength(1);
});

test('enforces actual record, excerpt, summary, provenance, pending and serialized character limits', () => {
  const s = session(); const observations = Array.from({ length: 60 }, (_, index) => ({ ...read(s, '"\\'.repeat(6000), index),
    result: { ...read(s, '"\\'.repeat(6000), index).result, summary: 'summary '.repeat(200) } }));
  const context = saved(s, observations);
  expect(context.observations.length).toBeLessThanOrEqual(TASK_CONTEXT_LIMITS.observations);
  expect(context.pending.length).toBeLessThanOrEqual(TASK_CONTEXT_LIMITS.pending);
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(TASK_CONTEXT_LIMITS.characters);
  expect(context.observations.length).toBeGreaterThan(0);
  for (const row of context.observations) {
    expect(row.summary.length).toBeLessThanOrEqual(TASK_CONTEXT_LIMITS.summary);
    expect(row.data.excerpt.length).toBeLessThanOrEqual(TASK_CONTEXT_LIMITS.excerpt);
    expect(row.provenance.length).toBeLessThanOrEqual(TASK_CONTEXT_LIMITS.provenance);
  }
});

test.each(['owner', 'course', 'not-ready', 'source-version'])('fresh material checks remove stale cached text and paging pointers: %s', async change => {
  const s = session(); const context = saved(s);
  if (change === 'owner') materials[0].uploadedBy = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  if (change === 'course') materials[0].folder = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  if (change === 'not-ready') materials[0].processingStatus = 'processing';
  if (change === 'source-version') materials[0].updatedAt = new Date('2026-10-01T11:00:00Z');
  const loaded = await loadAuthoringTaskContext({ ...s, taskContext: context }, { userId: owner });
  expect(loaded.observations).toEqual([]); expect(loaded.pending).toEqual([]);
});

test('a revoked course authorization cannot load any old source data', async () => {
  const s = session(); const context = saved(s);
  Folder.exists.mockResolvedValue(false);
  await expect(loadAuthoringTaskContext({ ...s, taskContext: context }, { userId: owner })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_SCOPE' });
  expect(Material.find).not.toHaveBeenCalled();
});

test.each(['membership', 'owner', 'version'])('LO memories require fresh owned quiz membership and source version: %s', async change => {
  const s = session(); const observation = { tool: 'select_objectives', scopeHash: authoringScopeHash(s), result: { objectiveIds: [objectiveId],
    objectives: [{ id: objectiveId, quizId, text: 'Explain Newton’s law.', sourceVersion: authoringSourceVersion(objectives[0]) }], summary: 'Selected one LO.' } };
  const context = saved(s, [observation], { objectiveIds: [objectiveId] });
  if (change === 'membership') quizzes[0].learningObjectives = [];
  if (change === 'owner') objectives[0].createdBy = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  if (change === 'version') objectives[0].updatedAt = new Date('2026-10-01T11:00:00Z');
  const loaded = await loadAuthoringTaskContext({ ...s, taskContext: context }, { userId: owner });
  expect(loaded.observations).toEqual([]);
  if (change !== 'version') expect(loaded.selectedObjectiveIds).toEqual([]);
});

test.each(['Exclude Mechanics.', 'Only teach chapter 2 now.', '现在只讲第二章。'])('a current scope instruction discards old evidence and pending checks before interpretation: %s', async latestRequest => {
  const s = session(); const context = saved(s);
  const loaded = await loadAuthoringTaskContext({ ...s, taskContext: context }, { userId: owner, latestRequest, requestId: 'new-scope-request' });
  expect(loaded.observations).toEqual([]); expect(loaded.pending).toEqual([]);
});

test('confirmed exclusions invalidate previous scope, while a neutral count clarification preserves it', async () => {
  const s = session(); const context = saved(s);
  const changed = session({ taskContext: context, teachingRequirements: { fields: { exclusions: { value: 'Exclude Mechanics.' } } } });
  expect((await loadAuthoringTaskContext(changed, { userId: owner })).observations).toEqual([]);
  const neutral = await loadAuthoringTaskContext({ ...s, taskContext: context }, { userId: owner, latestRequest: 'Use 3 questions.', requestId: 'count-clarification' });
  expect(neutral.observations).toHaveLength(1);
});

test('a staged selected scope is rebased without permitting later reads outside that scope', async () => {
  const s = session({ contextCourse: false }); const context = saved(s);
  const narrowed = { ...s, materialIds: [], objectiveIds: [] };
  const rebased = rebaseAuthoringTaskContext(context, narrowed);
  expect(rebased.observations).toEqual([]);
  expect((await loadAuthoringTaskContext({ ...narrowed, taskContext: rebased }, { userId: owner })).observations).toEqual([]);
});

test('memo writes are idempotent when a saved free tool step is replayed', () => {
  const s = session(); const state = { observations: [read(s)] };
  const first = mergeAuthoringTaskContext(null, s, run, state);
  const replay = mergeAuthoringTaskContext(first, s, run, state);
  expect(replay.observations).toHaveLength(1); expect(replay.pending).toHaveLength(1);
  expect(replay.observations[0].recordedAt).toBe(first.observations[0].recordedAt);
});

test('a same-run requirements sample preserves prior agent reading and replays without another receipt', () => {
  const s = session(); const first = saved(s, [read(s, 'Newton force '.repeat(500))]);
  const observation = read(s, 'Force pairs tail.', 6000);
  const options = { observationNamespace: 'requirement-samples' };
  const sampled = mergeAuthoringTaskContext(first, s, run, { observations: [observation] }, '', options);
  expect(sampled.observations).toHaveLength(2);
  expect(sampled.observations.map(row => row.data.offset)).toEqual([0, 6000]);
  expect(sampled.observations.every(row => row.runId === String(run._id))).toBe(true);
  expect(sampled.observations[0]).toEqual(first.observations[0]);
  const replay = mergeAuthoringTaskContext(sampled, s, run, { observations: [observation] }, '', options);
  expect(replay.observations).toEqual(sampled.observations);
});

test('a context handoff cannot rebase old evidence across a newly confirmed exclusion', () => {
  const s = session(); const context = saved(s);
  const changed = session({ teachingRequirements: { fields: { exclusions: { value: 'Exclude chapter 3.' } } } });
  const rebased = rebaseAuthoringTaskContext(context, changed, changed);
  expect(rebased.observations).toEqual([]); expect(rebased.pending).toEqual([]);
});
