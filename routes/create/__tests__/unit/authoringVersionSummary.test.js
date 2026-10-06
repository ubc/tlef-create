import { describe, test, expect } from '@jest/globals';
import { versionSummary } from '../../services/authoring/authoringContracts.js';

describe('version teaching plan boundary', () => {
  test('returns the candidate objectives and allocations without exposing the complete snapshot or internal metadata', () => {
    const summary = versionSummary({ _id: 'v2', representation: 'course-linked', snapshot: {
      learningObjectives: [{ _id: 'merged', text: 'Compare Newton II and III.', sourceReferences: [{ materialId: 'm1', excerpt: 'Evidence' }],
        generationMetadata: { privateReceipt: 'not a public field' } }],
      settings: { internalState: 'not a public field', planItems: [
        { type: 'multiple-choice', learningObjective: { _id: 'merged' }, count: 1, customPrompt: 'Cover both laws.' },
        { type: 'cloze', learningObjective: null, count: 1, customPrompt: 'Use this custom prompt.' }
      ] }, questions: []
    } });
    expect(summary.teachingPlan.objectives).toEqual([{ id: 'merged', text: 'Compare Newton II and III.',
      sourceReferences: [{ materialId: 'm1', excerpt: 'Evidence' }] }]);
    expect(summary.teachingPlan.plan.map(row => [row.count, row.objectiveIds, row.instructions])).toEqual([
      [1, ['merged'], 'Cover both laws.'], [1, [], 'Use this custom prompt.']
    ]);
    expect(new Set(summary.teachingPlan.plan.map(row => row.id)).size).toBe(2);
    expect(JSON.stringify(summary)).not.toContain('privateReceipt');
    expect(summary).not.toHaveProperty('snapshot');
  });
  test('keeps native activities separate from a course teaching plan', () => {
    expect(versionSummary({ _id: 'native', representation: 'native-fork' }).teachingPlan).toBeNull();
  });
});
