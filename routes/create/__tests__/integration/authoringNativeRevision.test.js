import { beforeAll, afterAll, beforeEach, expect, jest, test } from '@jest/globals';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';

// Exercise the real native authoring/review/receipt and candidate services.
// Model transport and the filesystem editor are deterministic local fixtures.
const assets = new Map();
const editor = {
  saveOrUpdateContentReturnMetaData: jest.fn(async (_id, params, metadata, library) => {
    const id = randomUUID(); assets.set(id, { library, params: { params, metadata } }); return { id, metadata };
  }),
  getContent: jest.fn(async id => { if (!assets.has(id)) throw new Error('Missing fixture'); return structuredClone(assets.get(id)); }),
  deleteContent: jest.fn(async id => assets.delete(id)), contentManager: { contentFileExists: jest.fn(async () => true) }
};
jest.unstable_mockModule('../../services/lumiService.js', () => ({ getEditor: () => editor, getSystemUser: () => ({ id: 'system' }),
  toLumiUser: user => user, finalizeContentOwnership: () => {} }));
const start = jest.fn(); const approve = jest.fn();
jest.unstable_mockModule('../../services/studioAssistantService.js', () => ({ createAssistantSession: start,
  readAssistantSession: async () => null, approveAssistantPlan: approve, resumeAssistantSession: jest.fn(),
  updateAssistantPlan: jest.fn(), updateAssistantObjectives: jest.fn() }));
const complete = jest.fn(); const generate = jest.fn(); const agent = jest.fn();
jest.unstable_mockModule('../../services/authoring/authoringAgent.js', () => ({ runAuthoringAgent: agent,
  canResumeAuthoringAgent: run => run?.errorCode !== 'AUTHORING_RESPONSE' }));
jest.unstable_mockModule('../../services/llmService.js', () => ({ default: { streamCompletion: complete } }));
jest.unstable_mockModule('../../services/h5pStudioAIService.js', () => ({ generateStudioActivity: generate,
  validateStudioRequestFeasibility: async () => {} }));
jest.unstable_mockModule('../../services/authoring/authoringRequirements.js', () => ({
  assessAuthoringRequirements: async () => ({ ready: true, clarification: [] }),
  effectiveTeachingBrief: session => `${session.instructions}\n${JSON.stringify(session.teachingRequirements?.fields || {})}`
}));
jest.unstable_mockModule('../../services/studioAssistantPlanning.js', () => ({
  buildAssistantContext: async materials => ({ context: 'Water survey: repairing leaks saves 20 units.',
    sources: materials.map(material => ({ materialId: String(material._id), materialName: material.name, excerpt: material.content })) }),
  getAssistantQuestionTypes: () => [{ questionType: 'multiple-choice' }], proposeAssistantPlan: jest.fn(), proposeAssistantObjectives: jest.fn()
}));
jest.unstable_mockModule('../../services/h5pExportService.js', () => ({ buildNativeH5PDocument: jest.fn() }));
jest.unstable_mockModule('../../services/ragService.js', () => ({ default: { retrieveRelevantContent: jest.fn() } }));

const { AuthoringSession: Session, AuthoringRun: Run, AuthoringMessage: Message, AuthoringVersion: Version } = await import('../../models/StudioAuthoring.js');
const { default: Folder } = await import('../../models/Folder.js');
const { default: Material } = await import('../../models/Material.js');
const { default: Quiz } = await import('../../models/Quiz.js');
const { default: Question } = await import('../../models/Question.js');
const { default: Objective } = await import('../../models/LearningObjective.js');
const { default: Content } = await import('../../models/H5PContent.js');
const { createAuthoringSession, authoringCommand, readAuthoringSession, tickAuthoringWorker } = await import('../../services/authoring/authoringService.js');
const { QUESTION_REVIEW_POLICY_VERSION } = await import('../../services/questionReviewContract.js');
const models = [Session, Run, Message, Version, Folder, Material, Quiz, Question, Objective, Content];
const dbName = `tlef_qa_native_revision_${randomUUID().replaceAll('-', '')}`;
const library = 'H5P.Chart 1.2';
const originalDocument = { library, metadata: { title: 'Water saving chart' }, parameters: { type: 'bar',
  data: [{ label: 'Leaks', value: 20 }] } };
const revisedDocument = { library, metadata: { title: 'Water saved by repairing leaks' }, parameters: { type: 'bar',
  data: [{ label: 'Repairing leaks', value: 20 }] } };
const passed = { contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true, feedbackIsConsistent: true,
  followsInstructorRequest: true, evidenceIsSufficient: true, issues: [], calculations: [] };
const draftPrompt = 'Draft the owned native activity revision.';
beforeAll(async () => {
  dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });
  const uri = new URL(process.env.E2E_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
  if (!['localhost', '127.0.0.1'].includes(uri.hostname)) throw new Error('Tests require a local disposable MongoDB.');
  await mongoose.connect(uri.toString(), { dbName, serverSelectionTimeoutMS: 5000 });
  await Promise.all(models.map(model => model.init()));
}, 30000);
afterAll(async () => {
  try { if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase(); }
  finally { await mongoose.disconnect(); }
});
beforeEach(async () => {
  await Promise.all(models.map(model => model.deleteMany({}))); assets.clear(); start.mockClear(); approve.mockClear();
  editor.saveOrUpdateContentReturnMetaData.mockClear();
  complete.mockReset().mockImplementation(async options => ({ content: JSON.stringify(options.prompt === draftPrompt ? { document: revisedDocument } : passed), model: 'local-fixture' }));
  generate.mockReset().mockImplementation(async ({ complete: call }) => JSON.parse((await call({ prompt: draftPrompt })).content));
  agent.mockReset().mockImplementation(async ({ run }) => {
    const decision = run.agentState?.final || { action: 'revise_activity', reply: 'Clarify the chart labels.' };
    await Run.updateOne({ _id: run._id }, { $set: { agentState: { phase: 'completed', final: decision } } });
    return decision;
  });
});

async function fixture({ current = true } = {}) {
  const owner = String(new mongoose.Types.ObjectId());
  const course = await Folder.create({ name: 'Native QA course', instructor: owner });
  const material = await Material.create({ name: 'Water survey', type: 'text', content: 'Repairing leaks saves 20 units.',
    folder: course._id, uploadedBy: owner, processingStatus: 'completed', processingMetadata: { chunkCount: 1, embeddedChunkCount: 1 } });
  const quiz = await Quiz.create({ name: 'Existing water course activity', folder: course._id, createdBy: owner, materials: [material._id] });
  const objective = await Objective.create({ text: 'Interpret water saving data.', quiz: quiz._id, createdBy: owner });
  const question = await Question.create({ quiz: quiz._id, createdBy: owner, learningObjective: objective._id, type: 'true-false', difficulty: 'moderate',
    questionText: 'Repairing leaks saves water.', content: { answer: true }, correctAnswer: 'true' });
  await Quiz.updateOne({ _id: quiz._id }, { $set: { learningObjectives: [objective._id], questions: [question._id] } });
  const f = { owner, course, material, quiz, objective, question };
  if (current) {
    const session = await Session.create({ owner, requestId: randomUUID(), courseId: course._id, quizId: quiz._id,
      materialIds: [material._id], objectiveIds: [objective._id], instructions: 'Use the supplied water survey to teach data interpretation.', mode: 'build', status: 'ready' });
    const contentId = randomUUID(); assets.set(contentId, { library, params: { params: originalDocument.parameters, metadata: originalDocument.metadata } });
    await Content.create({ owner, folder: course._id, quiz: quiz._id, lumiContentId: contentId, title: originalDocument.metadata.title,
      mainLibrary: 'H5P.Chart', source: 'editor', authoringSessionId: session._id });
    const version = await Version.create({ owner, sessionId: session._id, runId: new mongoose.Types.ObjectId(), contentId,
      title: originalDocument.metadata.title, representation: 'native-fork', number: 1, state: 'accepted' });
    await Session.updateOne({ _id: session._id }, { $set: { currentVersionId: version._id, versionCounter: 1 } });
    f.session = await readAuthoringSession(owner, String(session._id)); f.base = version;
  }
  return f;
}
async function settle(owner, id) {
  for (let index = 0; index < 180; index++) {
    await Run.updateMany({ status: 'waiting' }, { $set: { nextAt: new Date(0) } });
    await tickAuthoringWorker(); await new Promise(resolve => setTimeout(resolve, 10));
    const view = await readAuthoringSession(owner, id);
    if (view.run && ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(view.run.status)) return view;
  }
  throw new Error('Native task did not settle');
}
async function revise(f) {
  await authoringCommand(f.owner, f.session.id, 'message', { requestId: randomUUID(), revision: f.session.revision,
    text: 'Revise this entire chart: clarify the labels and preserve the recorded survey values.' });
  return settle(f.owner, f.session.id);
}
async function retry(f, view) {
  await authoringCommand(f.owner, view.id, 'retry', { requestId: randomUUID(), revision: view.revision });
  return settle(f.owner, view.id);
}
async function createNativeCandidate(f) {
  agent.mockResolvedValueOnce({ action: 'build_native_plan', library, reply: 'Propose a survey chart.' });
  const created = await createAuthoringSession(f.owner, { requestId: randomUUID(), courseId: String(f.course._id),
    materialIds: [String(f.material._id)], objectiveIds: [String(f.objective._id)],
    instructions: 'Create a chart using the recorded water survey. First present a confirmable plan.' });
  const planned = await settle(f.owner, created.id);
  await authoringCommand(f.owner, created.id, 'approve', { requestId: randomUUID(), revision: planned.revision, planRevision: planned.nativePlan.revision });
  return settle(f.owner, created.id);
}

async function nativePlan(f) {
  agent.mockResolvedValueOnce({ action: 'build_native_plan', library, reply: 'Review the recorded survey chart plan.' });
  const created = await createAuthoringSession(f.owner, { requestId: randomUUID(), courseId: String(f.course._id),
    materialIds: [String(f.material._id)], objectiveIds: [String(f.objective._id)],
    instructions: 'Create a chart using the recorded water survey, preserving its value of 20. First present a confirmable plan.' });
  return settle(f.owner, created.id);
}

async function discuss(f, view) {
  agent.mockResolvedValueOnce({ action: 'reply', reply: 'Your approved survey values remain saved; resume the failed generation explicitly.' });
  await authoringCommand(f.owner, view.id, 'message', { requestId: randomUUID(), revision: view.revision,
    text: 'Explain the saved plan and the next step without generating again.' });
  return settle(f.owner, view.id);
}

test('discussing a pending native plan preserves its approval action without generating', async () => {
  const f = await fixture({ current: false }); const planned = await nativePlan(f);
  const discussed = await discuss(f, planned);
  expect(discussed.status).toBe('awaiting_approval'); expect(discussed.nativePlan).toEqual(planned.nativePlan);
  expect(generate).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  await authoringCommand(f.owner, discussed.id, 'approve', { requestId: randomUUID(), revision: discussed.revision, planRevision: discussed.nativePlan.revision });
  const proposed = await settle(f.owner, discussed.id);
  expect(proposed.error).toBe(''); expect(proposed.candidateVersionId).toBeTruthy(); expect(complete).toHaveBeenCalledTimes(2);
});

test('failed native generation remains resumable after discussion and reuses only its exact owned plan draft', async () => {
  const f = await fixture({ current: false }); const planned = await nativePlan(f); let reviews = 0;
  complete.mockImplementation(async options => {
    if (options.prompt === draftPrompt) return { content: JSON.stringify({ document: revisedDocument }) };
    if (++reviews === 1) throw new Error('Fixture review unavailable');
    return { content: JSON.stringify(passed) };
  });
  await authoringCommand(f.owner, planned.id, 'approve', { requestId: randomUUID(), revision: planned.revision, planRevision: planned.nativePlan.revision });
  const failed = await settle(f.owner, planned.id);
  expect(failed.status).toBe('needs_attention'); expect(failed.nativeGeneration.failure.reason).toBe('REVIEW_UNAVAILABLE');
  const saved = (await Run.findById(failed.run.id)).result.nativeActivity;
  const discussed = await discuss(f, failed);
  expect(discussed.run.id).not.toBe(failed.run.id); expect(discussed.run.status).toBe('succeeded');
  expect(discussed.status).toBe('needs_attention'); expect(discussed.nativeGeneration.failure.reason).toBe('REVIEW_UNAVAILABLE');
  expect(discussed.nativePlan.status).toBe('generating'); expect(complete).toHaveBeenCalledTimes(2);
  // A newer terminal attempt for a different plan must not supply its draft.
  await Run.create({ owner: f.owner, sessionId: discussed.id, requestId: randomUUID(), kind: 'approve', status: 'failed',
    result: { nativeActivity: { ...saved, inputHash: 'different-plan', receipts: {} } } });
  const recovered = await retry(f, discussed);
  expect(recovered.error).toBe(''); expect(recovered.candidateVersionId).toBeTruthy();
  expect(complete.mock.calls.filter(([options]) => options.prompt === draftPrompt)).toHaveLength(1); expect(complete).toHaveBeenCalledTimes(3);
  const state = (await Run.findById(recovered.run.id)).result.nativeActivity;
  expect(state.receipts['draft:0']).toEqual(saved.receipts['draft:0']);
  expect(state.output.document.parameters.data[0].value).toBe(20);
  expect(start).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
});

test('initial plan approval rejects changed teaching specifications before any paid draft or review', async () => {
  const f = await fixture({ current: false }); const planned = await nativePlan(f);
  await Session.updateOne({ _id: planned.id }, { $set: { 'teachingRequirements.fields.audience': { value: 'Advanced researchers', source: 'instructor' } } });
  await authoringCommand(f.owner, planned.id, 'approve', { requestId: randomUUID(), revision: planned.revision, planRevision: planned.nativePlan.revision });
  const refused = await settle(f.owner, planned.id);
  expect(refused.status).toBe('needs_attention'); expect(refused.error).toContain('different teaching scope');
  expect(refused.currentVersionId).toBeNull(); expect(refused.candidateVersionId).toBeNull();
  expect(generate).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
});

test('native packaging failure stays resumable after discussion without repeating the saved draft or review', async () => {
  const f = await fixture({ current: false }); const planned = await nativePlan(f);
  editor.saveOrUpdateContentReturnMetaData.mockRejectedValueOnce(new Error('Fixture packaging unavailable'));
  await authoringCommand(f.owner, planned.id, 'approve', { requestId: randomUUID(), revision: planned.revision, planRevision: planned.nativePlan.revision });
  const failed = await settle(f.owner, planned.id);
  const original = await Run.findById(failed.run.id);
  expect(failed.status).toBe('needs_attention'); expect(failed.nativePlan.status).toBe('generated');
  expect(original.checkpoint).toBe('output_saved'); expect(original.result.nativeActivity.phase).toBe('completed');
  const discussed = await discuss(f, failed);
  expect(discussed.run.id).not.toBe(failed.run.id); expect(discussed.run.status).toBe('succeeded');
  expect(discussed.status).toBe('needs_attention'); expect(discussed.nativeGeneration.phase).toBe('completed');
  const recovered = await retry(f, discussed);
  expect(recovered.error).toBe(''); expect(recovered.currentVersionId).toBeNull(); expect(recovered.candidateVersionId).toBeTruthy();
  expect(complete).toHaveBeenCalledTimes(2); expect(generate).toHaveBeenCalledTimes(1);
  const resumed = (await Run.findById(recovered.run.id)).result.nativeActivity;
  expect(resumed.receipts).toEqual(original.result.nativeActivity.receipts);
  expect(resumed.output).toEqual(original.result.nativeActivity.output);
  expect((await Version.findById(recovered.candidateVersionId)).reviewSummary.policyVersion).toBe(QUESTION_REVIEW_POLICY_VERSION);
});

test.each([false, true])('Resume prioritizes the latest invalid planning request over an older native draft (wrapped retry: %s)', async wrapped => {
  const f = await fixture({ current: false }); const planned = await nativePlan(f);
  complete.mockImplementation(async options => {
    if (options.prompt === draftPrompt) return { content: JSON.stringify({ document: revisedDocument }) };
    throw new Error('Fixture review unavailable');
  });
  await authoringCommand(f.owner, planned.id, 'approve', { requestId: randomUUID(), revision: planned.revision, planRevision: planned.nativePlan.revision });
  const nativeFailed = await settle(f.owner, planned.id);
  const oldState = (await Run.findById(nativeFailed.run.id)).result.nativeActivity;
  const text = 'Create a new confirmable Chart plan using the recorded water survey, preserving 20.';
  agent.mockImplementationOnce(async ({ run }) => {
    await Run.updateOne({ _id: run._id }, { $set: { agentState: { phase: 'model_saved', rawResponse: '{"mode":"build"}' } } });
    throw Object.assign(new Error('Fixture invalid planning response'), { status: 422, code: 'AUTHORING_RESPONSE' });
  });
  await authoringCommand(f.owner, nativeFailed.id, 'message', { requestId: randomUUID(), revision: nativeFailed.revision, text });
  let planningFailed = await settle(f.owner, nativeFailed.id);
  expect(planningFailed.run.status).toBe('failed');
  if (wrapped) {
    // Preserve the pre-fix retry which wrongly entered the older native gate.
    const requestId = randomUUID();
    const wrapper = await Run.create({ owner: f.owner, sessionId: planningFailed.id, requestId, kind: 'retry', status: 'failed',
      checkpoint: 'start', errorCode: 'AUTHORING_CONTRACT_CHANGED', input: { requestId, revision: planningFailed.revision, resumeRunId: planningFailed.run.id } });
    await Session.updateOne({ _id: planningFailed.id }, { $set: { activeRunId: wrapper._id, status: 'needs_attention' }, $inc: { revision: 1 } });
    planningFailed = await readAuthoringSession(f.owner, planningFailed.id);
  }
  agent.mockImplementationOnce(async ({ run, latestRequest }) => {
    expect(run.agentState).toBeUndefined(); expect(latestRequest).toBe(text);
    return { action: 'build_native_plan', library, reply: 'Review the newly requested chart plan.' };
  });
  const resumed = await retry(f, planningFailed);
  expect(resumed.error).toBe(''); expect(resumed.status).toBe('awaiting_approval');
  expect(resumed.nativePlan.revision).toBeGreaterThan(planned.nativePlan.revision);
  expect(resumed.nativePlan.brief).toContain(text); expect(resumed.candidateVersionId).toBeNull();
  expect(generate).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(2);
  expect((await Run.findById(nativeFailed.run.id)).result.nativeActivity).toEqual(oldState);
});

test('Resume carries the latest completed planning decision instead of purchasing another older native review', async () => {
  const f = await fixture({ current: false }); const planned = await nativePlan(f);
  complete.mockImplementation(async options => {
    if (options.prompt === draftPrompt) return { content: JSON.stringify({ document: revisedDocument }) };
    throw new Error('Fixture review unavailable');
  });
  await authoringCommand(f.owner, planned.id, 'approve', { requestId: randomUUID(), revision: planned.revision, planRevision: planned.nativePlan.revision });
  const nativeFailed = await settle(f.owner, planned.id);
  const decision = { action: 'build_native_plan', library, reply: 'Review the replacement chart plan.' };
  agent.mockImplementationOnce(async ({ run }) => {
    await Run.updateOne({ _id: run._id }, { $set: { agentState: { phase: 'completed', final: decision } } });
    throw Object.assign(new Error('Fixture interrupted after saving the planning decision'), { status: 409, code: 'AUTHORING_CONFLICT' });
  });
  await authoringCommand(f.owner, nativeFailed.id, 'message', { requestId: randomUUID(), revision: nativeFailed.revision,
    text: 'Create a new chart plan from the recorded survey.' });
  const planningFailed = await settle(f.owner, nativeFailed.id);
  const original = (await Run.findById(planningFailed.run.id)).agentState;
  const resumed = await retry(f, planningFailed);
  expect(resumed.error).toBe(''); expect(resumed.status).toBe('awaiting_approval');
  expect(agent.mock.calls.at(-1)[0].run.agentState).toEqual(original);
  expect(generate).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(2);
});

test('a whole activity revision is checked, saves receipts, and changes only the accepted Studio version', async () => {
  const f = await fixture(); const originalQuiz = await Quiz.findById(f.quiz._id).lean(); const originalQuestion = await Question.findById(f.question._id).lean();
  const proposed = await revise(f);
  expect(proposed.error).toBe(''); expect(proposed.currentVersionId).toBe(String(f.base._id)); expect(proposed.candidateVersionId).toBeTruthy();
  expect(complete).toHaveBeenCalledTimes(2); expect(complete.mock.calls[1][0].prompt).toContain('ENTIRE existing activity document');
  expect(generate.mock.calls[0][0]).toMatchObject({ templateContentId: f.base.contentId, template: assets.get(f.base.contentId) });
  const candidate = await Version.findById(proposed.candidateVersionId).lean();
  expect(candidate).toMatchObject({ representation: 'native-fork', state: 'candidate', reviewSummary: { policyVersion: QUESTION_REVIEW_POLICY_VERSION },
    nativeSourceContract: { kind: 'revision', baseVersionId: String(f.base._id), templateContentId: f.base.contentId } });
  const saved = await Run.findById(proposed.run.id);
  expect(saved.result.nativeActivity.receipts['draft:0'].phase).toBe('saved');
  expect(saved.result.nativeActivity.receipts['review:0'].phase).toBe('saved');
  expect(saved.result.nativeActivity.phase).toBe('completed');
  await authoringCommand(f.owner, proposed.id, 'accept', { requestId: randomUUID(), revision: proposed.revision, versionId: String(candidate._id) });
  const accepted = await settle(f.owner, proposed.id);
  expect(accepted.error).toBe(''); expect(accepted.currentVersionId).toBe(String(candidate._id));
  expect(await Quiz.findById(f.quiz._id).lean()).toEqual(originalQuiz);
  expect(await Question.findById(f.question._id).lean()).toEqual(originalQuestion);
  expect(start).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
});

test('initial review recognizes the actual approved workflow without dropping the original content constraints', async () => {
  const f = await fixture({ current: false });
  const instructions = 'Create a chart of the supplied survey. First give me a confirmable activity plan. Do not add conclusions or questions.';
  agent.mockResolvedValueOnce({ action: 'build_native_plan', library, reply: 'Review the survey chart plan.' });
  complete.mockImplementation(async options => ({ content: JSON.stringify(options.prompt === draftPrompt ? { document: revisedDocument }
    : { ...passed, followsInstructorRequest: options.prompt.includes('approved_native_plan_candidate_review')
      && options.prompt.includes('explicitly chose Accept plan & generate') && options.prompt.includes(instructions) }) }));
  const created = await createAuthoringSession(f.owner, { requestId: randomUUID(), courseId: String(f.course._id),
    materialIds: [String(f.material._id)], objectiveIds: [String(f.objective._id)], instructions });
  const planned = await settle(f.owner, created.id);
  expect(planned.status).toBe('awaiting_approval'); expect(generate).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  await authoringCommand(f.owner, planned.id, 'approve', { requestId: randomUUID(), revision: planned.revision, planRevision: planned.nativePlan.revision });
  const proposed = await settle(f.owner, planned.id);
  expect(proposed.error).toBe(''); expect(proposed.currentVersionId).toBeNull(); expect(proposed.candidateVersionId).toBeTruthy();
  const candidate = await Version.findById(proposed.candidateVersionId);
  expect(candidate.reviewSummary.checks.followsInstructorRequest).toBe(true);
  expect(complete.mock.calls[1][0].prompt).toContain('ENTIRE existing activity document');
  expect(complete).toHaveBeenCalledTimes(2);
});

test('a rejected whole activity check keeps the current version and produces no candidate', async () => {
  const f = await fixture();
  complete.mockImplementation(async options => ({ content: JSON.stringify(options.prompt === draftPrompt ? { document: revisedDocument }
    : { ...passed, feedbackIsConsistent: false, issues: ['The feedback contradicts the recorded survey.'] }) }));
  const failed = await revise(f);
  expect(failed.status).toBe('needs_attention'); expect(failed.currentVersionId).toBe(String(f.base._id)); expect(failed.candidateVersionId).toBeNull();
  expect(await Version.countDocuments({ sessionId: failed.id })).toBe(1);
  const state = (await Run.findById(failed.run.id)).result.nativeActivity;
  expect(state.failure.reason).toBe('FEEDBACK_INVALID'); expect(state.output).toBeUndefined();
  expect(state.receipts['draft:0'].phase).toBe('saved'); expect(state.receipts['review:0'].phase).toBe('saved');
  expect(complete).toHaveBeenCalledTimes(2);
});

test('an explicit retry keeps the revision plan and draft receipt and buys only an unavailable review', async () => {
  const f = await fixture(); let reviews = 0;
  complete.mockImplementation(async options => {
    if (options.prompt === draftPrompt) return { content: JSON.stringify({ document: revisedDocument }) };
    if (++reviews === 1) throw new Error('Fixture review unavailable');
    return { content: JSON.stringify(passed) };
  });
  const failed = await revise(f); const old = (await Run.findById(failed.run.id)).result.nativeActivity;
  expect(old.failure.reason).toBe('REVIEW_UNAVAILABLE'); expect(old.plan.latestRequest).toContain('clarify the labels');
  const recovered = await retry(f, failed);
  expect(recovered.error).toBe(''); expect(recovered.candidateVersionId).toBeTruthy();
  expect(complete.mock.calls.filter(([options]) => options.prompt === draftPrompt)).toHaveLength(1); expect(complete).toHaveBeenCalledTimes(3);
  expect((await Run.findById(recovered.run.id)).result.nativeActivity.plan).toEqual(old.plan);
  expect(recovered.currentVersionId).toBe(String(f.base._id));
});

test('completed output resumes packaging without buying another draft or review', async () => {
  const f = await fixture(); editor.saveOrUpdateContentReturnMetaData.mockRejectedValueOnce(new Error('Fixture packaging unavailable'));
  const failed = await revise(f); const state = (await Run.findById(failed.run.id)).result;
  expect(failed.status).toBe('needs_attention'); expect(state.nativeActivity.phase).toBe('completed'); expect(state.nativeSourceContract.kind).toBe('revision');
  const recovered = await retry(f, failed);
  expect(recovered.error).toBe(''); expect(recovered.candidateVersionId).toBeTruthy();
  expect(complete).toHaveBeenCalledTimes(2); expect(generate).toHaveBeenCalledTimes(1); expect(agent).toHaveBeenCalledTimes(1);
});

test.each(['initial', 'revision'])('saved %s output refuses packaging after a source change without repurchasing model calls', async kind => {
  const f = await fixture({ current: kind !== 'initial' });
  editor.saveOrUpdateContentReturnMetaData.mockRejectedValueOnce(new Error('Fixture packaging unavailable'));
  const failed = kind === 'initial' ? await createNativeCandidate(f) : await revise(f);
  expect((await Run.findById(failed.run.id)).checkpoint).toBe('output_saved');
  await Material.updateOne({ _id: f.material._id }, { $set: { content: 'The survey has been replaced.' } });
  const refused = await retry(f, failed);
  expect(refused.status).toBe('needs_attention'); expect(refused.error).toContain('selected sources changed'); expect(refused.candidateVersionId).toBeNull();
  expect(refused.currentVersionId).toBe(kind === 'initial' ? null : String(f.base._id));
  expect(complete).toHaveBeenCalledTimes(2); expect(generate).toHaveBeenCalledTimes(1);
});

test.each(['initial', 'revision'])('a %s candidate cannot be accepted after its selected LO changes', async kind => {
  const f = await fixture({ current: kind !== 'initial' });
  const proposed = kind === 'initial' ? await createNativeCandidate(f) : await revise(f);
  expect(proposed.error).toBe(''); expect(proposed.candidateVersionId).toBeTruthy();
  await Objective.updateOne({ _id: f.objective._id }, { $set: { text: 'Interpret different survey data.' } });
  await authoringCommand(f.owner, proposed.id, 'accept', { requestId: randomUUID(), revision: proposed.revision, versionId: proposed.candidateVersionId });
  const refused = await settle(f.owner, proposed.id);
  expect(refused.status).toBe('needs_attention'); expect(refused.error).toContain('selected sources changed');
  expect(refused.currentVersionId).toBe(kind === 'initial' ? null : String(f.base._id));
  expect((await Version.findById(proposed.candidateVersionId)).state).toBe('candidate'); expect(complete).toHaveBeenCalledTimes(2);
});

test.each(['template', 'policy'])('candidate acceptance refuses a changed %s contract while preserving the current activity', async changed => {
  const f = await fixture(); const proposed = await revise(f);
  if (changed === 'template') assets.get(f.base.contentId).params.params = { type: 'pie', data: [{ label: 'Changed', value: 100 }] };
  else await Version.updateOne({ _id: proposed.candidateVersionId }, { $set: { 'nativeSourceContract.reviewPolicyVersion': 'old-policy' } });
  await authoringCommand(f.owner, proposed.id, 'accept', { requestId: randomUUID(), revision: proposed.revision, versionId: proposed.candidateVersionId });
  const refused = await settle(f.owner, proposed.id);
  expect(refused.status).toBe('needs_attention'); expect(refused.currentVersionId).toBe(String(f.base._id));
  expect(refused.error).toMatch(/template changed|different review policy/);
  expect((await Version.findById(proposed.candidateVersionId)).state).toBe('candidate'); expect(complete).toHaveBeenCalledTimes(2);
});

test('an older generated native candidate without its review contract cannot be accepted', async () => {
  const f = await fixture(); const proposed = await revise(f);
  await Version.updateOne({ _id: proposed.candidateVersionId }, { $unset: { nativeSourceContract: '' } });
  await authoringCommand(f.owner, proposed.id, 'accept', { requestId: randomUUID(), revision: proposed.revision, versionId: proposed.candidateVersionId });
  const refused = await settle(f.owner, proposed.id);
  expect(refused.status).toBe('needs_attention'); expect(refused.currentVersionId).toBe(String(f.base._id));
  expect(refused.error).toContain('no current generation review contract');
  expect((await Version.findById(proposed.candidateVersionId)).state).toBe('candidate'); expect(complete).toHaveBeenCalledTimes(2);
});

test('an explicit historical native restore preserves its saved document without claiming a new generation check', async () => {
  const f = await fixture(); const proposed = await revise(f);
  await authoringCommand(f.owner, proposed.id, 'accept', { requestId: randomUUID(), revision: proposed.revision, versionId: proposed.candidateVersionId });
  const accepted = await settle(f.owner, proposed.id);
  await Material.updateOne({ _id: f.material._id }, { $set: { content: 'A newer survey exists.' } });
  await authoringCommand(f.owner, accepted.id, 'restore', { requestId: randomUUID(), revision: accepted.revision, versionId: String(f.base._id) });
  const restored = await settle(f.owner, accepted.id);
  expect(restored.error).toBe(''); expect(restored.currentVersionId).not.toBe(String(f.base._id));
  const version = await Version.findById(restored.currentVersionId);
  expect(version.restoredFromId.toString()).toBe(String(f.base._id)); expect(version.nativeSourceContract).toBeUndefined();
  expect(assets.get(version.contentId).params.params).toEqual(originalDocument.parameters);
  expect(complete).toHaveBeenCalledTimes(2);
});
