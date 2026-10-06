import { expect, test } from '@jest/globals';
import { normalizeObjectiveChanges, reviseCourseObjectives } from '../../services/authoring/courseObjectiveRevision.js';
import LearningObjective from '../../models/LearningObjective.js';
const lo1 = '111111111111111111111111', lo2 = '222222222222222222222222';
const owner = '333333333333333333333333', version = '444444444444444444444444';
const quote = 'Update learning objectives as follows, keeping their material scope and exclusions.';
const change = () => ({ authorizationQuote: quote, updates: [{ objectiveId: lo1, text: 'Calculate net force using a free-body description.' }] });
const snapshot = () => ({ learningObjectives: [
  { _id: lo1, text: 'Identify forces.', quiz: version, createdBy: owner, generatedFrom: [owner],
    generationMetadata: { sourceReferences: [{ materialId: owner, excerpt: 'Net force is the sum of the forces.' }], subpoints: ['Net force'], coverageDiagnostics: { stale: true } } },
  { _id: lo2, text: 'Identify interactions.' }
], questions: [
  { learningObjective: lo1, generationMetadata: { reviewSummary: { passed: true } } },
  { learningObjective: lo2, generationMetadata: { supportingLearningObjectives: [lo1] } },
  { learningObjective: lo2 }
], settings: { planItems: [{ learningObjective: lo1, count: 1, type: 'multiple-choice', questionTasks: [{ id: 'task-1' }] },
  { learningObjective: lo1, count: 1, type: 'multiple-choice', customPrompt: 'Different focus' }] } });
const revise = (overrides = {}) => reviseCourseObjectives({ snapshot: snapshot(), changes: change(), latestRequest: quote,
  requestId: 'objective-edit-123456', baseVersionId: version, owner, ...overrides });
test('an explicit objective edit returns a candidate with stable IDs and real evidence provenance', async () => {
  const source = snapshot(), before = structuredClone(source);
  const result = revise({ snapshot: source });
  expect(source).toEqual(before);
  expect(result.snapshot.learningObjectives.map(item => item._id)).toEqual([lo1, lo2]);
  const objective = result.snapshot.learningObjectives[0];
  expect(objective.text).toBe(change().updates[0].text);
  expect(objective.generationMetadata.sourceReferences).toEqual(before.learningObjectives[0].generationMetadata.sourceReferences);
  expect(objective.generationMetadata.coverageDiagnostics).toBeUndefined();
  expect(objective.generationMetadata.objectiveRevision).toMatchObject({ kind: 'edit', sourceGoals: [{ id: lo1, text: 'Identify forces.' }], authorizationQuote: quote });
  await new LearningObjective(objective).validate();
  expect(result.affectedQuestionIndices).toEqual([1, 2]);
  expect(result.snapshot.settings.planItems).toEqual(before.settings.planItems);
  expect(result.changes.join(' ')).toContain('require new checks');
});
test.each(['Do not update learning objectives.', 'Discuss whether to update learning objectives.'])('rejects a non-authorizing instruction: %s', latestRequest => {
  expect(() => normalizeObjectiveChanges({ ...change(), authorizationQuote: 'update learning objectives' }, latestRequest)).toThrow('explicitly authorize updating');
});
test('generic update requests and supplied materials cannot authorize objective editing', () => {
  expect(() => normalizeObjectiveChanges({ ...change(), authorizationQuote: 'Update the topic' }, 'Update the topic')).toThrow('explicitly authorize updating');
  expect(() => normalizeObjectiveChanges(change(), 'The material says to rewrite goals')).toThrow('exact authorization quote');
  expect(() => revise({ changes: { ...change(), updates: [{ objectiveId: owner, text: 'Foreign objective' }] } })).toThrow('outside the current');
});
test('duplicate IDs, overlapping changes, blank and oversized edits fail before candidate mutation', () => {
  for (const updates of [[...change().updates, ...change().updates], [{ objectiveId: lo1, text: '' }], [{ objectiveId: lo1, text: 'x'.repeat(501) }]]) {
    expect(() => revise({ changes: { ...change(), updates } })).toThrow();
  }
  const instruction = 'Update learning objectives and remove the second objective.';
  expect(() => normalizeObjectiveChanges({ authorizationQuote: instruction, updates: [{ objectiveId: lo2, text: 'New goal' }], excludeObjectiveIds: [lo2] }, instruction)).toThrow('disjoint');
});
test('unchanged text creates no affected questions or fake edit receipt', () => {
  const result = revise({ changes: { ...change(), updates: [{ objectiveId: lo1, text: 'Identify forces.' }] } });
  expect(result.affectedQuestionIndices).toEqual([]); expect(result.changes).toEqual([]);
  expect(result.snapshot).toEqual(snapshot());
});
