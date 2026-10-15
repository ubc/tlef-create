import { describe, expect, test } from '@jest/globals';
import { interpretInstructions, parseInterpretation } from '../../services/instructionInterpreter.js';

const learningObjectives = [
  { text: 'Define stress and strain.' },
  { text: 'Apply Hooke’s law.' },
  { text: 'Analyze beam deflection.' },
  { text: 'Evaluate material selection.' }
];

const modelReply = fields => async () => JSON.stringify({
  onlyLearningObjectives: [],
  emphasizeLearningObjectives: [],
  deemphasizeLearningObjectives: [],
  onlyQuestionType: null,
  includeQuestionTypes: [],
  excludeQuestionTypes: [],
  difficulty: null,
  otherGuidance: '',
  ...fields
});

describe('interpretInstructions', () => {
  test('uses the model reading of phrasing keywords would miss', async () => {
    const { directives, interpretedBy } = await interpretInstructions({
      instructions: 'I only care about beam deflection this week; make it tough and use bridge examples',
      learningObjectives,
      complete: modelReply({ onlyLearningObjectives: [3], difficulty: 'hard', otherGuidance: 'Use bridge examples.' })
    });
    expect(interpretedBy).toBe('model');
    expect(directives.loFocus).toEqual({ only: [2], emphasize: [], deemphasize: [] });
    expect(directives.difficulty).toBe('hard');
    expect(directives.otherGuidance).toBe('Use bridge examples.');
  });

  test('fills fields the model left empty from keywords', async () => {
    const { directives } = await interpretInstructions({
      instructions: 'make them all focused on LO3, and make them all hard',
      learningObjectives,
      complete: modelReply({})
    });
    expect(directives.loFocus.only).toEqual([2]);
    expect(directives.difficulty).toBe('hard');
  });

  test('falls back to keywords when the model call fails', async () => {
    const { directives, interpretedBy } = await interpretInstructions({
      instructions: 'make them all focused on LO3, and make them all hard',
      learningObjectives,
      complete: async () => { throw new Error('model unavailable'); }
    });
    expect(interpretedBy).toBe('keywords');
    expect(directives.loFocus.only).toEqual([2]);
    expect(directives.difficulty).toBe('hard');
  });

  test('returns empty directives without instructions', async () => {
    const complete = async () => { throw new Error('should not be called'); };
    const { interpretedBy } = await interpretInstructions({ instructions: '', learningObjectives, complete });
    expect(interpretedBy).toBe('none');
  });
});

describe('parseInterpretation', () => {
  test('drops invalid LO numbers, types and difficulties', () => {
    const parsed = parseInterpretation(`Sure! ${JSON.stringify({
      onlyLearningObjectives: [9, 'LO 2'],
      onlyQuestionType: 'poem',
      includeQuestionTypes: ['matching', 'nonsense'],
      excludeQuestionTypes: ['true-false'],
      difficulty: 'brutal'
    })}`, 4);
    expect(parsed.loFocus.only).toEqual([1]);
    expect(parsed.types).toEqual({ only: null, include: ['matching'], exclude: ['true-false'] });
    expect(parsed.difficulty).toBeNull();
  });
});
