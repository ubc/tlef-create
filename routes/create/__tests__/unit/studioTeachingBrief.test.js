import { describe, expect, test } from '@jest/globals';
import mongoose from 'mongoose';
import teachingBriefSchema from '../../models/studioTeachingBriefSchema.js';
import { applyTeachingOverview, buildMaterialTeachingBrief, normalizePlanningSources } from '../../services/studioTeachingBrief.js';

const owner = 'teacher';
const material = { _id: 'm-1', uploadedBy: owner, name: 'Week 3 Lecture Notes', type: 'pdf' };
const source = { id: 'src-1', materialId: 'm-1', materialName: material.name, sourceFile: 'week3.pdf', chunkIndex: 2,
  pageNumber: 3, pageStart: 3, pageEnd: 4, section: 'Newton laws', sectionId: 'laws', excerpt: 'A force acts on the object. Friction opposes motion.' };
const objective = { id: 'lo-1', text: 'Identify friction acting on an object.', sourceReferences: [source] };
const input = { materials: [material], sources: [source], objectives: [objective], userId: owner };

describe('truthful teaching overview', () => {
  test('separates filename inference from actual reading and stores existing goal provenance', () => {
    const result = buildMaterialTeachingBrief(input);
    expect(result.materials[0]).toMatchObject({ classification: 'lecture-notes', basis: 'metadata', readStatus: 'sampled', sourceCount: 1, sourceIds: ['src-1'] });
    expect(result.scope.coverage).toBe('sampled');
    expect(result.objectives).toEqual([{ id: 'lo-1', text: objective.text, sourceIds: ['src-1'], grounding: 'material-grounded' }]);
    expect(result.visualSupport).toBe('text-only');
    expect(result).not.toHaveProperty('completeCoverage');
    expect(input.objectives[0]).toBe(objective);
  });

  test('location-only historical evidence does not pretend that its text was read', () => {
    const location = { materialId: 'm-1', pageNumber: 4, sourceFile: 'week3.pdf' };
    const result = buildMaterialTeachingBrief({ ...input, sources: [location], objectives: [{ ...objective, sourceReferences: [location] }] });
    expect(result.materials[0]).toMatchObject({ classification: 'lecture-notes', basis: 'metadata', readStatus: 'not-read', sourceCount: 0 });
    expect(result.scope.coverage).toBe('not-read');
    expect(result.visualSupport).toBe('none');
    expect(result.objectives[0].sourceIds).toEqual([]);
    expect(normalizePlanningSources([location])[0]).not.toHaveProperty('excerpt');
  });

  test('prompt-only brainstorming gives editable goals and visible defaults without invented citations', () => {
    const result = buildMaterialTeachingBrief({ userId: owner, instructions: 'Discuss teaching friction.',
      objectives: [{ id: 'lo-1', text: objective.text, sourceReferences: [] }] });
    expect(result.grounding).toBe('instructor-brief');
    expect(result.materials).toEqual([]);
    expect(result.scope.coverage).toBe('instructor-brief');
    expect(result.objectives[0]).toMatchObject({ grounding: 'instructor-brief', sourceIds: [] });
    expect(result.assumptions.map(row => row.key)).toEqual(['audience', 'purpose', 'difficulty']);
  });

  test('explicit teacher specifications replace defaults and are not changed by a model summary', () => {
    const requirements = { fields: { audience: { value: 'Graduate students' }, purpose: { value: 'Summative assessment' }, difficulty: { value: 'hard' }, topic: { value: 'friction and tension' }, exclusions: { value: 'inclines' } } };
    const brief = buildMaterialTeachingBrief({ ...input, teachingRequirements: requirements });
    expect(brief.assumptions).toEqual([]);
    const updated = applyTeachingOverview(brief, { summary: 'Practice force identification.',
      materialClassifications: [{ materialId: 'm-1', classification: 'worked-examples', sourceIds: ['src-1'] }] }, [source]);
    expect(updated.materials[0]).toMatchObject({ classification: 'worked-examples', basis: 'text-excerpts', readStatus: 'sampled' });
    expect(updated.scope).toEqual(brief.scope);
    expect(updated.objectives).toEqual(brief.objectives);
    expect(brief.materials[0].classification).toBe('lecture-notes');
  });

  test.each([
    { ...input, materials: [{ ...material, uploadedBy: 'other-teacher' }] },
    { ...input, sources: [{ ...source, materialId: 'other-material' }] },
    { ...input, objectives: [{ ...objective, sourceReferences: [{ ...source, materialId: 'other-material' }] }] }
  ])('rejects outside-owner or unselected source snapshots', args => {
    expect(() => buildMaterialTeachingBrief(args)).toThrow();
  });

  test('classifications require actual selected excerpts, and duplicate source IDs cannot substitute content', () => {
    const brief = buildMaterialTeachingBrief(input);
    expect(() => applyTeachingOverview(brief, { summary: 'Summary', materialClassifications: [{ materialId: 'm-1', classification: 'assessment', sourceIds: ['foreign'] }] }, [source])).toThrow();
    expect(() => normalizePlanningSources([source, { ...source, excerpt: 'Substituted text' }])).toThrow();
    const { id: _id, ...legacy } = source;
    expect(normalizePlanningSources([legacy])[0].id).toEqual(normalizePlanningSources([structuredClone(legacy)])[0].id);
    expect(normalizePlanningSources([legacy])[0]).toMatchObject(legacy);
  });

  test('typed persisted brief retains classification basis, assumptions, goals and source IDs', () => {
    const Model = mongoose.models.TeachingBriefContract || mongoose.model('TeachingBriefContract', new mongoose.Schema({ teachingBrief: teachingBriefSchema }));
    const brief = buildMaterialTeachingBrief(input);
    const document = new Model({ teachingBrief: brief });
    expect(document.validateSync()).toBeUndefined();
    expect(document.toObject().teachingBrief).toEqual(brief);
    const updated = applyTeachingOverview(document.teachingBrief, { summary: 'Revised grounded overview.', materialClassifications: [] }, [source]);
    expect(updated.summary).toBe('Revised grounded overview.');
    expect(updated.objectives).toEqual(brief.objectives);
    expect(document.teachingBrief.summary).toBe(brief.summary);
  });
});
