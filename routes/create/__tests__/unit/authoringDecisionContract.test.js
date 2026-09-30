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
});
