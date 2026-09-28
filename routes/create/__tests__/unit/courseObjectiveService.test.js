import { describe, test, expect, jest, beforeEach } from '@jest/globals';
const generate = jest.fn();
const buildPrompt = jest.fn(async ({ promptType }) => ({ prompt: promptType, source: 'course', version: 3 }));
jest.unstable_mockModule('../../services/llmService.js', () => ({ default: { generateLearningObjectives: generate } }));
jest.unstable_mockModule('../../services/coursePromptService.js', () => ({ default: {
  buildCoursePromptInstructions: buildPrompt, mergePromptParts: (...parts) => parts.join('\n')
} }));
jest.unstable_mockModule('../../models/User.js', () => ({ default: { findById: () => ({ select: async () => ({ preferences: { llmModel: 'fixture' } }) }) } }));
const { generateCourseObjectives } = await import('../../services/authoring/courseObjectiveService.js');
beforeEach(() => { generate.mockReset(); buildPrompt.mockClear(); });
describe('course objectives in conversational authoring', () => {
  test('uses the canonical pipeline and preserves subpoints, evidence and coverage diagnostics', async () => {
    const evidence = { materialId: 'material1', pageStart: 2, pageEnd: 3, excerpt: 'Water evaporates.' };
    generate.mockResolvedValue({ objectives: [{ text: 'Explain evaporation.', subpoints: [{ text: 'Energy transfer' }], sourceReferences: [evidence] }],
      coverageDiagnostics: { coverage: 1 }, inventoryDiagnostics: { chunks: 4 }, llmModel: 'fixture-model' });
    const result = await generateCourseObjectives({ materials: ['material'], quiz: { name: 'Water', folder: 'course1' }, owner: 'owner1', instructions: 'First year' });
    expect(generate).toHaveBeenCalledWith(['material'], 'Learning Object: Water', 6, { llmModel: 'fixture' },
      'learning-objectives\ncoverage-map', 'First year', 'owner1', undefined);
    expect(result[0]).toMatchObject({ text: 'Explain evaporation.', sourceReferences: [evidence], metadata: {
      subpoints: [{ text: 'Energy transfer' }], promptSource: 'course', promptVersion: 3, coverageDiagnostics: { coverage: 1 }, llmModel: 'fixture-model'
    } });
  });
  test('accepts the canonical string fallback and rejects empty or oversized objective sets', async () => {
    const input = { materials: [], quiz: { name: 'Water', folder: 'course1' }, owner: 'owner1', instructions: '' };
    generate.mockResolvedValue(['Explain evaporation.']);
    expect((await generateCourseObjectives(input))[0].text).toBe('Explain evaporation.');
    generate.mockResolvedValue([{ text: '' }]);
    await expect(generateCourseObjectives(input)).rejects.toMatchObject({ status: 422 });
    generate.mockResolvedValue(Array(9).fill('Explain evaporation.'));
    await expect(generateCourseObjectives(input)).rejects.toMatchObject({ status: 422 });
  });
});
