import { describe, expect, test } from '@jest/globals';
import { replaceNativeLearningGoals, reviseNativeTeachingObjectives } from '../../services/authoring/nativeTeachingObjectives.js';

const source = { id: 'src-chart', materialId: 'm-1', excerpt: 'Acceleration increases with net force for a fixed mass.' };
const brief = { version: 1, grounding: 'material-grounded', summary: 'Interpret an acceleration chart.', scope: { topics: ['Newton laws'], exclusions: ['friction'] },
  materials: [{ id: 'm-1', name: 'Lecture notes', readStatus: 'sampled' }], assumptions: [{ key: 'difficulty', value: 'Moderate', provenance: 'default' }],
  objectives: [{ id: 'lo-1', text: 'Read the acceleration trend.', sourceIds: ['src-chart'], grounding: 'material-grounded' },
    { id: 'lo-2', text: 'Explain a data point.', sourceIds: ['src-chart'], grounding: 'material-grounded' }] };
const objectives = [{ id: 'lo-2', text: 'Explain the change in acceleration.' }, { id: 'lo-1', text: ' Compare two plotted values. ' }];
const input = { brief, objectives, trustedSources: [source], materialIds: ['m-1'] };

describe('native teaching goal editing', () => {
  test('text edits retain original identities, order, selected source provenance and other teaching constraints', () => {
    const next = reviseNativeTeachingObjectives(input);
    expect(next.objectives).toEqual([{ ...brief.objectives[0], text: 'Compare two plotted values.' }, { ...brief.objectives[1], text: 'Explain the change in acceleration.' }]);
    expect(next.scope).toEqual(brief.scope);
    expect(next.materials).toEqual(brief.materials);
    expect(next.assumptions).toEqual(brief.assumptions);
    expect(brief.objectives[0].text).toBe('Read the acceleration trend.');
  });

  test.each([
    objectives.slice(0, 1), [objectives[0], objectives[0]], [{ ...objectives[0], id: 'new-goal' }, objectives[1]],
    [{ ...objectives[0], text: '' }, objectives[1]], [{ ...objectives[0], text: 'a'.repeat(501) }, objectives[1]],
    [{ ...objectives[0], sourceIds: ['forged-source'] }, objectives[1]]
  ].map(values => [values]))('rejects partial, duplicate, new-ID, oversized or source-changing submissions', values => {
    expect(() => reviseNativeTeachingObjectives({ ...input, objectives: values })).toThrow();
  });

  test('existing evidence must remain in the real selected source snapshot', () => {
    expect(() => reviseNativeTeachingObjectives({ ...input, materialIds: ['other-material'] })).toThrow();
    expect(() => reviseNativeTeachingObjectives({ ...input, trustedSources: [] })).toThrow();
    expect(() => reviseNativeTeachingObjectives({ ...input, trustedSources: [{ ...source, excerpt: undefined }] })).toThrow();
    const promptBrief = { ...brief, grounding: 'instructor-brief', objectives: brief.objectives.map(objective => ({ ...objective, sourceIds: [], grounding: 'instructor-brief' })) };
    expect(reviseNativeTeachingObjectives({ brief: promptBrief, objectives }).objectives[0].sourceIds).toEqual([]);
  });

  test('each subsequent edit replaces the goals block and preserves original instructor data and exclusions', () => {
    const original = 'Use the exact data [1, 4, 9]. Exclude friction.';
    const first = replaceNativeLearningGoals(original, brief.objectives);
    const edited = replaceNativeLearningGoals(first, reviseNativeTeachingObjectives(input).objectives);
    expect(edited).toContain(original);
    expect(edited).not.toContain('Read the acceleration trend.');
    expect(edited.match(/BEGIN SAVED ACTIVITY LEARNING GOALS/g)).toHaveLength(1);
    expect(replaceNativeLearningGoals(edited, reviseNativeTeachingObjectives(input).objectives)).toBe(edited);
  });

  test('migrates the exact old appended block without stripping the instructor brief', () => {
    const original = 'Keep the data unchanged.';
    const legacy = `${original}\n\nPROPOSED TEACHING GOALS (editable recommendations; preserve the instructor data and exclusions): ["Old recommendation"]`;
    const result = replaceNativeLearningGoals(legacy, brief.objectives);
    expect(result).toContain(original);
    expect(result).not.toContain('Old recommendation');
    expect(() => replaceNativeLearningGoals('BEGIN SAVED ACTIVITY LEARNING GOALS\nwithout end', brief.objectives)).toThrow();
  });
});
