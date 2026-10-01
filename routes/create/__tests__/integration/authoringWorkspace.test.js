import { beforeAll, afterAll, beforeEach, describe, test, expect, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
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
const assess = jest.fn();
jest.unstable_mockModule('../../services/authoring/authoringRequirements.js', () => ({
  assessAuthoringRequirements: assess,
  effectiveTeachingBrief: (session, answers = session.requirementAnswers || []) => [session.instructions, ...answers.map(answer => answer.text)].join('\n\n')
}));
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
const { authoringOperation, withAuthoringOperations } = await import('../../services/authoring/authoringOperations.js');
const { default: sse } = await import('../../services/sseService.js');
const { streamAuthoringSession } = await import('../../services/authoring/authoringStream.js');
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
  assess.mockReset().mockResolvedValue({ ready: true, reply: 'The brief is clear.', clarification: [] });
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
  test('SSE snapshots enforce ownership, reconnect without paid work, and stop reading on disconnect', async () => {
    const f = await fixture(); const session = await createAuthoringSession(f.owner, f.body);
    const response = () => Object.assign(new EventEmitter(), { req: { headers: {} }, writeHead: jest.fn(),
      flushHeaders: jest.fn(), write: jest.fn(() => true), end() { this.emit('close'); } });
    const foreign = response();
    await expect(streamAuthoringSession({ user: { id: String(new mongoose.Types.ObjectId()) }, params: { id: session.id } }, foreign))
      .rejects.toMatchObject({ status: 404 });
    expect(foreign.writeHead).not.toHaveBeenCalled();
    const before = complete.mock.calls.length;
    for (let i = 0; i < 2; i++) {
      const res = response();
      const read = jest.fn(readAuthoringSession);
      await streamAuthoringSession({ user: { id: f.owner }, params: { id: session.id } }, res, { read, intervalMs: 5 });
      expect(res.write.mock.calls.some(([text]) => text.includes('event: authoring-snapshot'))).toBe(true);
      res.end();
      await new Promise(resolve => setTimeout(resolve, 15));
      expect(read).toHaveBeenCalledTimes(1);
    }
    expect(complete).toHaveBeenCalledTimes(before);
    await settle(f.owner, session.id);
  });
  test('rejects a foreign learning object before requirements assessment or paid planning', async () => {
    const f = await fixture();
    const foreign = await Quiz.create({ name: 'Foreign', folder: f.folder._id, createdBy: new mongoose.Types.ObjectId() });
    await expect(createAuthoringSession(f.owner, { ...f.body, requestId: randomUUID(), quizId: String(foreign._id) }))
      .rejects.toMatchObject({ status: 404 });
    expect(assess).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  test('asks for teaching choices before planning, then keeps the answers and waits for plan approval', async () => {
    const f = await fixture();
    const clarification = [{ question: 'How many questions?', options: ['One', 'Three'] }];
    assess.mockResolvedValueOnce({ ready: false, reply: 'Please choose the size of your practice activity.', clarification });
    const created = await createAuthoringSession(f.owner, f.body);
    const waiting = await settle(f.owner, created.id);
    expect(waiting.status).toBe('awaiting_requirements');
    expect(waiting.assistant).toBeNull();
    expect(waiting.messages.at(-1).clarification).toEqual(clarification);
    expect(start).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect((await createAuthoringSession(f.owner, f.body)).id).toBe(created.id);
    expect(assess).toHaveBeenCalledTimes(1);
    const answer = { requestId: randomUUID(), revision: waiting.revision, text: 'One introductory multiple-choice practice question, with feedback.' };
    await authoringCommand(f.owner, waiting.id, 'message', answer);
    const planned = await settle(f.owner, waiting.id);
    expect(planned.error).toBe('');
    expect(planned.status).toBe('awaiting_approval');
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][1].instructions).toContain(f.body.instructions);
    expect(start.mock.calls[0][1].instructions).toContain(answer.text);
    expect(approve).not.toHaveBeenCalled();
    await authoringCommand(f.owner, waiting.id, 'message', answer);
    expect(assess).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect((await Session.findById(waiting.id)).requirementAnswers.map(a => a.text)).toEqual([answer.text]);
  });

  test('requires plan approval for a new conversation even with a stale automatic-draft client', async () => {
    const f = await fixture();
    const created = await createAuthoringSession(f.owner, { ...f.body, autoApprove: true });
    const result = await settle(f.owner, created.id);
    expect(result.status).toBe('awaiting_approval');
    expect(assess).toHaveBeenCalledTimes(1);
    expect(approve).not.toHaveBeenCalled();
  });

  test('resumes planning after confirmed intake without replaying the answer as a paid modification', async () => {
    const f = await fixture();
    assess.mockResolvedValueOnce({ ready: false, reply: 'Choose a count.', clarification: [{ question: 'Count?', options: ['One', 'Three'] }] });
    const created = await createAuthoringSession(f.owner, f.body);
    const waiting = await settle(f.owner, created.id);
    await authoringCommand(f.owner, waiting.id, 'message', { requestId: randomUUID(), revision: waiting.revision, text: 'One introductory practice question.' });
    let dispatched;
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      dispatched = await readAuthoringSession(f.owner, waiting.id);
      if (dispatched.assistant && dispatched.run.status === 'waiting') break;
    }
    expect(dispatched.assistant).toBeTruthy();
    expect(dispatched.run.status).toBe('waiting');
    await Run.updateOne({ _id: dispatched.run.id }, { $set: { status: 'interrupted' } });
    await Session.updateOne({ _id: waiting.id }, { $set: { status: 'needs_attention' } });
    await authoringCommand(f.owner, waiting.id, 'retry', { requestId: randomUUID(), revision: dispatched.revision });
    const resumed = await settle(f.owner, waiting.id);
    expect(resumed.error).toBe('');
    expect(resumed.status).toBe('awaiting_approval');
    expect(assess).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });
  test('saves owner-visible clarification choices without changing the plan or approving generation', async () => {
    const f = await fixture();
    const created = await createAuthoringSession(f.owner, f.body);
    const initial = await settle(f.owner, created.id);
    const clarification = [{ question: 'How many questions?', options: ['One', 'Five'] }];
    complete.mockResolvedValue({ content: JSON.stringify({ action: 'reply', reply: 'These counts conflict. Please choose.', clarification }) });
    await authoringCommand(f.owner, initial.id, 'message', { requestId: randomUUID(), revision: initial.revision, text: 'Use exactly one and exactly five questions.' });
    const replied = await settle(f.owner, initial.id);
    expect(replied.status).toBe('awaiting_approval');
    expect(replied.messages.at(-1).clarification).toEqual(clarification);
    expect((await readAuthoringSession(f.owner, initial.id)).messages.at(-1).clarification).toEqual(clarification);
    expect(replied.assistant.plan).toEqual(initial.assistant.plan);
    expect(approve).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    await expect(readAuthoringSession(String(new mongoose.Types.ObjectId()), initial.id)).rejects.toMatchObject({ status: 404 });
  });
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
  test('applies a single-question type and difficulty change only after proposal acceptance', async () => {
    const f = await fixture(); const initial = await ready(f);
    const originalVersion = await Version.findById(initial.currentVersionId).lean();
    complete.mockResolvedValue({ content: JSON.stringify({ action: 'revise_question', reply: 'Convert question 1.', questionIndex: 1,
      questionType: 'true-false', difficulty: 'easy' }) });
    generate.mockResolvedValue({ success: true, questionData: { questionText: 'Water can evaporate.',
      options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }], correctAnswer: 'True', explanation: 'Water changes to vapour.' } });
    await authoringCommand(f.owner, initial.id, 'message', { requestId: randomUUID(), revision: initial.revision, text: 'Convert only question 1 to an easy true/false question.' });
    const proposed = await settle(f.owner, initial.id);
    expect(proposed.error).toBe('');
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ questionType: 'true-false', difficulty: 'easy', selectionMode: 'single' }));
    const candidate = await Version.findById(proposed.candidateVersionId).lean();
    expect(candidate.snapshot.questions[0]).toMatchObject({ type: 'true-false', difficulty: 'easy', correctAnswer: 'True' });
    expect(candidate.snapshot.questions[1]).toEqual(originalVersion.snapshot.questions[1]);
    expect((await Quiz.findById(f.quiz._id).populate('questions')).questions[0].type).toBe('multiple-choice');
    await authoringCommand(f.owner, initial.id, 'accept', { requestId: randomUUID(), revision: proposed.revision, versionId: String(candidate._id) });
    const accepted = await settle(f.owner, initial.id);
    expect(accepted.error).toBe('');
    expect((await Quiz.findById(f.quiz._id).populate('questions')).questions[0]).toMatchObject({ type: 'true-false', difficulty: 'easy' });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  test('retains multiple-answer mode and difficulty during an unchanged-type wording revision', async () => {
    const f = await fixture();
    await Question.updateOne({ _id: f.questions[0]._id }, { $set: { 'content.selectionMode': 'multiple' } });
    const initial = await ready(f);
    complete.mockResolvedValue({ content: JSON.stringify({ action: 'revise_question', reply: 'Simplify wording.', questionIndex: 1 }) });
    generate.mockResolvedValue({ success: true, questionData: { questionText: 'Choose examples of evaporation.',
      content: { selectionMode: 'multiple', options: [{ text: 'Drying water', isCorrect: true }, { text: 'Drying clothes', isCorrect: true }, { text: 'Freezing water', isCorrect: false }] },
      correctAnswer: 'Drying water; Drying clothes', explanation: 'Both examples involve liquid becoming gas.' } });
    await authoringCommand(f.owner, initial.id, 'message', { requestId: randomUUID(), revision: initial.revision, text: 'Simplify only the wording of question 1. Keep its answer mode and difficulty.' });
    const proposed = await settle(f.owner, initial.id);
    expect(proposed.error).toBe('');
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ questionType: 'multiple-choice', difficulty: 'moderate', selectionMode: 'multiple' }));
    const candidate = await Version.findById(proposed.candidateVersionId).lean();
    expect(candidate.snapshot.questions[0].content.selectionMode).toBe('multiple');
  });
  test('refuses unsupported question conversion before any generation or course mutation', async () => {
    const f = await fixture(); const initial = await ready(f);
    complete.mockResolvedValue({ content: JSON.stringify({ action: 'revise_question', reply: 'Convert it.', questionIndex: 1, questionType: 'invented-type' }) });
    await authoringCommand(f.owner, initial.id, 'message', { requestId: randomUUID(), revision: initial.revision, text: 'Change question 1 to an unavailable type.' });
    const result = await settle(f.owner, initial.id);
    expect(result.run.status).toBe('failed');
    expect(result.candidateVersionId).toBeFalsy();
    expect(result.currentVersionId).toBe(initial.currentVersionId);
    expect(generate).not.toHaveBeenCalled();
    expect((await Quiz.findById(f.quiz._id).populate('questions')).questions[0].questionText).toBe('Original question 1?');
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
  test.each(['model_call', 'clarify_requirements'])('marks an expired %s interrupted without replaying paid work', async checkpoint => {
    const f = await fixture(); const initial = await ready(f);
    const run = await Run.create({ owner: f.owner, sessionId: initial.id, requestId: randomUUID(), kind: 'message',
      status: 'running', admitted: true, checkpoint, leaseToken: 'old', leaseUntil: new Date(0) });
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
    expect(recovered.error).toBe('');
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

 test('text-only conversations get stable draft storage and no fabricated material selection', async () => {
   const owner = String(new mongoose.Types.ObjectId());
   const body = { requestId: randomUUID(), instructions: 'Brainstorm two introductory mechanics objectives and one practice question.' };
   const created = await createAuthoringSession(owner, body);
   const planned = await settle(owner, created.id);
   expect(planned.error).toBe('');
   expect(planned.status).toBe('awaiting_approval');
   expect(planned.materialIds).toEqual([]);
   expect(start.mock.calls[0][1]).toMatchObject({ promptBased: true, canonicalObjectives: false, materialIds: [] });
   expect((await createAuthoringSession(owner, body)).id).toBe(created.id);
   expect(await Folder.countDocuments({ instructor: owner })).toBe(1);
   expect(approve).not.toHaveBeenCalled();
 });
 test('owned objective context is available to clarification and cross-owner references are rejected', async () => {
   const f = await fixture();
   const loId = String(f.quiz.learningObjectives[0] || (await Objective.findOne({ quiz: f.quiz._id }))._id);
   const body = { requestId: randomUUID(), objectiveIds: [loId], instructions: 'Use this objective for a first-year practice activity.' };
   const created = await createAuthoringSession(f.owner, body);
   await settle(f.owner, created.id);
   expect(assess.mock.calls[0][0].instructions).toContain('Explain evaporation.');
   expect(start.mock.calls[0][1].objectiveIds).toEqual([loId]);
   await expect(createAuthoringSession(String(new mongoose.Types.ObjectId()), { ...body, requestId: randomUUID() })).rejects.toMatchObject({ status: 404 });
 });
 test('adding material after brainstorming creates a fresh grounded proposal before approval', async () => {
   const f = await fixture();
   const created = await createAuthoringSession(f.owner, { requestId: randomUUID(), instructions: 'Brainstorm introductory water objectives.' });
   const draft = await settle(f.owner, created.id);
   await authoringCommand(f.owner, created.id, 'message', { requestId: randomUUID(), revision: draft.revision, text: 'Now ground this in my notes.', context: { courseId: String(f.folder._id), materialIds: [String(f.material._id)], objectiveIds: [], contextCourse: false } });
   const grounded = await settle(f.owner, created.id);
   expect(grounded.error).toBe('');
   expect(grounded.status).toBe('awaiting_approval');
   expect(start).toHaveBeenCalledTimes(2);
   expect(start.mock.calls[1][1]).toMatchObject({ canonicalObjectives: true, promptBased: false });
   expect(start.mock.calls[1][1].requestId).not.toBe(start.mock.calls[0][1].requestId);
   expect(approve).not.toHaveBeenCalled();
 });

test('operation boundaries persist nested success/failure and stream only to the authorized session', async () => {
  const f = await fixture(); const created = await createAuthoringSession(f.owner, f.body);
  const session = await settle(f.owner, created.id);
  const res = Object.assign(new EventEmitter(), { req: { headers: {} }, writeHead: jest.fn(), flushHeaders: jest.fn(), write: jest.fn(() => true), end() { this.emit('close'); } });
  const before = sse.listenerCount('authoring-operation');
  await streamAuthoringSession({ user: { id: f.owner }, params: { id: session.id } }, res, { intervalMs: 10000 });
  const run = await Run.findById(session.run.id);
  try {
    await withAuthoringOperations(run, () => authoringOperation('parent', 'Outer operation', async () => {
      await expect(authoringOperation('child', 'Inner operation', async () => { throw new Error('fixture failure'); })).rejects.toThrow('fixture failure');
    }));
    const saved = await readAuthoringSession(f.owner, session.id);
    const parent = saved.operations.find(item => item.name === 'parent');
    const child = saved.operations.find(item => item.name === 'child');
    expect(parent.status).toBe('completed'); expect(child.status).toBe('failed');
    expect(child.parentId).toBe(parent.id); expect(parent.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.write.mock.calls.some(([text]) => text.includes('event: authoring-operation'))).toBe(true);
    res.write.mockClear();
    sse.emit('authoring-operation', { owner: 'foreign', sessionId: session.id, operation: parent });
    sse.emit('authoring-operation', { owner: f.owner, sessionId: 'foreign', operation: parent });
    expect(res.write).not.toHaveBeenCalled();
  } finally { res.end(); }
  expect(sse.listenerCount('authoring-operation')).toBe(before);
});
