import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import { createAuthoringAgentTools } from '../../services/authoring/authoringAgentTools.js';

const owner = '111111111111111111111111';
const course = '222222222222222222222222';
const chosen = '333333333333333333333333';
const other = '444444444444444444444444';
const hidden = '555555555555555555555555';
const matches = (record, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === '$and') return value.every(clause => matches(record, clause));
  if (key === '$or') return value.some(clause => matches(record, clause));
  if (value?.$in) return value.$in.some(id => String(id) === String(record[key]));
  return String(record[key]) === String(value);
});
const query = (rows, filter, one = false) => {
  let found = rows.filter(row => matches(row, filter));
  const chain = { sort: () => chain, select: () => chain,
    skip: offset => { found = found.slice(offset); return chain; },
    limit: length => { found = found.slice(0, length); return chain; },
    lean: async () => one ? found[0] || null : found };
  return chain;
};
const session = extra => ({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', owner, courseId: course,
  materialIds: [chosen], objectiveIds: [], contextCourse: false, ...extra });
const sources = [
  { _id: chosen, folder: course, uploadedBy: owner, name: 'Selected mechanics', content: 'Newton force '.repeat(1200), processingStatus: 'completed' },
  { _id: other, folder: course, uploadedBy: owner, name: 'Other mechanics', content: 'Newton gravity context', processingStatus: 'completed' },
  { _id: hidden, folder: course, uploadedBy: '999999999999999999999999', name: 'Private', content: 'PRIVATE Newton source', processingStatus: 'completed' }
];
beforeEach(() => {
  jest.spyOn(Folder, 'exists').mockResolvedValue(true);
  jest.spyOn(Material, 'find').mockImplementation(filter => query(sources, filter));
  jest.spyOn(Material, 'findOne').mockImplementation(filter => query(sources, filter, true));
});
afterEach(() => jest.restoreAllMocks());

test('material reads and lexical search cannot expand selected-only scope', async () => {
  const tools = createAuthoringAgentTools({ session: session(), userId: owner });
  expect((await tools.execute('list_materials')).materials.map(row => row.id)).toEqual([chosen]);
  await expect(tools.execute('read_material', { materialId: other })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
  await expect(tools.execute('read_material', { materialId: hidden })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
  const search = await tools.execute('search_materials', { query: 'Newton' });
  expect(search.results.map(row => row.material.id)).toEqual([chosen]);
  expect(JSON.stringify(search)).not.toContain('PRIVATE');
});

test('course scope includes owned unselected sources but never another owner or course', async () => {
  sources.push({ _id: '666666666666666666666666', folder: '777777777777777777777777', uploadedBy: owner, content: 'Newton FOREIGN COURSE', processingStatus: 'completed' });
  try {
    const tools = createAuthoringAgentTools({ session: session({ contextCourse: true }), userId: owner });
    expect((await tools.execute('list_materials')).materials.map(row => row.id)).toEqual([chosen, other]);
    const result = await tools.execute('search_materials', { query: 'Newton' });
    expect(result.results.map(row => row.material.id)).toEqual([chosen, other]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|FOREIGN COURSE/);
    expect(await tools.execute('select_materials', { materialIds: [other] })).toMatchObject({ materialIds: [other] });
  } finally { sources.pop(); }
});

test('text pagination returns bounded contiguous ranges and material selection checks readiness', async () => {
  const tools = createAuthoringAgentTools({ session: session(), userId: owner });
  const first = await tools.execute('read_material', { materialId: chosen });
  const second = await tools.execute('read_material', { materialId: chosen, offset: first.nextOffset });
  expect(first.text).toHaveLength(6000);
  expect(second.text).toBe(sources[0].content.slice(6000, 12000));
  await expect(tools.execute('read_material', { materialId: chosen, length: 6001 })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
  await expect(tools.execute('select_materials', { materialIds: [other] })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
  sources[0].processingMetadata = { failedChunkIndices: [0] };
  try { await expect(tools.execute('select_materials', { materialIds: [chosen] })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' }); }
  finally { delete sources[0].processingMetadata; }
});

test('objective reads require a live owned course quiz membership and selected scope', async () => {
  const quiz = '777777777777777777777777';
  const valid = '888888888888888888888888';
  const unselected = '999999999999999999999999';
  jest.spyOn(Quiz, 'find').mockImplementation(filter => query([{ _id: quiz, folder: course, createdBy: owner, learningObjectives: [valid, unselected] }], filter));
  jest.spyOn(LearningObjective, 'find').mockImplementation(filter => query([
    { _id: valid, quiz, createdBy: owner, text: 'Apply Newton’s law.' },
    { _id: unselected, quiz, createdBy: owner, text: 'Compare gravitational forces.' },
    { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', quiz, createdBy: owner, text: 'Deleted quiz membership.' }
  ], filter));
  const narrow = createAuthoringAgentTools({ session: session({ objectiveIds: [valid] }), userId: owner });
  expect((await narrow.execute('read_objectives')).objectives.map(row => row.id)).toEqual([valid]);
  const broad = createAuthoringAgentTools({ session: session({ contextCourse: true }), userId: owner });
  expect((await broad.execute('read_objectives')).objectives.map(row => row.id)).toEqual([valid, unselected]);
});

test('objective selection stages only current owned course members and respects selected-only scope', async () => {
  const quiz = '777777777777777777777777'; const valid = '888888888888888888888888'; const unselected = '999999999999999999999999';
  const detached = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  jest.spyOn(Quiz, 'find').mockImplementation(filter => query([{ _id: quiz, folder: course, createdBy: owner, learningObjectives: [valid, unselected] }], filter));
  jest.spyOn(LearningObjective, 'find').mockImplementation(filter => query([
    { _id: valid, quiz, createdBy: owner, text: 'Apply Newton’s law.', updatedAt: new Date('2026-10-01T10:00:00Z') },
    { _id: unselected, quiz, createdBy: owner, text: 'Compare forces.', updatedAt: new Date('2026-10-01T10:00:00Z') },
    { _id: detached, quiz, createdBy: owner, text: 'Detached objective.' }
  ], filter));
  const narrow = createAuthoringAgentTools({ session: session({ objectiveIds: [valid] }), userId: owner });
  expect(await narrow.execute('select_objectives', { objectiveIds: [valid] })).toMatchObject({ objectiveIds: [valid],
    objectives: [{ id: valid, quizId: quiz, text: 'Apply Newton’s law.', sourceVersion: '2026-10-01T10:00:00.000Z' }] });
  await expect(narrow.execute('select_objectives', { objectiveIds: [unselected] })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
  const broad = createAuthoringAgentTools({ session: session({ contextCourse: true }), userId: owner });
  expect((await broad.execute('select_objectives', { objectiveIds: [unselected] })).objectiveIds).toEqual([unselected]);
  await expect(broad.execute('select_objectives', { objectiveIds: [detached] })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
  await expect(broad.execute('select_objectives', { objectiveIds: [valid, valid] })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
  await expect(broad.execute('select_objectives', { objectiveIds: Array.from({ length: 9 }, (_, index) => (index + 1).toString(16).padStart(24, '0')) })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
});

test('an existing plan blocks objective selection and named exclusions block reads and material selection', async () => {
  const existing = createAuthoringAgentTools({ session: session({ contextCourse: true }), userId: owner, canSelectMaterials: false });
  await expect(existing.execute('select_objectives', { objectiveIds: [] })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL', message: expect.stringContaining('already exists') });
  const tools = createAuthoringAgentTools({ session: session({ contextCourse: true }), userId: owner,
    latestRequest: 'Exclude Other mechanics, but use Selected mechanics.' });
  expect((await tools.execute('list_materials')).materials.map(row => row.id)).toEqual([chosen]);
  expect((await tools.execute('search_materials', { query: 'Newton' })).results.map(row => row.material.id)).toEqual([chosen]);
  await expect(tools.execute('read_material', { materialId: other })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL', message: expect.stringContaining('excluded') });
  await expect(tools.execute('select_materials', { materialIds: [other] })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL', message: expect.stringContaining('excluded') });
  expect((await tools.execute('select_materials', { materialIds: [chosen] })).materialIds).toEqual([chosen]);
});

test('course access and cancellation are checked afresh before every operation', async () => {
  const controller = new AbortController();
  const tools = createAuthoringAgentTools({ session: session(), userId: owner, signal: controller.signal });
  await tools.execute('check_requirements');
  Folder.exists.mockResolvedValue(false);
  await expect(tools.execute('list_materials')).rejects.toMatchObject({ code: 'AUTHORING_AGENT_SCOPE' });
  expect(Material.find).not.toHaveBeenCalled();
  controller.abort();
  await expect(tools.execute('check_requirements')).rejects.toMatchObject({ name: 'AbortError' });
});

test('an existing teaching plan cannot silently change its material selection', async () => {
  const tools = createAuthoringAgentTools({ session: session({ contextCourse: true }), userId: owner, canSelectMaterials: false });
  await expect(tools.execute('select_materials', { materialIds: [other] })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL', message: expect.stringContaining('already exists') });
  expect(Material.find).not.toHaveBeenCalled();
});

test('activity capability lookup distinguishes native libraries from course-question adapters', async () => {
  const tools = createAuthoringAgentTools({ session: session(), userId: owner });
  const questions = await tools.execute('list_activity_types', { representation: 'course-question', container: 'column' });
  expect(questions.types).toEqual(expect.arrayContaining([expect.objectContaining({
    representation: 'course-question', questionType: 'multiple-choice', available: true,
    contractSource: 'create-question-adapter'
  })]));
  const native = await tools.execute('list_activity_types', { representation: 'native-h5p', limit: 20 });
  expect(native.total).toBeGreaterThan(native.types.length);
  expect(native.nextOffset).toBe(20);
  expect(native.types.every(type => type.representation === 'native-h5p')).toBe(true);
  const next = await tools.execute('list_activity_types', { representation: 'native-h5p', offset: native.nextOffset });
  expect(next.types[0].library).not.toBe(native.types[0].library);
  await expect(tools.execute('list_activity_types', { representation: 'made-up' })).rejects.toMatchObject({ code: 'AUTHORING_AGENT_TOOL' });
});

const currentQuestions = objectiveIds => ({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', representation: 'course-linked', snapshot: {
  learningObjectives: objectiveIds.map((id, index) => ({ _id: id, text: `Learning objective ${index + 1}` })),
  questions: objectiveIds.map((learningObjective, index) => ({ _id: String(index + 1).padStart(24, '0'), learningObjective, type: 'true-false' })),
  settings: { planItems: [] }
} });
test.each([{ targetQuestionCount: 2 }, { scope: 'all', questionIndices: [], targetQuestionCount: 2 }])('quantity checks normalize safe empty selections and retain actual coverage diagnostics: %j', async args => {
  const current = currentQuestions([chosen, other, hidden]);
  const tools = createAuthoringAgentTools({ session: session({ teachingRequirements: { fields: { questionCount: { value: 2 } } } }), userId: owner,
    current, allowedQuestionTypes: ['true-false'] });
  expect(await tools.execute('check_question_revision', args)).toMatchObject({ ready: false,
    diagnostic: { code: 'QUESTION_COVERAGE_CONFLICT', targetQuestionCount: 2, minimumQuestionCount: 3 } });
});
test('malformed revision arguments are observations while missing scope never implies all questions', async () => {
  const tools = createAuthoringAgentTools({ session: session(), userId: owner, current: currentQuestions([chosen, other]), allowedQuestionTypes: ['true-false'] });
  expect(await tools.execute('check_question_revision', {})).toMatchObject({ ready: false,
    diagnostic: { code: 'QUESTION_REVISION_ARGUMENTS_INVALID', message: expect.stringContaining('explicit question indices') } });
  expect(await tools.execute('check_question_revision', { questionIndices: [99] })).toMatchObject({ ready: false,
    diagnostic: { code: 'QUESTION_REVISION_ARGUMENTS_INVALID' } });
  expect(await tools.execute('check_question_revision', { targetQuestionCount: 1, difficulty: 'easy' })).toMatchObject({ ready: false,
    diagnostic: { code: 'QUESTION_REVISION_ARGUMENTS_INVALID', message: expect.stringContaining('explicit question indices') } });
  expect(await tools.execute('check_question_revision', { scope: 'all', questionIndices: [], targetQuestionCount: 1, difficulty: 'easy' })).toMatchObject({ ready: false,
    diagnostic: { code: 'QUESTION_REVISION_ARGUMENTS_INVALID' } });
  expect(await tools.execute('check_question_revision', { targetQuestionCount: 2 })).toMatchObject({ ready: false,
    diagnostic: { code: 'QUESTION_REVISION_ARGUMENTS_INVALID', message: expect.stringContaining('quantity change') } });
});
