import { describe, expect, test } from '@jest/globals';
import { parseDecision } from '../../services/authoring/authoringContracts.js';

const reply = { action: 'reply', reply: 'Which question count should I use?', clarification: [{ question: 'How many questions?', options: ['One', 'Five'] }] };
describe('selectable authoring clarification contract', () => {
  test('retains bounded choices and normalizes whitespace while dropping unknown metadata', () => {
    const result = parseDecision({ ...reply, clarification: [{ question: ' How many? ', options: [' One ', ' Five '], url: 'https://invalid.example' }] }, 0);
    expect(result.clarification).toEqual([{ question: 'How many?', options: ['One', 'Five'] }]);
  });
  test('accepts historical text-only replies', () => {
    expect(parseDecision({ action: 'reply', reply: 'What should change?' }, 0).clarification).toEqual([]);
  });
  test.each([
    [{ question: 'Count?', options: ['One'] }],
    [{ question: 'Count?', options: ['One', 'One'] }],
    [{ question: 'Count?', options: ['One', ' One '] }],
    [{ question: 'Count?', options: ['1', '2', '3', '4', '5'] }],
    [{ question: 'x'.repeat(301), options: ['One', 'Five'] }],
    [{ question: 'Count?', options: ['x'.repeat(181), 'Five'] }],
    [{ question: 'Count?', options: [null, 'Five'] }],
    [null],
    Array.from({ length: 4 }, () => ({ question: 'Count?', options: ['One', 'Five'] }))
  ].map(clarification => [clarification]))('rejects malformed choices before a message is saved: %j', clarification => {
    expect(() => parseDecision({ ...reply, clarification }, 0)).toThrow(expect.objectContaining({ code: 'AUTHORING_RESPONSE' }));
  });
  test('never admits a revision action together with unanswered choices', () => {
    expect(() => parseDecision({ ...reply, action: 'revise_plan' }, 0)).toThrow(expect.objectContaining({ code: 'AUTHORING_RESPONSE' }));
  });
  test('retains explicit supported type, difficulty and answer-mode changes', () => {
    expect(parseDecision({ action: 'revise_question', reply: 'Change question 2.', questionIndex: 2,
      questionType: 'multiple-choice', difficulty: 'hard', selectionMode: 'multiple' }, 3))
      .toMatchObject({ questionType: 'multiple-choice', difficulty: 'hard', selectionMode: 'multiple' });
  });
  test('omits unchanged revision properties for historical decisions', () => {
    const decision = parseDecision({ action: 'revise_question', reply: 'Simplify the wording.', questionIndex: 1 }, 2);
    expect(decision).not.toHaveProperty('questionType');
    expect(decision).not.toHaveProperty('difficulty');
    expect(decision).not.toHaveProperty('selectionMode');
  });
  test.each([
    { questionType: 'invented-type' }, { questionType: 'question-set' },
    { difficulty: 'expert' }, { selectionMode: 'all' },
    { questionType: 'true-false', selectionMode: 'multiple' }
  ])('refuses unsupported revision properties: %j', changes => {
    expect(() => parseDecision({ action: 'revise_question', reply: 'Change it.', questionIndex: 1, ...changes }, 2))
      .toThrow(expect.objectContaining({ code: 'AUTHORING_RESPONSE' }));
  });
  test('refuses a type that is absent from the deployed runtime before dispatch', () => {
    expect(() => parseDecision({ action: 'revise_question', reply: 'Change it.', questionIndex: 1, questionType: 'true-false' }, 2, ['multiple-choice']))
      .toThrow(expect.objectContaining({ code: 'AUTHORING_RESPONSE' }));
  });
});
