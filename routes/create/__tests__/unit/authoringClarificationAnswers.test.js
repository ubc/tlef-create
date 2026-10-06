import { canonicalClarificationAnswers } from '../../services/authoring/authoringClarificationAnswers.js';

const id = '507f1f77bcf86cd799439011';
const card = { _id: id, role: 'assistant', clarification: [
  { question: 'Which topics?', options: ['Motion', 'Forces'], selectionMode: 'multiple', allowCustomInput: true },
  { question: 'How many questions?', options: ['5 questions', '15 questions'], selectionMode: 'single' }
] };
const payload = () => ({ messageId: id, answers: [
  { questionIndex: 0, selectedOptions: ['Forces', 'Motion'], customAnswer: 'Energy' },
  { questionIndex: 1, selectedOptions: ['15 questions'] }
] });

test('uses only saved questions/options and preserves canonical group/option order', () => {
  const result = canonicalClarificationAnswers(card, payload());
  expect(result.text).toBe('Apply these answers to the current task, keeping the other confirmed requirements:\nWhich topics? Motion; Forces; Energy\nHow many questions? 15 questions');
  expect(result.clarificationAnswers.answers[0].selectedOptions).toEqual(['Motion', 'Forces']);
});
test.each([
  value => { value.messageId = '507f1f77bcf86cd799439012'; },
  value => { value.answers.pop(); },
  value => { value.answers[1].questionIndex = 0; },
  value => { value.answers[0].selectedOptions = ['Another course']; },
  value => { value.answers[0].selectedOptions = ['Motion', 'Motion']; },
  value => { value.answers[1].selectedOptions = ['5 questions', '15 questions']; },
  value => { value.answers[1].customAnswer = '12'; },
  value => { value.answers[0].customAnswer = ' '; },
  value => { value.answers[0].customAnswer = 'x'.repeat(501); },
  value => { value.answers[0] = { questionIndex: 0, selectedOptions: [] }; }
])('rejects incomplete, substituted or contradictory confirmation', change => {
  const value = payload(); change(value);
  expect(() => canonicalClarificationAnswers(card, value)).toThrow();
});
test('strict decisions cannot accept custom answers', () => {
  const strict = structuredClone(card); strict.clarification[0].allowCustomInput = false;
  expect(() => canonicalClarificationAnswers(strict, payload())).toThrow('offered by the current clarification card');
});
