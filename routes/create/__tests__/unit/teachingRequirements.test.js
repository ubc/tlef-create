import { expect, test } from '@jest/globals';
import { readRequestedCount, updateTeachingRequirements, reconcileQuestionCount } from '../../services/authoring/teachingRequirements.js';

test.each(['Around 15 questions based on this material', 'Create fifteen questions.', '生成15道题', 'Question count: 15',
  'Build 15 easy questions.', 'Draft fifteen introductory multiple-choice questions.', 'Prepare 15 hard practice MCQs.', '生成15道简单选择题',
  '生成15道简单单选题', '生成15道多选题', 'Create fifteen easy single-choice questions.',
  '将总题数改为15道，仍然是简单选择题。', '题量调整为15', 'Change the question count to fifteen.', 'Set the number of questions to 15.'])('extracts explicit count: %s', input => {
  expect(readRequestedCount(input)).toMatchObject({ value: 15 });
});
test.each(['Create 10–15 questions', 'Build 10–15 easy questions', 'Should we use 15 questions?', 'Create 25 questions', 'Create 5 questions or 10 questions'])('asks instead of silently choosing: %s', input => {
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

test.each(['Do not create 15 questions; only discuss.', '不要生成15道题，先讨论教学方法。'])('does not save a refused question count: %s', input => {
  expect(readRequestedCount(input)).toBeNull();
});
test('retains a replacement count after a rejected generation count', () => {
  expect(readRequestedCount("Don't create 15 questions; create 3 questions instead.")).toMatchObject({ value: 3 });
});

test.each(['把第1题改为简单题，其他2题保留。', '重新生成第1题，保留其他2道题。',
  'Make question 1 easier and keep the other 2 questions.', 'Regenerate 1 question and keep the other 2 questions.',
  '修改2道题的反馈', 'Make 2 questions easier.', 'Remove question 2.', '删除第2题。'])('question references do not change total count: %s', input => {
  expect(readRequestedCount(input, 3)).toBeNull();
  const saved = updateTeachingRequirements(null, 'Create 3 questions.', 'initial');
  expect(updateTeachingRequirements(saved, input, 'revision').fields.questionCount.value).toBe(3);
});

test.each(['Add 2 questions.', 'Add two easy questions.', 'Generate 2 more questions.', '再加2题。', '增加2道简单选择题。'])('adds a relative count to the saved baseline: %s', input => {
  expect(readRequestedCount(input, 3)).toMatchObject({ value: 5, mode: 'delta', delta: 2, baseCount: 3 });
  const saved = updateTeachingRequirements(null, '3 questions', 'initial');
  const next = updateTeachingRequirements(saved, input, 'relative');
  expect(next.fields.questionCount).toMatchObject({ value: 5, source: 'instructor', requestId: 'relative', mode: 'delta' });
  expect(input).toContain(next.fields.questionCount.quote); expect(saved.fields.questionCount.value).toBe(3);
});
test.each(['Remove 2 questions.', 'Reduce by two questions.', '减少2道题。', '删除2题。'])('removes a quantity rather than a numbered question: %s', input => {
  expect(readRequestedCount(input, 3)).toMatchObject({ value: 1, mode: 'delta', delta: -2, baseCount: 3 });
});
test('relative edits are idempotent within a turn, including free checks, and apply again for a new human request', () => {
  const first = updateTeachingRequirements(updateTeachingRequirements(null, '3 questions', 'initial'), 'Add 2 questions.', 'relative');
  expect(updateTeachingRequirements(first, 'Add 2 questions.', 'relative').fields.questionCount.value).toBe(5);
  expect(updateTeachingRequirements(first, 'Add 2 questions.', 'agent-check').fields.questionCount.value).toBe(5);
  expect(updateTeachingRequirements(first, 'Add 2 questions.', 'second-relative').fields.questionCount).toMatchObject({ value: 7, baseCount: 5 });
});
test.each(['Do not add 2 questions.', '不要再加2题。', '之前增加2道题。', 'Why did you add 2 questions?', 'Create -2 questions.', 'Add -2 questions.'])('refused, historical and negative edits cannot authorize a new count: %s', input => {
  expect(readRequestedCount(input, 3)).toBeNull();
});
test.each(['Add 2 or 3 questions.', 'Add 2 questions and remove 1 question.', 'Should we add 2 questions?', 'Create 10-15 questions.'])('ambiguous changes require a count decision: %s', input => {
  expect(readRequestedCount(input, 3).issue).toBeTruthy();
});
test('relative counts need a valid current count and cannot exceed the activity bounds', () => {
  expect(readRequestedCount('Add 2 questions.').issue).toBeTruthy();
  expect(readRequestedCount('Add 2 questions.', 20).issue).toBeTruthy();
  expect(readRequestedCount('Remove 3 questions.', 3).issue).toBeTruthy();
});

test.each(['把总题数改为2道。', '把总题数减为2道。', '总题数减到2道题。', '题量减少为2。', '题数减少到2题。'])('labelled absolute reductions retain the explicit target: %s', input => {
  expect(readRequestedCount(input, 3)).toMatchObject({ mode: 'absolute', value: 2 });
});
test('the faculty count change updates only the explicit total and preserves the coverage constraints', () => {
  const input = '把总题数减为2道，其余要求保持。先检查是否仍能覆盖现有学习目标，不要擅自删除学习目标。';
  const previous = updateTeachingRequirements(null, 'Create 3 questions for first-year students.', 'initial', {
    audience: { value: 'First-year students', quote: 'first-year students' }
  });
  const next = updateTeachingRequirements(previous, input, 'faculty-reduction');
  expect(next.fields.questionCount).toMatchObject({ mode: 'absolute', value: 2, quote: '总题数减为2道', source: 'instructor', requestId: 'faculty-reduction' });
  expect(next.fields.audience).toEqual(previous.fields.audience);
  expect(previous.fields.questionCount.value).toBe(3);
  expect(next.countIssue).toBeUndefined();
});
test.each(['把第2道题改为简单题。', '重新生成第2道，其余保持。', '不要把总题数减为2道。',
  '不要将总题数减为2道题。', '之前把总题数减为2道。'])('ordinal, refused and historical labelled edits do not change total: %s', input => {
  expect(readRequestedCount(input, 3)).toBeNull();
});

test.each([['一', 1], ['两', 2], ['二', 2], ['三', 3], ['四', 4], ['五', 5], ['六', 6], ['七', 7], ['八', 8], ['九', 9],
  ['十', 10], ['十一', 11], ['十二', 12], ['十三', 13], ['十四', 14], ['十五', 15], ['十六', 16], ['十七', 17], ['十八', 18], ['十九', 19], ['二十', 20]])(
  'persists the original Chinese count wording %s as %i', (word, value) => {
    const input = `请生成${word}道选择题。`;
    const next = updateTeachingRequirements(null, input, 'chinese-count');
    expect(next.fields.questionCount).toMatchObject({ mode: 'absolute', value, quote: `${word}道选择题`, source: 'instructor' });
    expect(input).toContain(next.fields.questionCount.quote);
  });

test('the real faculty mixed-language request saves the total before approval and corrects the proposed allocation', () => {
  const input = '现在构建活动，总共1道 Fill in the Blank（填空题），只用已选择的材料。';
  const saved = updateTeachingRequirements(null, input, 'faculty-source-count');
  expect(saved.fields.questionCount).toMatchObject({ value: 1, quote: '1道 Fill in the Blank（填空题）', source: 'instructor' });
  const proposal = [{ title: 'Selected topic', objectiveIds: ['selected-objective'], count: 3, questionType: 'cloze' }];
  expect(reconcileQuestionCount(proposal, saved)).toEqual([{ ...proposal[0], count: 1 }]);
  expect(proposal[0].count).toBe(3);
});
test.each(['总共两道 Fill in the Blank（填空题）', '请生成2道 Multiple Choice（选择题）'])('accepts a mixed type label anchored by a Chinese question word: %s', input => {
  expect(readRequestedCount(input)).toMatchObject({ mode: 'absolute', value: 2 });
});
test.each(['总共15道 Crossword（填字题）', '生成十五道排序题', '总共十五道 Future Recall（课堂自测题）'])('new type labels need no parser registration: %s', input => {
  expect(updateTeachingRequirements(null, input, 'extensible-type').fields.questionCount).toMatchObject({ mode: 'absolute', value: 15 });
});
test('a type label cannot swallow another required quantity', () => {
  expect(readRequestedCount('生成十五道选择题和五道填空题').issue).toBeTruthy();
});
test.each(['总共1道 Fill in the Blank', '请生成两道 experiment records', '三章两道题', '第十五题', '已有十五题'])('a bare numeral, source count or unanchored English label does not authorize a total: %s', input => {
  expect(readRequestedCount(input, 15)).toBeNull();
});
test.each(['十五道选择题', '约十五道选择题', '大约十五道选择题。', '十五道选择题左右'])('accepts an explicit Chinese quantity-only brief: %s', input => {
  expect(readRequestedCount(input)).toMatchObject({ value: 15 });
});
test.each(['约十五道选择题', '大约十五道选择题。', '十五道选择题左右'])('marks an approximate Chinese count: %s', input => {
  expect(readRequestedCount(input)).toMatchObject({ value: 15, approximate: true });
});
test.each(['把总题数改为两道。', '总题数减到二道。', '题量调整为十五。', '减到两道题。'])('an explicit Chinese absolute target replaces the old total: %s', input => {
  const next = updateTeachingRequirements(updateTeachingRequirements(null, '生成二十道题', 'initial'), input, 'absolute-edit');
  expect(next.fields.questionCount).toMatchObject({ mode: 'absolute', value: input.includes('十五') ? 15 : 2 });
});

test.each(['不要生成十五题。', '把第十五题改为简单题。', '已有十五题，请生成讲解。',
  '把2道填空题改成选择题，其余保持。', '把两道 Fill in the Blank（填空题）改成选择题，其余保持。',
  '两道填空题改成选择题，其余保持。', '目前有2道题，把第1道改为简单题。', '两道题已经生成，把第十五道改为简单题。',
  'Do not generate a total of 2 questions.', '保留原有15道题，不要额外增加2道题。', '保留原有十五道题，不要额外增加两道题。'])('a subset edit, report or refusal preserves the saved fifteen-question requirement: %s', input => {
  const saved = updateTeachingRequirements(null, '生成十五道题', 'initial');
  expect(readRequestedCount(input, 15)).toBeNull();
  expect(updateTeachingRequirements(saved, input, 'content-edit').fields.questionCount).toEqual(saved.fields.questionCount);
});
test('relative Chinese edits retain their original quote and cannot apply twice in one request', () => {
  const initial = updateTeachingRequirements(null, '生成十五道题', 'initial');
  const input = '再增加两道题';
  const first = updateTeachingRequirements(initial, input, 'relative');
  expect(first.fields.questionCount).toMatchObject({ mode: 'delta', value: 17, delta: 2, baseCount: 15, quote: input });
  const checked = updateTeachingRequirements(first, input, 'agent-check');
  expect(checked.fields.questionCount.value).toBe(17);
  expect(updateTeachingRequirements(checked, input, 'relative').fields.questionCount.value).toBe(17);
  expect(updateTeachingRequirements(first, input, 'new-human-request').fields.questionCount).toMatchObject({ value: 19, baseCount: 17 });
  expect(initial.fields.questionCount.value).toBe(15);
});
test.each(['再生成两道题', '再增加两题', '新增两道 Fill in the Blank（填空题）'])('an additional Chinese quantity uses the saved baseline: %s', input => {
  expect(readRequestedCount(input, 15)).toMatchObject({ mode: 'delta', value: 17, delta: 2, baseCount: 15 });
  expect(readRequestedCount(input).issue).toBeTruthy();
});
test.each(['再生成第十五题', '不要再生成两道题', '不要再增加两道题'])('a numbered regeneration or refused additional quantity does not change total: %s', input => {
  expect(readRequestedCount(input, 15)).toBeNull();
});
test.each(['生成十二至十五道题', '生成一至两道 Fill in the Blank（填空题）', '生成十到十五题', '生成十五或二十题',
  '生成二十一道题', '生成一百道题'])('ambiguous or unsupported Chinese quantities require clarification: %s', input => {
  expect(readRequestedCount(input, 15).issue).toBeTruthy();
});

test.each(['Generate a 15-question set from the selected notes.', 'Create a fifteen-question collection.', 'Prepare a 15‐question set.',
  'Build a fifteen‑question set.', '15-question collection', 'About fifteen-question set'])('a hyphenated English quantity preserves its original instructor quote: %s', input => {
  const saved = updateTeachingRequirements(null, input, 'hyphen-count');
  expect(saved.fields.questionCount).toMatchObject({ mode: 'absolute', value: 15, source: 'instructor', requestId: 'hyphen-count' });
  expect(input).toContain(saved.fields.questionCount.quote);
  expect(saved.fields.questionCount.quote).toMatch(/(?:15|fifteen)[-‐‑]question/);
});

test.each(['Do not generate a 15-question set.', 'Never create a fifteen-question collection.', 'We already have a 2-question set; generate feedback only.',
  'We generated a two-question collection; generate explanations only.', 'A 2-question set was already generated; generate feedback only.',
  'Keep the existing two-question collection and update its feedback.', 'Generate a 15-minute lesson.', 'Create -2-question set.'])('refused or reported hyphenated quantities do not replace a saved target: %s', input => {
  const saved = updateTeachingRequirements(null, 'Create 15 questions.', 'initial');
  expect(readRequestedCount(input, 15)).toBeNull();
  expect(updateTeachingRequirements(saved, input, 'revision').fields.questionCount).toEqual(saved.fields.questionCount);
});

test.each(['Generate a 10–15-question set.', 'Create a ten-to-fifteen-question collection.', 'Generate a 10-15-question set.',
  'Create a 2-question set and a 3-question collection.'])('ranges and conflicting hyphenated quantities require clarification: %s', input => {
  expect(readRequestedCount(input, 15).issue).toBeTruthy();
});

test('hyphenated relative edits use the original baseline and retain request idempotence', () => {
  const initial = updateTeachingRequirements(null, 'Create a fifteen-question collection.', 'initial');
  const input = 'Add a two-question set.';
  const added = updateTeachingRequirements(initial, input, 'relative');
  expect(added.fields.questionCount).toMatchObject({ mode: 'delta', value: 17, delta: 2, baseCount: 15, quote: 'Add a two-question' });
  expect(updateTeachingRequirements(added, input, 'relative').fields.questionCount.value).toBe(17);
  expect(updateTeachingRequirements(added, input, 'agent-check').fields.questionCount.value).toBe(17);
  expect(updateTeachingRequirements(added, input, 'new-request').fields.questionCount.value).toBe(19);
  expect(readRequestedCount(input).issue).toBeTruthy();
  expect(readRequestedCount('Remove a two-question collection.', 15)).toMatchObject({ mode: 'delta', value: 13, delta: -2 });
  expect(readRequestedCount('Do not add a two-question set.', 15)).toBeNull();
});
