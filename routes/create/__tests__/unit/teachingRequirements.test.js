import { expect, test } from '@jest/globals';
import { readRequestedCount, updateTeachingRequirements, reconcileQuestionCount } from '../../services/authoring/teachingRequirements.js';

test.each(['Around 15 questions based on this material', 'Create fifteen questions.', '生成15道题', 'Question count: 15'])('extracts explicit count: %s', input => {
  expect(readRequestedCount(input)).toMatchObject({ value: 15 });
});
test.each(['Create 10–15 questions', 'Should we use 15 questions?', 'Create 25 questions', 'Create 5 questions or 10 questions'])('asks instead of silently choosing: %s', input => {
  expect(readRequestedCount(input).issue).toBeTruthy();
});
test('only current instructor quotes can supply interpreted fields; later count wins', () => {
  const first = updateTeachingRequirements(null, '15 questions for first-year physics', 'one', {
    audience: { value: 'First-year physics', quote: 'first-year physics' },
    exclusions: { value: 'No equations', quote: 'Do not use equations' },
    arbitrary: { value: 'ignored', quote: '15 questions' }
  });
  expect(first.fields.audience.value).toBe('First-year physics');
  expect(first.fields.exclusions).toBeUndefined();
  expect(first.fields.arbitrary).toBeUndefined();
  const next = updateTeachingRequirements(first, 'Use 8 questions instead of 15 questions', 'two');
  expect(next.fields.questionCount).toMatchObject({ value: 8, requestId: 'two' });
  expect(first.fields.questionCount.value).toBe(15);
  expect(next.fields.audience).toEqual(first.fields.audience);
});
test('reallocates a proposed eight-question plan to fifteen without dropping coverage or mutating it', () => {
  const plan = Array.from({ length: 8 }, (_, i) => ({ title: `Topic ${i}`, objectiveIds: [String(i)], count: 1 }));
  const corrected = reconcileQuestionCount(plan, updateTeachingRequirements(null, '15 questions', 'one'));
  expect(corrected.reduce((n, row) => n + row.count, 0)).toBe(15);
  expect(corrected.map(row => row.title)).toEqual(plan.map(row => row.title));
  expect(plan.every(row => row.count === 1)).toBe(true);
  expect(() => reconcileQuestionCount(plan, updateTeachingRequirements(null, '2 questions', 'one'))).toThrow(/merge plan rows/);
});

test.each(['Why did it generate 8 questions?', 'The failed batch had 8 questions.', '为什么只生成8道题？'])('does not turn a reported count into a new requirement: %s', input => {
  expect(readRequestedCount(input)).toBeNull();
});
