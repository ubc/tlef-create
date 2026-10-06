import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import { AuthoringRun, AuthoringSession } from '../../models/StudioAuthoring.js';
import { authorizesAgentBuild, buildAgentPrompt, runAuthoringAgent, canResumeAuthoringAgent } from '../../services/authoring/authoringAgent.js';
import { digest } from '../../services/authoring/authoringContracts.js';
import { authoringScopeHash, mergeAuthoringTaskContext } from '../../services/authoring/authoringTaskContext.js';
import { getStudioCatalog } from '../../services/h5pStudioCatalog.js';

const owner = '111111111111111111111111';
const session = { _id: '222222222222222222222222', owner, courseId: '333333333333333333333333', mode: 'explore',
  instructions: 'Help me think about teaching mechanics.', materialIds: [], objectiveIds: [], contextCourse: true };
const request = (latestRequest = 'How should I teach Newton’s laws?', extra = {}) => ({ session: { ...session },
  run: { _id: '444444444444444444444444', sessionId: session._id, owner, leaseToken: 'test-lease' },
  latestRequest, userId: owner, guard: jest.fn(async () => {}), checkpoint: jest.fn(async () => {}), ...extra });
const savedState = (options, fields) => ({ version: 1, inputHash: digest({ sessionId: options.session._id, latestRequest: options.latestRequest, requestId: options.run.input?.requestId || options.run.requestId }),
  step: 1, observations: [], requirements: {}, ...fields });
const response = result => ({ content: JSON.stringify(result) });
const revisionCurrent = () => ({ _id: '777777777777777777777777', representation: 'course-linked', snapshot: {
  learningObjectives: [{ _id: '555555555555555555555555', text: 'Explain force.' },
    { _id: '666666666666666666666666', text: 'Explain energy.' }],
  questions: [{ _id: '888888888888888888888888', learningObjective: '555555555555555555555555', type: 'multiple-choice' },
    { _id: '999999999999999999999999', learningObjective: '666666666666666666666666', type: 'multiple-choice' }],
  settings: { planItems: [] }
} });
beforeEach(() => {
  jest.spyOn(AuthoringRun, 'updateOne').mockResolvedValue({ matchedCount: 1 });
  jest.spyOn(AuthoringSession, 'updateOne').mockResolvedValue({ matchedCount: 1 });
  jest.spyOn(Folder, 'exists').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

test('tools feed actual results into the next model decision and final results replay without buying another call', async () => {
  const options = request();
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'check_requirements', arguments: {} }))
    .mockResolvedValueOnce(response({ action: 'reply', reply: 'Start with a predict–observe–explain demonstration.', clarification: [] }));
  const result = await runAuthoringAgent(options);
  expect(result).toMatchObject({ action: 'reply', clarification: [] });
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1][0].prompt).toContain('Checked 0 saved teaching requirements');
  expect(options.run.agentState.phase).toBe('completed');
  expect(await runAuthoringAgent(options)).toEqual(result);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(AuthoringRun.updateOne.mock.calls.every(([filter]) => filter.owner === owner && filter.sessionId === session._id && filter.leaseToken === 'test-lease')).toBe(true);
});

test('a saved free tool step resumes; an uncertain paid step never automatically replays', async () => {
  const options = request();
  options.run.agentState = savedState(options, { phase: 'tool_pending', pendingTool: { name: 'check_requirements', arguments: {} } });
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'reply', reply: 'Let’s compare two demonstrations.', clarification: [] }));
  await runAuthoringAgent(options);
  expect(complete).toHaveBeenCalledTimes(1);
  const uncertain = request();
  uncertain.run.agentState = savedState(uncertain, { phase: 'model_pending' });
  await expect(runAuthoringAgent(uncertain)).rejects.toMatchObject({ code: 'AUTHORING_AGENT_INTERRUPTED' });
  expect(complete).toHaveBeenCalledTimes(1);
});

test('a saved model output is parsed on recovery with no second paid decision', async () => {
  const options = request();
  options.run.agentState = savedState(options, { phase: 'model_saved', rawResponse: JSON.stringify({ action: 'reply', reply: 'Saved teaching advice.', clarification: [] }) });
  const complete = jest.spyOn(llmService, 'streamCompletion');
  expect(await runAuthoringAgent(options)).toMatchObject({ reply: 'Saved teaching advice.' });
  expect(complete).not.toHaveBeenCalled();
});

test('a paid response returned after stopping is saved and parsed on explicit recovery', async () => {
  const controller = new AbortController();
  const options = request('Discuss a teaching example.', { signal: controller.signal });
  const complete = jest.spyOn(llmService, 'streamCompletion').mockImplementation(async () => {
    controller.abort(new Error('Teacher stopped the task.'));
    return response({ action: 'reply', reply: 'Use a cart demonstration.', clarification: [] });
  });
  await expect(runAuthoringAgent(options)).rejects.toThrow('Teacher stopped');
  expect(options.run.agentState).toMatchObject({ phase: 'model_saved', rawResponse: expect.stringContaining('cart demonstration') });
  expect(canResumeAuthoringAgent(options.run)).toBe(true);
  expect(await runAuthoringAgent({ ...options, signal: new AbortController().signal })).toMatchObject({ reply: 'Use a cart demonstration.' });
  expect(complete).toHaveBeenCalledTimes(1);
});

test('explicit recovery preserves known valid receipts and resets unreadable or uncertain decisions', () => {
  for (const phase of ['completed', 'model_saved', 'tool_pending', 'ready']) {
    expect(canResumeAuthoringAgent({ agentState: { phase } })).toBe(true);
  }
  for (const phase of ['model_pending', 'budget_exhausted']) {
    expect(canResumeAuthoringAgent({ agentState: { phase } })).toBe(false);
  }
  expect(canResumeAuthoringAgent({ agentState: { phase: 'model_saved' }, errorCode: 'AUTHORING_RESPONSE' })).toBe(false);
  expect(canResumeAuthoringAgent({ agentState: { phase: 'tool_pending' }, errorCode: 'AUTHORING_RESPONSE' })).toBe(true);
});

test('exploration cannot silently build even when a model proposes it; explicit build needs checked requirements', async () => {
  const options = request();
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'build_plan', reply: 'I’ll prepare a plan.', clarification: [] }));
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
  expect(complete).toHaveBeenCalledTimes(1);
  const build = request('按这个方向出题，生成15道题。');
  complete.mockResolvedValueOnce(response({ action: 'tool', tool: 'check_requirements', arguments: {} }))
    .mockResolvedValueOnce(response({ action: 'build_plan', reply: '我会提出15道题的教学计划。', clarification: [] }));
  expect(await runAuthoringAgent(build)).toMatchObject({ action: 'build_plan' });
  expect(build.run.agentState.observations[0].result.fields.questionCount).toBe(15);
});

test('invalid paid output stays saved and a revoked execution cannot start a model call', async () => {
  const options = request();
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: 'unreadable output' });
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
  expect(options.run.agentState).toMatchObject({ phase: 'model_saved', rawResponse: 'unreadable output' });
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
  expect(complete).toHaveBeenCalledTimes(1);
  AuthoringRun.updateOne.mockResolvedValue({ matchedCount: 0 });
  await expect(runAuthoringAgent(request())).rejects.toMatchObject({ code: 'AUTHORING_AGENT_STATE' });
  expect(complete).toHaveBeenCalledTimes(1);
});

test('a clear build automatically performs an omitted free requirement check without another model decision', async () => {
  const options = request('Create 3 easy questions.');
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'build_plan', reply: 'Prepare a reviewable plan.', clarification: [] }));
  const result = await runAuthoringAgent(options);
  expect(result.action).toBe('build_plan');
  expect(options.run.agentState.observations).toEqual([expect.objectContaining({ tool: 'check_requirements', result: expect.objectContaining({ fields: expect.objectContaining({ questionCount: 3 }) }) })]);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(await runAuthoringAgent(options)).toEqual(result);
  expect(complete).toHaveBeenCalledTimes(1);
});

test('an explicit native request checks installed capabilities and stages a plan without generating content', async () => {
  const library = getStudioCatalog().types.find(type => type.machineName === 'H5P.Chart' && type.mode === 'generate').library;
  const options = request('Create a Chart for these teaching facts.');
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'list_activity_types', arguments: {} }))
    .mockResolvedValueOnce(response({ action: 'build_native_plan', library, reply: 'Review a Chart proposal.', clarification: [] }));
  expect(await runAuthoringAgent(options)).toMatchObject({ action: 'build_native_plan', library });
  expect(options.run.agentState.observations.map(item => item.tool)).toEqual(['list_activity_types', 'check_requirements']);
  expect(complete).toHaveBeenCalledTimes(2);
});

test('a native build cannot bypass the actual capability lookup', async () => {
  const options = request('Create a Chart for these teaching facts.');
  jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'build_native_plan', library: 'H5P.Chart 1.2', reply: 'Create a Chart.', clarification: [] }));
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
});

test('an automatic requirement check still prevents a conflicting count from reaching planning', async () => {
  const options = request('Create 3 questions or 5 questions.');
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'build_plan', reply: 'Prepare a plan.', clarification: [] }));
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
  expect(options.run.agentState.observations[0].result.countIssue).toBeTruthy();
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
  expect(complete).toHaveBeenCalledTimes(1);
});

test('the decision budget ends a tool loop without an unbounded bill or automatic planning', async () => {
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'tool', tool: 'check_requirements', arguments: {} }));
  const options = request();
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_AGENT_BUDGET' });
  expect(options.run.agentState.phase).toBe('budget_exhausted');
  expect(complete).toHaveBeenCalledTimes(32);
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_AGENT_BUDGET' });
  expect(complete).toHaveBeenCalledTimes(32);
});

test('only authorized material selections reach the final decision', async () => {
  const materialId = '555555555555555555555555';
  const options = request('Build a short quiz from the relevant course material.');
  jest.spyOn(Material, 'find').mockReturnValue({ select: () => ({ lean: async () => [{ _id: materialId, processingStatus: 'completed' }] }) });
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'select_materials', arguments: { materialIds: [materialId] } }))
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'check_requirements', arguments: {} }))
    .mockResolvedValueOnce(response({ action: 'build_plan', reply: 'Prepare a plan from the selected evidence.', clarification: [] }));
  expect(await runAuthoringAgent(options)).toMatchObject({ action: 'build_plan', materialIds: [materialId] });
  expect(complete).toHaveBeenCalledTimes(3);
});

test('requirements extracted this turn are visible to the next tool and model while unquoted claims are discarded', async () => {
  const options = request('Create 5 questions at easy difficulty for first-year physics students.');
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'check_requirements', arguments: {}, requirements: {
      audience: { value: 'First-year physics', quote: 'first-year physics students' },
      difficulty: { value: 'easy', quote: 'easy' },
      exclusions: { value: 'No calculation', quote: 'Do not calculate anything' }
    } }))
    .mockResolvedValueOnce(response({ action: 'build_plan', reply: 'Prepare the requested teaching plan.', clarification: [] }));
  const result = await runAuthoringAgent(options);
  expect(result.requirements).toEqual({ audience: { value: 'First-year physics', quote: 'first-year physics students' }, difficulty: { value: 'easy', quote: 'easy' } });
  expect(options.run.agentState.observations[0].result.fields).toMatchObject({ audience: 'First-year physics', difficulty: 'easy', questionCount: 5 });
  expect(complete.mock.calls[1][0].prompt).toContain('SAVED TEACHING REQUIREMENTS');
});

test('a rejected selection is an observed tool failure, never a returned material change', async () => {
  const options = request('Use another material to improve this question.', {
    current: { representation: 'course-linked', snapshot: { questions: [{ questionText: 'What is net force?' }] } }
  });
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'select_materials', arguments: { materialIds: ['555555555555555555555555'] } }))
    .mockResolvedValueOnce(response({ action: 'reply', reply: 'Start a new conversation to change the source materials.', clarification: [] }));
  const result = await runAuthoringAgent(options);
  expect(result.materialIds).toBeUndefined();
  expect(options.run.agentState.observations[0].result.error).toBe(true);
  expect(complete.mock.calls[1][0].prompt).toContain('selection cannot change');
});

test('a follow-up receives saved real source observations after fresh source checks without repeating reads or inheriting requirements', async () => {
  const materialId = '555555555555555555555555';
  const material = { _id: materialId, name: 'Mechanics notes', folder: session.courseId, uploadedBy: owner,
    content: 'Newton force source detail. '.repeat(500), processingStatus: 'completed', updatedAt: new Date('2026-10-01T10:00:00Z') };
  jest.spyOn(Material, 'findOne').mockReturnValue({ select: () => ({ lean: async () => material }) });
  jest.spyOn(Material, 'find').mockReturnValue({ select: () => ({ lean: async () => [material] }) });
  const first = request('Read the mechanics source and discuss teaching choices.', { session: { ...session, materialIds: [materialId] } });
  first.run.input = { requestId: 'source-reading-request' };
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'read_material', arguments: { materialId },
      requirements: { audience: { value: 'Invented students', quote: 'Newton force source detail.' } } }))
    .mockResolvedValueOnce(response({ action: 'reply', reply: 'Compare a demonstration and a calculation.', clarification: [] }))
    .mockResolvedValueOnce(response({ action: 'reply', reply: 'Use the demonstration as a prediction exercise.', clarification: [] }));
  await runAuthoringAgent(first);
  expect(first.session.taskContext.observations[0].provenance[0]).toMatchObject({ id: materialId, start: 0, end: 6000 });
  const followup = request('How would the demonstration work?', { session: { ...first.session } });
  followup.run._id = '666666666666666666666666'; followup.run.input = { requestId: 'source-followup-request' };
  await runAuthoringAgent(followup);
  expect(complete.mock.calls[2][0].prompt).toContain('PAST VERIFIED TOOL RESULTS');
  expect(complete.mock.calls[2][0].prompt).toContain('Newton force source detail.');
  expect(Material.findOne).toHaveBeenCalledTimes(1);
  expect(Material.find).toHaveBeenCalledTimes(1);
  expect(followup.run.agentState.observations).toEqual([]);
  expect(followup.session.teachingRequirements.fields).not.toHaveProperty('audience');
});

test('only an authorized objective selection tool can supply objective IDs to an initial plan', async () => {
  const quizId = '555555555555555555555555'; const objectiveId = '666666666666666666666666';
  jest.spyOn(Quiz, 'find').mockReturnValue({ select: () => ({ lean: async () => [{ _id: quizId, learningObjectives: [objectiveId] }] }) });
  jest.spyOn(LearningObjective, 'find').mockReturnValue({ select: () => ({ lean: async () => [{ _id: objectiveId, quiz: quizId, text: 'Explain Newton’s law.', updatedAt: new Date('2026-10-01T10:00:00Z') }] }) });
  const options = request('Create 3 questions using a relevant saved objective.');
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'select_objectives', arguments: { objectiveIds: [objectiveId] } }))
    .mockResolvedValueOnce(response({ action: 'build_plan', reply: 'Propose three questions.', clarification: [], objectiveIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'] }));
  const result = await runAuthoringAgent(options);
  expect(result.objectiveIds).toEqual([objectiveId]); expect(result.action).toBe('build_plan');
  expect(options.session.taskContext.selectedObjectiveIds).toEqual([objectiveId]);
  expect(complete).toHaveBeenCalledTimes(2);
});

test('an infeasible batch count becomes an actual free observation and a clarification rather than a failed task or paid generation', async () => {
  const firstObjective = '555555555555555555555555'; const secondObjective = '666666666666666666666666';
  const current = { _id: '777777777777777777777777', representation: 'course-linked', snapshot: {
    learningObjectives: [{ _id: firstObjective, text: 'Explain force.' }, { _id: secondObjective, text: 'Explain energy.' }],
    questions: [{ _id: '888888888888888888888888', learningObjective: firstObjective, type: 'multiple-choice' },
      { _id: '999999999999999999999999', learningObjective: secondObjective, type: 'multiple-choice' }], settings: { planItems: [] }
  } };
  const options = request('Reduce this activity to 1 question.', { session: { ...session, mode: 'build' }, current });
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 1, reply: 'Propose one question.', clarification: [] }))
    .mockResolvedValueOnce(response({ action: 'reply', reply: 'One question cannot preserve both saved objectives. Choose how to proceed.',
      clarification: [{ question: 'How should we preserve objective coverage?', options: ['Keep both objectives and two questions', 'Discuss which objective to exclude'] }] }));
  const result = await runAuthoringAgent(options);
  expect(result.action).toBe('reply'); expect(result.clarification).toHaveLength(1);
  expect(options.run.agentState.observations[0]).toMatchObject({ tool: 'check_question_revision', result: { ready: false,
    diagnostic: { code: 'QUESTION_COVERAGE_CONFLICT', minimumQuestionCount: 2 } } });
  expect(complete.mock.calls[1][0].prompt).toContain('QUESTION_COVERAGE_CONFLICT');
  expect(complete).toHaveBeenCalledTimes(2);
  expect(await runAuthoringAgent(options)).toEqual(result);
  expect(complete).toHaveBeenCalledTimes(2);
});

test.each([
  [{ scope: 'all', questionIndices: [], targetQuestionCount: 1 }, 'QUESTION_COVERAGE_CONFLICT'],
  [{ questionIndices: [99], targetQuestionCount: 1 }, 'QUESTION_REVISION_ARGUMENTS_INVALID']
])('a saved revision tool resumes with observed diagnostics without replaying its first paid decision: %j', async (args, code) => {
  const firstObjective = '555555555555555555555555'; const secondObjective = '666666666666666666666666';
  const current = { _id: '777777777777777777777777', representation: 'course-linked', snapshot: {
    learningObjectives: [{ _id: firstObjective, text: 'Explain force.' }, { _id: secondObjective, text: 'Explain energy.' }],
    questions: [{ _id: '888888888888888888888888', learningObjective: firstObjective, type: 'multiple-choice' },
      { _id: '999999999999999999999999', learningObjective: secondObjective, type: 'multiple-choice' }], settings: { planItems: [] }
  } };
  const options = request('Reduce this activity to 1 question.', { current });
  options.run.agentState = savedState(options, { phase: 'tool_pending', pendingTool: { name: 'check_question_revision', arguments: args } });
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'reply',
    reply: 'Choose how to preserve the saved learning objectives.', clarification: [] }));
  const result = await runAuthoringAgent(options);
  expect(result.action).toBe('reply');
  expect(options.run.agentState.observations[0]).toMatchObject({ tool: 'check_question_revision', result: { ready: false, diagnostic: { code } } });
  expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][0].prompt).toContain(code);
  expect(await runAuthoringAgent(options)).toEqual(result); expect(complete).toHaveBeenCalledTimes(1);
});

test('an invalid final selection becomes a bounded diagnostic and the corrected selection still passes the real free check', async () => {
  const options = request('Revise only question 2.', { current: revisionCurrent() });
  const invalid = { action: 'revise_questions', scope: 'all', questionIndices: [2], reply: 'Revise question two.', clarification: [] };
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response(invalid))
    .mockResolvedValueOnce(response({ ...invalid, scope: undefined }));
  const result = await runAuthoringAgent(options);
  expect(result).toMatchObject({ action: 'revise_questions', questionIndices: [2] });
  expect(result.scope).toBeUndefined();
  expect(options.run.agentState.observations).toEqual([
    expect.objectContaining({ tool: 'validate_final_decision', arguments: { action: 'revise_questions', scope: 'all', questionIndices: [2] },
      result: expect.objectContaining({ ready: false, diagnostic: expect.objectContaining({ code: 'AUTHORING_FINAL_DECISION_INVALID' }) }) }),
    expect.objectContaining({ tool: 'check_question_revision', arguments: { questionIndices: [2] },
      result: expect.objectContaining({ ready: true, revisionCount: 1, additionCount: 0 }) })
  ]);
  expect(options.run.agentState.invalidFinalReceipts).toEqual([{ step: 1, rawResponse: JSON.stringify(invalid) }]);
  expect(complete.mock.calls[1][0].prompt).toContain('Choose all questions or explicit question indices');
  expect(complete.mock.calls[1][0].prompt).toContain('not permission to widen the request');
  expect(complete.mock.calls[1][0].prompt).not.toContain('invalidFinalReceipts');
  expect(complete).toHaveBeenCalledTimes(2);
  expect(await runAuthoringAgent(options)).toEqual(result);
  expect(complete).toHaveBeenCalledTimes(2);
});

test('explicit recovery diagnoses the saved sixth invalid final without losing ready checks or repurchasing its response', async () => {
  const options = request('Revise only question 2.', { current: revisionCurrent() });
  const args = { questionIndices: [2] };
  const invalid = { action: 'revise_questions', scope: 'all', ...args, reply: 'Revise question two.', clarification: [] };
  const observations = Array.from({ length: 5 }, () => ({ tool: 'check_question_revision', arguments: args,
    result: { ready: true, targetQuestionCount: 2, revisionCount: 1, additionCount: 0, summary: 'Checked revision.' },
    scopeHash: authoringScopeHash(options.session) }));
  options.run.errorCode = 'AUTHORING_RESPONSE';
  options.run.agentState = savedState(options, { step: 6, phase: 'model_saved', rawResponse: JSON.stringify(invalid), observations });
  expect(canResumeAuthoringAgent(options.run)).toBe(true);
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ ...invalid, scope: undefined }));
  expect(await runAuthoringAgent(options)).toMatchObject({ action: 'revise_questions', questionIndices: [2] });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls[0][0].prompt).toContain('"lastValidatedQuestionRevision":{"questionIndices":[2]}');
  expect(complete.mock.calls[0][0].prompt).toContain('instead of repeating that tool');
  expect(complete.mock.calls[0][0].prompt).toContain('do not add scope:"all" to explicit questionIndices');
  expect(options.run.agentState.step).toBe(7);
  expect(options.run.agentState.observations.slice(0, 5)).toEqual(observations);
  expect(options.run.agentState.observations.at(-1)).toMatchObject({ tool: 'check_question_revision', arguments: args,
    result: { ready: true, revisionCount: 1 } });
  expect(options.run.agentState.invalidFinalReceipts[0]).toEqual({ step: 6, rawResponse: JSON.stringify(invalid) });
});

test.each([
  { mode: 'build', courseScope: 'Copied task data', tools: [] },
  { action: 'unsupported_action', reply: 'Unknown operation.', clarification: [] },
  { action: 'revise_questions', questionIndices: [2] }
])('task echoes or incomplete action identities remain saved failures without another automatic decision: %j', async value => {
  const options = request('Revise question 2.', { current: revisionCurrent() });
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response(value));
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
  options.run.errorCode = 'AUTHORING_RESPONSE';
  expect(canResumeAuthoringAgent(options.run)).toBe(false);
  expect(options.run.agentState).toMatchObject({ phase: 'model_saved', rawResponse: JSON.stringify(value), observations: [] });
  expect(complete).toHaveBeenCalledTimes(1);
});

test('invalid final diagnostics consume the existing remaining budget and retain only three bounded raw receipts', async () => {
  const options = request('Revise only question 2.', { current: revisionCurrent() });
  const invalid = { action: 'revise_questions', scope: 'all', questionIndices: [2], reply: 'Revise question two.', clarification: [] };
  options.run.agentState = savedState(options, { step: 31, phase: 'model_saved', rawResponse: JSON.stringify(invalid),
    invalidFinalReceipts: [27, 28, 29].map(step => ({ step, rawResponse: 'older saved response' })) });
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response(invalid));
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_AGENT_BUDGET' });
  expect(options.run.agentState).toMatchObject({ phase: 'budget_exhausted', step: 32 });
  expect(options.run.agentState.invalidFinalReceipts.map(item => item.step)).toEqual([29, 31, 32]);
  expect(options.run.agentState.observations).toHaveLength(2);
  expect(canResumeAuthoringAgent(options.run)).toBe(false);
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_AGENT_BUDGET' });
  expect(complete).toHaveBeenCalledTimes(1);
});

test('a corrected final with a coverage conflict returns its actual free diagnostic before any revision is dispatched', async () => {
  const options = request('Reduce the activity to 1 question.', { current: revisionCurrent() });
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'revise_questions', scope: 'all', questionIndices: [], targetQuestionCount: 1,
      reply: 'Propose one question.', clarification: [] }))
    .mockResolvedValueOnce(response({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 1,
      reply: 'Check one question.', clarification: [] }))
    .mockResolvedValueOnce(response({ action: 'reply', reply: 'Confirm how both learning objectives should be preserved.', clarification: [] }));
  expect(await runAuthoringAgent(options)).toMatchObject({ action: 'reply' });
  expect(options.run.agentState.observations.map(item => item.tool)).toEqual(['validate_final_decision', 'check_question_revision']);
  expect(options.run.agentState.observations.at(-1).result).toMatchObject({ ready: false, diagnostic: { code: 'QUESTION_COVERAGE_CONFLICT' } });
  expect(complete).toHaveBeenCalledTimes(3);
});

test('an invalid final authorization quote is diagnosed without inferring or dropping objective changes', async () => {
  const options = request('Revise only question 2.', { current: revisionCurrent() });
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'revise_questions', questionIndices: [2],
      objectiveChanges: { authorizationQuote: 'Merge both objectives.', merges: [{ objectiveIds: ['555555555555555555555555', '666666666666666666666666'], text: 'Merged objective.' }] },
      reply: 'Merge the objectives and revise question two.', clarification: [] }))
    .mockResolvedValueOnce(response({ action: 'reply', reply: 'Confirm whether to merge the two objectives.', clarification: [] }));
  const result = await runAuthoringAgent(options);
  expect(result.action).toBe('reply');
  expect(result.objectiveChanges).toBeUndefined();
  expect(options.run.agentState.observations).toHaveLength(1);
  expect(options.run.agentState.observations[0]).toMatchObject({ tool: 'validate_final_decision', result: {
    ready: false, diagnostic: { message: expect.stringContaining('exact authorization quote') } } });
  expect(complete).toHaveBeenCalledTimes(2);
});

test('losing the lease while saving a final diagnostic stops before another paid decision and preserves the original receipt', async () => {
  const options = request('Revise only question 2.', { current: revisionCurrent() });
  const invalid = { action: 'revise_questions', scope: 'all', questionIndices: [2], reply: 'Revise question two.', clarification: [] };
  options.run.agentState = savedState(options, { phase: 'model_saved', rawResponse: JSON.stringify(invalid) });
  AuthoringRun.updateOne.mockResolvedValue({ matchedCount: 0 });
  const complete = jest.spyOn(llmService, 'streamCompletion');
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_AGENT_STATE' });
  expect(complete).not.toHaveBeenCalled();
  expect(options.run.agentState).toMatchObject({ phase: 'model_saved', rawResponse: JSON.stringify(invalid) });
});

test('a completed decision can move to an explicitly retried run with the same instructor request identity', async () => {
  const options = request();
  options.run.input = { requestId: 'original-instructor-request' };
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'reply', reply: 'Saved answer.', clarification: [] }));
  const original = await runAuthoringAgent(options);
  const retry = request(options.latestRequest);
  retry.run._id = '555555555555555555555555';
  retry.run.input = options.run.input;
  retry.run.agentState = structuredClone(options.run.agentState);
  expect(await runAuthoringAgent(retry)).toEqual(original);
  expect(complete).toHaveBeenCalledTimes(1);
});

test('build authorization handles mode choices, Chinese commands and explicit delays', () => {
  expect(authorizesAgentBuild(session, 'How would we teach Newton?')).toBe(false);
  expect(authorizesAgentBuild(session, '按这个方向出题')).toBe(true);
  expect(authorizesAgentBuild(session, 'Create 5 questions.')).toBe(true);
  expect(authorizesAgentBuild(session, "Don't include calculus; create 5 questions.")).toBe(true);
  expect(authorizesAgentBuild(session, 'How can I create 5 questions?')).toBe(false);
  expect(authorizesAgentBuild(session, '我想聊聊如何生成5道题。')).toBe(false);
  expect(authorizesAgentBuild(session, 'Can you create 5 questions?')).toBe(true);
  expect(authorizesAgentBuild(session, 'Do not create questions yet.')).toBe(false);
  expect(authorizesAgentBuild(session, '不要生成题目，先讨论教学方法。')).toBe(false);
  expect(authorizesAgentBuild({ ...session, mode: 'build' }, 'First-year students.')).toBe(true);
  expect(authorizesAgentBuild({ ...session, mode: 'build' }, '将总题数改为3道题。')).toBe(true);
  expect(authorizesAgentBuild({ ...session, mode: 'build' }, '不要生成题目，先讨论教学方法。')).toBe(false);
  expect(authorizesAgentBuild({ ...session, mode: 'build' }, 'Just discuss the teaching approach.')).toBe(false);
  expect(authorizesAgentBuild({ ...session, mode: 'build' }, 'Create 5 questions.', 'explore')).toBe(false);
  const prompt = buildAgentPrompt({ session, latestRequest: 'How can I teach this?', history: [], state: { step: 0, observations: [] } });
  expect(prompt).toContain('an objectives request stops at editable learning objectives');
  expect(prompt).toContain('search_materials');
});

test('a persisted build intent lets a count clarification continue through checked requirements', async () => {
  const options = request('将总题数改为3道题。', { session: { ...session, mode: 'build' } });
  jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'check_requirements', arguments: {} }))
    .mockResolvedValueOnce(response({ action: 'build_plan', reply: '我会拟定3道题的教学计划。', clarification: [] }));
  expect(await runAuthoringAgent(options)).toMatchObject({ action: 'build_plan' });
  expect(options.run.agentState.observations[0].result.fields.questionCount).toBe(3);
});

test.each([
  { latest: '不要生成题目，先讨论教学方法。' },
  { latest: 'Create 5 questions.', mode: 'explore' }
])('current exploration or deferral blocks a model build even after an earlier build request: $latest', async ({ latest, mode }) => {
  const options = request(latest, { session: { ...session, mode: 'build', instructions: 'Create 5 questions.' } });
  options.run.input = { mode };
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'build_plan', reply: 'Prepare the plan.', clarification: [] }));
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
  expect(complete.mock.calls[0][0].prompt).toContain('"buildAuthorized":false');
});

test('explicit recovery preserves a raw source receipt but never reintroduces its invalidated text into the model prompt', async () => {
  const materialId = '555555555555555555555555';
  const options = request('Discuss the selected teaching source.', { session: { ...session, materialIds: [materialId] } });
  const observation = { tool: 'read_material', arguments: { materialId, offset: 0 }, scopeHash: authoringScopeHash(options.session),
    result: { material: { id: materialId, name: 'Selected source', sourceVersion: '2026-10-01T10:00:00.000Z' },
      offset: 0, text: 'INVALIDATED_PRIVATE_SOURCE_TEXT', nextOffset: null, totalCharacters: 31, summary: 'Read the earlier source.' } };
  options.session.taskContext = mergeAuthoringTaskContext(null, options.session, options.run, { observations: [observation] });
  options.run.agentState = savedState(options, { phase: 'ready', observations: [observation] });
  jest.spyOn(Material, 'find').mockReturnValue({ select: () => ({ lean: async () => [{ _id: materialId,
    processingStatus: 'completed', updatedAt: new Date('2026-10-01T11:00:00Z') }] }) });
  const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ action: 'reply', reply: 'Read the updated source before discussing its details.', clarification: [] }));
  await runAuthoringAgent(options);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls[0][0].prompt).not.toContain('INVALIDATED_PRIVATE_SOURCE_TEXT');
  expect(options.run.agentState.observations).toEqual([observation]);
});

test('a local projection limit does not mark an unstarted paid decision as pending', async () => {
  const options = request();
  options.run.agentState = savedState(options, { phase: 'ready', observations: [{ tool: 'check_requirements', arguments: {},
    scopeHash: authoringScopeHash(options.session), result: { fields: { mustCover: 'x'.repeat(32000) } } }] });
  const complete = jest.spyOn(llmService, 'streamCompletion');
  await expect(runAuthoringAgent(options)).rejects.toMatchObject({ code: 'AUTHORING_PROMPT_CONTEXT' });
  expect(complete).not.toHaveBeenCalled();
  expect(options.run.agentState.phase).toBe('ready');
  expect(AuthoringRun.updateOne).not.toHaveBeenCalled();
});

test('a two-page source can reach a checked build with only two reads instead of rereading a prematurely trimmed fact', async () => {
  const materialId = '555555555555555555555555';
  const first = 'IMPORTANT_FACT_AT_END_OF_FIRST_PAGE'.padStart(6000, 'x');
  const second = 'SOURCE_END'.padStart(1220, 'y');
  const options = request('Create 15 questions from the selected material.', {
    session: { ...session, contextCourse: false, materialIds: [materialId] }
  });
  const readMaterial = jest.spyOn(Material, 'findOne').mockReturnValue({ select: () => ({ lean: async () => ({
    _id: materialId, name: 'Synthetic source', processingStatus: 'completed', content: first + second,
    updatedAt: new Date('2026-10-03T00:00:00Z')
  }) }) });
  const complete = jest.spyOn(llmService, 'streamCompletion')
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'read_material', arguments: { materialId, offset: 0 } }))
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'read_material', arguments: { materialId, offset: 6000 } }))
    .mockResolvedValueOnce(response({ action: 'tool', tool: 'check_requirements', arguments: {} }))
    .mockImplementation(async ({ prompt }) => response(prompt.includes('IMPORTANT_FACT_AT_END_OF_FIRST_PAGE')
      ? { action: 'build_plan', reply: 'Prepare the source-grounded question plan.', clarification: [] }
      : { action: 'tool', tool: 'read_material', arguments: { materialId, offset: 0 } }));
  expect(await runAuthoringAgent(options)).toMatchObject({ action: 'build_plan' });
  expect(readMaterial).toHaveBeenCalledTimes(2);
  expect(complete).toHaveBeenCalledTimes(4);
  const finalPrompt = complete.mock.calls.at(-1)[0].prompt;
  expect(finalPrompt).toContain('IMPORTANT_FACT_AT_END_OF_FIRST_PAGE');
  expect(finalPrompt).toContain('SOURCE_END');
  expect(finalPrompt.split('IMPORTANT_FACT_AT_END_OF_FIRST_PAGE').length - 1).toBe(1);
  expect(options.run.agentState.observations.filter(row => row.tool === 'read_material').map(row => row.result.text)).toEqual([first, second]);
});
