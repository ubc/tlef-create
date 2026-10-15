import { describe, expect, test } from '@jest/globals';
import {
  detectDifficulty,
  detectExcludedQuestionTypes,
  detectLearningObjectiveEmphasis,
  detectRequestedQuestionTypes,
  detectRequiredQuestionType,
  ensureRequestedTypes,
  summarizeInstructionOutcome
} from '../../services/instructorDirectives.js';

describe('detectRequiredQuestionType', () => {
  test.each([
    ['make them all multiple choice questions please', 'multiple-choice'],
    ['Only MCQs', 'multiple-choice'],
    ['Every question should be true/false.', 'true-false'],
    ['use only flashcards', 'flashcard'],
    ['All single choice set questions', 'single-choice-set'],
    ['just fill in the blank questions', 'cloze'],
    ['no multiple choice, make them all matching', 'matching']
  ])('detects "%s"', (instructions, expected) => {
    expect(detectRequiredQuestionType(instructions)).toBe(expected);
  });

  test.each([
    [''],
    [undefined],
    ['Focus on real-world engineering examples'],
    ['include some multiple choice questions'],
    ['all questions should be multiple choice or true/false'],
    ['avoid essays in all questions'],
    ['focus more on LO3, avoid true/false']
  ])('returns null for "%s"', instructions => {
    expect(detectRequiredQuestionType(instructions)).toBeNull();
  });
});

describe('detectExcludedQuestionTypes', () => {
  test.each([
    ['focus more on LO3, avoid true/false', ['true-false']],
    ['no essays and no flashcards', ['essay', 'flashcard']],
    ["don't use matching or ordering", ['matching', 'ordering']],
    ['make them all multiple choice', []],
    ['', []]
  ])('reads "%s"', (instructions, expected) => {
    expect(detectExcludedQuestionTypes(instructions).sort()).toEqual([...expected].sort());
  });
});

describe('detectLearningObjectiveEmphasis', () => {
  test.each([
    ['focus more on LO3, avoid true/false', 5, [2], []],
    ['Emphasize learning objective 2', 5, [1], []],
    ['more questions on LO 1, 4', 5, [0, 3], []],
    ['focus on LO3, less on LO1', 5, [2], [0]],
    ['fewer questions for objective 2', 5, [], [1]],
    ['focus more on LO9', 5, [], []],
    ['Use real-world examples', 5, [], []]
  ])('reads "%s"', (instructions, count, emphasize, deemphasize) => {
    expect(detectLearningObjectiveEmphasis(instructions, count)).toEqual({ only: [], emphasize, deemphasize });
  });

  test.each([
    ['make them all focused on LO3, and make them all hard', [2]],
    ['only LO 2 please', [1]],
    ['every question should be about learning objective 1 or 4', [0, 3]]
  ])('reads exclusive focus in "%s"', (instructions, only) => {
    expect(detectLearningObjectiveEmphasis(instructions, 5)).toEqual({ only, emphasize: [], deemphasize: [] });
  });
});

describe('detectDifficulty', () => {
  test.each([
    ['make them all focused on LO3, and make them all hard', 'hard'],
    ['make the questions harder', 'hard'],
    ['keep everything easy', 'easy'],
    ['all moderate difficulty', 'moderate'],
    ['not too hard please', null],
    ['some easy and some hard', null],
    ['focus more on LO3', null]
  ])('reads "%s"', (instructions, expected) => {
    expect(detectDifficulty(instructions)).toBe(expected);
  });
});

describe('detectRequestedQuestionTypes', () => {
  test('reads types to include and ignores excluded ones', () => {
    expect(detectRequestedQuestionTypes('include more matching questions, avoid true/false')).toEqual(['matching']);
  });
});

describe('ensureRequestedTypes', () => {
  const plan = [
    { type: 'flashcard', learningObjectiveIndex: 0, count: 2 },
    { type: 'flashcard', learningObjectiveIndex: 1, count: 2 },
    { type: 'summary', learningObjectiveIndex: 2, count: 1 },
    { type: 'flashcard', learningObjectiveIndex: 2, count: 1 }
  ];
  const share = (items, types) => items
    .filter(item => types.includes(item.type))
    .reduce((sum, item) => sum + item.count, 0);

  test('converts rows until requested types cover half the questions', () => {
    const result = ensureRequestedTypes(plan, ['matching']);
    expect(share(result, ['matching'])).toBeGreaterThanOrEqual(3);
    expect(result.map(item => item.count)).toEqual(plan.map(item => item.count));
  });

  test('gives every requested type a row', () => {
    const result = ensureRequestedTypes(plan, ['matching', 'ordering']);
    expect(result.some(item => item.type === 'matching')).toBe(true);
    expect(result.some(item => item.type === 'ordering')).toBe(true);
  });

  test('leaves a compliant plan alone', () => {
    expect(ensureRequestedTypes(plan, ['flashcard'])).toEqual(plan);
  });
});

describe('summarizeInstructionOutcome', () => {
  test('reports LO emphasis and exclusions with real counts', () => {
    const outcome = summarizeInstructionOutcome({
      instructions: 'focus more on LO3, avoid true/false',
      planItems: [
        { type: 'flashcard', learningObjectiveIndex: 0, count: 1 },
        { type: 'flashcard', learningObjectiveIndex: 1, count: 2 },
        { type: 'summary', learningObjectiveIndex: 2, count: 4 }
      ],
      requiredType: null,
      requestedTypes: [],
      excludedTypes: ['true-false'],
      emphasis: { only: [], emphasize: [2], deemphasize: [] }
    });
    expect(outcome.applied).toEqual([
      'No true/false questions.',
      'LO 3 emphasized: 4 of 7 questions.'
    ]);
    expect(outcome.passedToQuestions).toBe(true);
  });

  test('returns null without instructions', () => {
    expect(summarizeInstructionOutcome({ instructions: '', planItems: [], requestedTypes: [], excludedTypes: [], emphasis: { only: [], emphasize: [], deemphasize: [] } })).toBeNull();
  });
});

test('summarizeInstructionOutcome reports exclusive LO focus and difficulty', () => {
  const outcome = summarizeInstructionOutcome({
    instructions: 'make them all focused on LO3, and make them all hard',
    planItems: [{ type: 'flashcard', learningObjectiveIndex: 2, count: 7, difficulty: 'hard' }],
    requiredType: null,
    requestedTypes: [],
    excludedTypes: [],
    emphasis: { only: [2], emphasize: [], deemphasize: [] },
    difficulty: 'hard',
    otherGuidance: ''
  });
  expect(outcome.applied).toEqual([
    'Every question covers LO 3.',
    'All 7 questions are hard.'
  ]);
});
