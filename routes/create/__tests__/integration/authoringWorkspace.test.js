import { beforeAll, afterAll, beforeEach, describe, test, expect, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

const assets = new Map();
const editor = {
  saveOrUpdateContentReturnMetaData: jest.fn(async (_id, params, metadata, library) => {
    const id = randomUUID(); assets.set(id, { library, params: { params, metadata } }); return { id, metadata };
  }),
  getContent: jest.fn(async id => { if (!assets.has(id)) throw new Error('Missing fixture'); return assets.get(id); }),
  deleteContent: jest.fn(async id => assets.delete(id)),
  contentManager: { contentFileExists: jest.fn(async () => true) }
};
jest.unstable_mockModule('../../services/lumiService.js', () => ({ getEditor: () => editor, getSystemUser: () => ({ id: 'system' }),
  toLumiUser: user => user, finalizeContentOwnership: () => {} }));
const legacy = new Map();
const start = jest.fn(async (_user, body) => {
  const value = { id: new mongoose.Types.ObjectId().toString(), quizId: body.quizId, status: 'awaiting_approval', revision: 1,
    objectives: [], plan: [], events: [] }; legacy.set(value.id, value); return value;
});
const approve = jest.fn(async (_user, id) => { const value = legacy.get(id); value.status = 'completed'; return value; });
jest.unstable_mockModule('../../services/studioAssistantService.js', () => ({
  createAssistantSession: start, readAssistantSession: async (_owner, id) => legacy.get(id),
  approveAssistantPlan: approve, resumeAssistantSession: async (_user, id) => legacy.get(id), updateAssistantPlan: jest.fn()
}));
jest.unstable_mockModule('../../services/h5pExportService.js', () => ({
  buildNativeH5PDocument: async snapshot => ({ library: 'H5P.Column 1.18', metadata: { title: snapshot.name },
    parameters: { content: snapshot.questions.map(q => ({ text: q.questionText })) } })
}));
const complete = jest.fn();
const generate = jest.fn();
jest.unstable_mockModule('../../services/llmService.js', () => ({ default: { streamCompletion: complete, generateQuestion: generate } }));
jest.unstable_mockModule('../../services/ragService.js', () => ({ default: { retrieveRelevantContent: async () => ({ chunks: [{ content: 'Water evaporates.', metadata: { materialId: '000000000000000000000001', pageNumber: 1 } }] }) } }));
const { AuthoringSession: Session, AuthoringRun: Run, AuthoringMessage: Message, AuthoringVersion: Version } = await import('../../models/StudioAuthoring.js');
const { default: Folder } = await import('../../models/Folder.js');
const { default: Quiz } = await import('../../models/Quiz.js');
const { default: Material } = await import('../../models/Material.js');
const { default: Question } = await import('../../models/Question.js');
const { default: Objective } = await import('../../models/LearningObjective.js');
const { default: Content } = await import('../../models/H5PContent.js');
const { createAuthoringSession, authoringCommand, readAuthoringSession, cancelAuthoringRun, tickAuthoringWorker } = await import('../../services/authoring/authoringService.js');
const { buildH5PSourceFingerprint } = await import('../../services/h5pEditorService.js');
const { saveManualVersion } = await import('../../services/authoring/artifactVersionService.js');
const models = [Session, Run, Message, Version, Folder, Quiz, Material, Question, Objective, Content];
const dbName = `tlef_qa_authoring_${randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });
  const uri = new URL(process.env.E2E_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
  if (!['localhost', '127.0.0.1'].includes(uri.hostname)) throw new Error('Tests require a local disposable MongoDB.');
  await mongoose.connect(uri.toString(), { dbName, serverSelectionTimeoutMS: 5000 });
  await Promise.all(models.map(model => model.init()));
}, 30000);
afterAll(async () => {
  try { if (mongoose.connection.name === dbName && dbName.startsWith('tlef_qa_authoring_')) await mongoose.connection.dropDatabase(); }
  finally { await mongoose.disconnect(); }
});
beforeEach(async () => {
  await Promise.all(models.map(model => model.deleteMany({})));
  assets.clear(); legacy.clear(); start.mockClear(); approve.mockClear(); complete.mockReset(); generate.mockReset();
  complete.mockResolvedValue({ content: JSON.stringify({ action: 'reply', reply: 'The current activity uses your selected materials.' }) });
});
async function fixture() {
  const owner = String(new mongoose.Types.ObjectId());
  const folder = await Folder.create({ name: 'QA course', instructor: owner });
  const material = await Material.create({ name: 'QA water', type: 'text', content: 'Water evaporates.', folder: folder._id,
    uploadedBy: owner, processingStatus: 'completed', processingMetadata: { chunkCount: 1, embeddedChunkCount: 1 } });
  const quiz = await Quiz.create({ name: 'Water activity', folder: folder._id, createdBy: owner, materials: [material._id] });
  const lo = await Objective.create({ text: 'Explain evaporation.', quiz: quiz._id, createdBy: owner });
  const questions = await Question.create([0, 1].map(i => ({ quiz: quiz._id, createdBy: owner, learningObjective: lo._id,
    type: 'multiple-choice', difficulty: 'moderate', order: i, questionText: `Original question ${i + 1}?`,
    content: { options: [{ text: 'Water', isCorrect: true }, { text: 'Rock', isCorrect: false }] }, correctAnswer: 'Water' })));
  await Quiz.updateOne({ _id: quiz._id }, { $set: { learningObjectives: [lo._id], questions: questions.map(q => q._id) } });
  const body = { requestId: randomUUID(), courseId: String(folder._id), quizId: String(quiz._id), materialIds: [String(material._id)], instructions: 'Create a water cycle learning activity.' };
  return { owner, folder, material, quiz, questions, body };
}
async function settle(owner, id) {
  for (let i = 0; i < 150; i++) {
    await Run.updateMany({ status: 'waiting' }, { $set: { nextAt: new Date(0) } });
    await tickAuthoringWorker();
    await new Promise(resolve => setTimeout(resolve, 15));
    const view = await readAuthoringSession(owner, id);
    if (view.run && ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(view.run.status)) {
      await new Promise(resolve => setTimeout(resolve, 20));
      return readAuthoringSession(owner, id);
    }
  }
  throw new Error('Task did not settle');
}
async function ready(f) {
  const created = await createAuthoringSession(f.owner, f.body);
  const plan = await settle(f.owner, created.id);
  expect(plan.status).toBe('awaiting_approval');
  await authoringCommand(f.owner, plan.id, 'approve', { requestId: randomUUID(), revision: plan.revision, planRevision: 1 });
  const result = await settle(f.owner, plan.id);
  expect(result.error).toBe(''); expect(result.status).toBe('ready');
  return result;
}

describe('durable Studio authoring', () => {
  test('answers a failed unpublished batch without retrying, then reconciles a saved plan edit', async () => {
    const f = await fixture();
    const created = await createAuthoringSession(f.owner, f.body);
    const initial = await settle(f.owner, created.id);
    const assistant = legacy.get(initial.assistant.id);
    Object.assign(assistant, { status: 'failed', phase: 'generating', errorCode: 'ASSISTANT_QUESTION_BATCH_FAILED',
      error: 'Batch blocked.', generation: { items: [{ index: 0, status: 'failed', reason: 'ANSWER_INVALID' }] } });
    await Session.updateOne({ _id: initial.id }, { $set: { status: 'needs_attention', error: 'Batch blocked.' } });
    await authoringCommand(f.owner, initial.id, 'message', { requestId: randomUUID(), revision: initial.revision, text: 'Why did the batch fail?' });
    const reply = await settle(f.owner, initial.id);
    expect(reply.status).toBe('needs_attention');
    expect(reply.messages.at(-1).role).toBe('assistant');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(approve).not.toHaveBeenCalled();
    expect(reply.run.steps.map(step => step.name)).toEqual(['model_call', 'decision_saved']);
    await authoringCommand(f.owner, initial.id, 'retry', { requestId: randomUUID(), revision: reply.revision });
    const resumed = await settle(f.owner, initial.id);
    expect(resumed.run.checkpoint).toBe('dispatch_retry');
    expect(complete).toHaveBeenCalledTimes(1);
    assistant.status = 'awaiting_approval';
    const edited = await readAuthoringSession(f.owner, initial.id);
    expect(edited.status).toBe('awaiting_approval');
    expect(edited.error).toBe('');
    expect(edited.revision).toBe(resumed.revision + 1);
    await expect(readAuthoringSession(String(new mongoose.Types.ObjectId()), initial.id)).rejects.toMatchObject({ status: 404 });
  });

  test('persists conversation, waits for explicit approval, and deduplicates creation and approval', async () => {
    const f = await fixture();
    const created = await createAuthoringSession(f.owner, f.body);
    const plan = await settle(f.owner, created.id);
    expect(approve).not.toHaveBeenCalled();
    expect((await createAuthoringSession(f.owner, f.body)).id).toBe(plan.id);
    expect(start).toHaveBeenCalledTimes(1);
    const input = { requestId: randomUUID(), revision: plan.revision, planRevision: 1 };
    await authoringCommand(f.owner, plan.id, 'approve', input);
    const done = await settle(f.owner, plan.id);
    await authoringCommand(f.owner, plan.id, 'approve', input);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(done.versions).toHaveLength(1);
    expect(done.messages[0].text).toBe(f.body.instructions);
    await expect(readAuthoringSession(String(new mongoose.Types.ObjectId()), plan.id)).rejects.toMatchObject({ status: 404 });
  });
  test('produces a single-question candidate, accepts atomically, then restores the initial course snapshot', async () => {
    const f = await fixture(); const initial = await ready(f);
    const initialContent = await Content.findOne({ lumiContentId: initial.versions[0].contentId });
    const originalQuiz = await Quiz.findById(f.quiz._id).populate('questions').populate('learningObjectives');
    expect(initialContent.sourceFingerprint).toBe(buildH5PSourceFingerprint(originalQuiz));
    complete.mockResolvedValue({ content: JSON.stringify({ action: 'revise_question', reply: 'I can revise question one.', questionIndex: 1 }) });
    generate.mockResolvedValue({ success: true, questionData: { questionText: 'Revised first question?',
      options: [{ text: 'Water', isCorrect: true }, { text: 'Rock', isCorrect: false }], correctAnswer: 'Water', explanation: 'Water evaporates.' } });
    await authoringCommand(f.owner, initial.id, 'message', { requestId: randomUUID(), revision: initial.revision, text: 'Make question 1 simpler.' });
    const proposed = await settle(f.owner, initial.id);
    expect(proposed.error).toBe('');
    expect(proposed.currentVersionId).toBe(initial.currentVersionId);
    const candidate = proposed.versions.find(v => v.id === proposed.candidateVersionId);
    expect(candidate.questions[1].text).toBe('Original question 2?');
    expect((await Quiz.findById(f.quiz._id).populate('questions')).questions[0].questionText).toBe('Original question 1?');
    await authoringCommand(f.owner, initial.id, 'accept', { requestId: randomUUID(), revision: proposed.revision, versionId: candidate.id });
    const accepted = await settle(f.owner, initial.id);
    expect(accepted.error).toBe(''); expect(accepted.currentVersionId).toBe(candidate.id);
    const publishedContent = await Content.findOne({ lumiContentId: candidate.contentId });
    expect(publishedContent.sourceFingerprint).toBe(buildH5PSourceFingerprint(await Quiz.findById(f.quiz._id).populate('questions').populate('learningObjectives')));
    expect((await Quiz.findById(f.quiz._id).populate('questions')).questions[0].questionText).toBe('Revised first question?');
    await authoringCommand(f.owner, initial.id, 'restore', { requestId: randomUUID(), revision: accepted.revision, versionId: initial.currentVersionId });
    const restored = await settle(f.owner, initial.id);
    expect(restored.error).toBe(''); expect(restored.versions).toHaveLength(3);
    expect((await Quiz.findById(f.quiz._id).populate('questions')).questions.map(q => q.questionText)).toEqual(['Original question 1?', 'Original question 2?']);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  test('preserves a concurrent course edit when accepting a candidate', async () => {
    const f = await fixture(); const initial = await ready(f);
    const base = await Version.findById(initial.currentVersionId);
    const candidate = await Version.create({ owner: f.owner, sessionId: initial.id, runId: new mongoose.Types.ObjectId(),
      number: 2, parentId: base._id, representation: 'course-linked', contentId: base.contentId, snapshot: base.snapshot, title: 'Proposal' });
    await Session.updateOne({ _id: initial.id }, { $set: { candidateVersionId: candidate._id } });
    await Question.updateOne({ _id: f.questions[0]._id }, { $set: { questionText: 'Teacher edit outside Studio' } });
    await authoringCommand(f.owner, initial.id, 'accept', { requestId: randomUUID(), revision: initial.revision, versionId: String(candidate._id) });
    const result = await settle(f.owner, initial.id);
    expect(result.status).toBe('needs_attention'); expect(result.currentVersionId).toBe(initial.currentVersionId);
    expect(result.error).toMatch(/edited elsewhere/);
  });
  test('marks an expired model call interrupted without replaying it, and recovers admitted commands', async () => {
    const f = await fixture(); const initial = await ready(f);
    const run = await Run.create({ owner: f.owner, sessionId: initial.id, requestId: randomUUID(), kind: 'message',
      status: 'running', admitted: true, checkpoint: 'model_call', leaseToken: 'old', leaseUntil: new Date(0) });
    await Session.updateOne({ _id: initial.id }, { $set: { activeRunId: run._id, status: 'working' } });
    await tickAuthoringWorker();
    expect((await Run.findById(run._id)).status).toBe('interrupted');
    expect(complete).not.toHaveBeenCalled();
  });
  test('stops material waiting before generation and repairs an admitted command acknowledgement gap', async () => {
    const f = await fixture();
    await Material.updateOne({ _id: f.material._id }, { $set: { processingStatus: 'pending' } });
    const created = await createAuthoringSession(f.owner, f.body);
    await cancelAuthoringRun(f.owner, created.id, { revision: created.revision });
    const stopped = await settle(f.owner, created.id);
    expect(stopped.run.status).toBe('cancelled');
    expect(start).not.toHaveBeenCalled();
    await Material.updateOne({ _id: f.material._id }, { $set: { processingStatus: 'completed' } });
    const run = await Run.create({ owner: f.owner, sessionId: created.id, requestId: randomUUID(),
      kind: 'create', status: 'queued', admitted: false, input: {} });
    await Session.updateOne({ _id: created.id }, { $set: { activeRunId: run._id } });
    const recovered = await settle(f.owner, created.id);
    expect(recovered.status).toBe('awaiting_approval');
    expect((await Run.findById(run._id)).admitted).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });
  test('recovers persisted model output without another paid call', async () => {
    const f = await fixture(); const initial = await ready(f);
    const base = await Version.findById(initial.currentVersionId);
    const old = await Run.create({ owner: f.owner, sessionId: initial.id, requestId: randomUUID(), kind: 'message',
      status: 'failed', admitted: true, checkpoint: 'output_saved', input: { text: 'Revise question 1' },
      result: { snapshot: base.snapshot, representation: 'course-linked', changes: ['Recovered generated question.'] } });
    await Session.updateOne({ _id: initial.id }, { $set: { activeRunId: old._id, status: 'needs_attention' } });
    await authoringCommand(f.owner, initial.id, 'retry', { requestId: randomUUID(), revision: initial.revision });
    const recovered = await settle(f.owner, initial.id);
    expect(recovered.error).toBe(''); expect(recovered.candidateVersionId).toBeTruthy();
    expect(complete).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  test('detects a course blueprint change even when H5P question text is unchanged', async () => {
    const f = await fixture(); const initial = await ready(f);
    const base = await Version.findById(initial.currentVersionId);
    const proposal = await Version.create({ owner: f.owner, sessionId: initial.id, runId: new mongoose.Types.ObjectId(),
      number: 2, parentId: base._id, representation: 'course-linked', contentId: base.contentId, snapshot: base.snapshot });
    await Session.updateOne({ _id: initial.id }, { $set: { candidateVersionId: proposal._id } });
    await Quiz.updateOne({ _id: f.quiz._id }, { $set: { 'settings.planMode': 'ai-auto' } });
    await authoringCommand(f.owner, initial.id, 'accept', { requestId: randomUUID(), revision: initial.revision, versionId: String(proposal._id) });
    expect((await settle(f.owner, initial.id)).error).toMatch(/edited elsewhere/);
  });
  test('manual editor saves create immutable native versions and reject stale editor writes', async () => {
    const f = await fixture(); const initial = await ready(f);
    const content = await Content.findOne({ lumiContentId: initial.versions[0].contentId });
    const original = structuredClone(assets.get(content.lumiContentId));
    const normalized = { library: original.library, parameters: { content: [{ text: 'Manual edit' }] }, metadata: { title: 'Manually edited' }, title: 'Manually edited' };
    const saved = await saveManualVersion(content, normalized, { id: f.owner });
    expect(saved.result.id).not.toBe(content.lumiContentId);
    expect(assets.get(content.lumiContentId)).toEqual(original);
    expect((await readAuthoringSession(f.owner, initial.id)).versions[0].representation).toBe('native-fork');
    expect((await saveManualVersion(content, normalized, { id: f.owner })).result.id).toBe(saved.result.id);
    await expect(saveManualVersion(content, { ...normalized, title: 'Other edit' }, { id: f.owner })).rejects.toMatchObject({ status: 409 });
  });
});
