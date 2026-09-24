import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import request from 'supertest';
import Quiz from '../../models/Quiz.js';
import Question from '../../models/Question.js';
import LearningObjective from '../../models/LearningObjective.js';
import Material from '../../models/Material.js';
import '../../models/User.js';
import Job from '../../models/QuestionGenerationJob.js';
import questionGenerationJobs, { createQuestionJobService, serializeQuestionJob } from '../../services/questionGenerationJobs.js';
import { beginQuestionMutation } from '../../services/questionPublication.js';

dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });
process.env.RAG_SKIP_AUTO_INIT = 'true';
const { default: questionsRouter } = await import('../../controllers/questionController.js');
const { default: coverageRouter } = await import('../../controllers/coverageMapController.js');
const { default: streamingRouter } = await import('../../controllers/streamingController.js');
const { default: objectiveRouter } = await import('../../controllers/objectiveController.js');
const { default: planRouter } = await import('../../controllers/planController.js');
const { default: sseService } = await import('../../services/sseService.js');
const { default: llmService } = await import('../../services/llmService.js');
const { default: coursePromptService } = await import('../../services/coursePromptService.js');
const { default: questionMemoryService } = await import('../../services/questionMemoryService.js');

// Run with a Jest config that does NOT load the repository integration setup.
// This suite creates and drops only its own fresh, randomly named database.
const databaseName = `tlef_qa_question_jobs_${randomUUID().replaceAll('-', '')}`;
const services = [];
const gates = [];
let connected = false;
const configs = [{ questionType: 'multiple-choice', customPrompt: 'Synthetic private teaching premise.', useCustomPromptOnly: true }];
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.isAuthenticated = () => Boolean(req.headers['x-test-owner']);
  req.user = req.headers['x-test-owner'] ? { _id: req.headers['x-test-owner'], cwlId: 'isolated-qa' } : null;
  next();
});
app.use('/questions', questionsRouter);
app.use('/coverage', coverageRouter);
app.use('/streaming', streamingRouter);
app.use('/objectives', objectiveRouter);
app.use('/plans', planRouter);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'ERROR', message: error.message } }));

function service(options = {}) {
  const instance = createQuestionJobService({ heartbeatMs: 1_000_000, ...options });
  services.push(instance);
  return instance;
}
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  gates.push(resolve);
  return { promise, resolve };
}
async function until(condition) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Synthetic generation did not reach its expected state.');
}
async function fixture() {
  const owner = new mongoose.Types.ObjectId();
  const quiz = await Quiz.create({ name: 'Isolated receipt QA', folder: new mongoose.Types.ObjectId(), createdBy: owner });
  const objective = await LearningObjective.create({ text: 'Explain the synthetic example.', quiz: quiz._id, createdBy: owner, order: 0 });
  const question = await Question.create({ quiz: quiz._id, createdBy: owner, learningObjective: objective._id,
    type: 'multiple-choice', difficulty: 'moderate', questionText: 'Original published question',
    correctAnswer: 'Yes', content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] }, order: 0 });
  await Quiz.updateOne({ _id: quiz._id }, { $set: { questions: [question._id], learningObjectives: [objective._id] } });
  return { owner, quizId: quiz._id, question, objective };
}
async function stage({ job, assertActive, updateItem }, owner, quizId, options = {}) {
  for (const item of job.items) {
    await updateItem(item.index, { status: 'generating' });
    if (options.failIndex === item.index) {
      await updateItem(item.index, { status: 'failed', code: 'QUESTION_GENERATION_FAILED', message: 'Synthetic provider failure.' });
      continue;
    }
    await assertActive();
    await Question.create({ _id: item.savedQuestionId, generationJob: job._id, quiz: quizId, createdBy: owner,
      learningObjective: options.objectiveId, type: 'multiple-choice', difficulty: 'moderate',
      questionText: `New candidate ${item.index + 1}`, correctAnswer: 'Yes',
      content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] }, order: item.index });
    await updateItem(item.index, { status: 'ready' });
  }
}

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', { dbName: databaseName, serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== databaseName) throw new Error('Refusing to use a non-isolated database.');
  connected = true;
  await Promise.all([Job.init(), Quiz.init(), Question.init()]);
}, 30000);
afterEach(async () => {
  if (!connected) return;
  for (const release of gates.splice(0)) release();
  await Promise.all(services.splice(0).map(instance => instance.waitForIdle()));
  await Promise.all([Job.deleteMany({}), Question.deleteMany({}), Quiz.deleteMany({}), LearningObjective.deleteMany({}), Material.deleteMany({})]);
  sseService.sessionOwners.clear();
});
afterAll(async () => {
  if (mongoose.connection.name === databaseName && databaseName.startsWith('tlef_qa_question_jobs_')) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  jest.restoreAllMocks();
});

describe('durable question generation and atomic publication on standalone MongoDB', () => {
  test('publishing another batch reopens instructor review', async () => {
    const f = await fixture();
    await Quiz.updateOne({ _id: f.quizId }, { $set: { 'progress.reviewCompleted': true } });
    const jobs = service();
    const requestId = randomUUID();
    await jobs.start({ ...f, requestId, questionConfigs: configs,
      work: context => stage(context, f.owner, f.quizId) });
    await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('succeeded');
    expect((await Quiz.findById(f.quizId)).progress.reviewCompleted).toBe(false);
  });

  test('upgrades beside a legacy ordinary quiz_1 index without removing it and supports recovery plus fenced admission', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const collectionName = `legacy_question_jobs_${suffix}`;
    await mongoose.connection.db.collection(collectionName).createIndex({ quiz: 1 }, { name: 'quiz_1' });
    const LegacyJob = mongoose.connection.model(`LegacyQuestionGenerationJob${suffix}`, Job.schema, collectionName);
    await LegacyJob.init();
    const indexes = await LegacyJob.collection.indexes();
    expect(indexes.find(index => index.name === 'quiz_1')).toMatchObject({ key: { quiz: 1 } });
    expect(indexes.find(index => index.name === 'quiz_1').unique).toBeUndefined();
    expect(indexes.find(index => index.name === 'question_generation_active_quiz')).toMatchObject({
      key: { quiz: 1 }, unique: true, partialFilterExpression: { active: true }
    });
    const f = await fixture(); const jobs = service({ JobModel: LegacyJob }); const requestId = randomUUID();
    const closed = await jobs.abandon({ ...f, requestId });
    expect(closed).toMatchObject({ abandoned: true, active: false, status: 'interrupted' });
    const work = jest.fn(context => stage(context, f.owner, f.quizId));
    await expect(jobs.start({ ...f, requestId, questionConfigs: configs, work })).rejects.toMatchObject({ code: 'GENERATION_REQUEST_ABANDONED' });
    expect(work).not.toHaveBeenCalled();
    const hold = gate(); const acceptedId = randomUUID();
    await jobs.start({ ...f, requestId: acceptedId, questionConfigs: configs, work: async context => { await hold.promise; await work(context); } });
    await expect(jobs.start({ ...f, requestId: randomUUID(), questionConfigs: configs, work })).rejects.toMatchObject({ code: 'QUESTION_GENERATION_BUSY' });
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, acceptedId)).status).toBe('succeeded');
    expect(work).toHaveBeenCalledTimes(1);
  });

  test.each(['start', 'abandon'])('%s logs only safe initialization diagnostics and never admits work after initialization failure', async operation => {
    const f = await fixture(); const jobs = service(); const work = jest.fn();
    const failure = Object.assign(new Error('Synthetic private prompt, URI credentials and document payload.'), { code: 86 });
    const init = jest.spyOn(Job, 'init').mockRejectedValue(failure);
    const indexes = jest.spyOn(Job.collection, 'indexes').mockResolvedValue([]);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(jobs[operation]({ ...f, requestId: randomUUID(), questionConfigs: configs, work })).rejects.toBe(failure);
      expect(log).toHaveBeenCalledWith('[QuestionGenerationJobs] Receipt storage initialization failed.', {
        code: 86, reason: 'INDEX_DEFINITION_CONFLICT'
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(failure.message);
      expect(await Job.countDocuments({ owner: f.owner })).toBe(0);
      expect(work).not.toHaveBeenCalled();
    } finally { init.mockRestore(); indexes.mockRestore(); log.mockRestore(); }
  });

  test.each(['append', 'replace'])('%s publishes only after every candidate is ready; same request never runs work twice', async mode => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    const work = jest.fn(async context => { await stage(context, f.owner, f.quizId); await hold.promise; });
    const receipt = await jobs.start({ ...f, requestId, mode, questionConfigs: configs, work });
    await until(async () => (await Job.findById(receipt._id)).items.every(item => item.status === 'ready'));
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
    const same = await jobs.start({ ...f, requestId, mode, questionConfigs: configs, work });
    expect(String(same._id)).toBe(String(receipt._id)); expect(work).toHaveBeenCalledTimes(1);
    expect(serializeQuestionJob(same).questionIds).toEqual([]);
    hold.resolve(); await jobs.waitForIdle();
    const final = await jobs.get(f.owner, requestId);
    expect(final.status).toBe('succeeded');
    const ids = (await Quiz.findById(f.quizId)).questions.map(String);
    expect(ids).toEqual(mode === 'replace' ? final.items.map(item => String(item.savedQuestionId)) : [String(f.question._id), ...final.items.map(item => String(item.savedQuestionId))]);
    const replay = await service().start({ ...f, requestId, mode, questionConfigs: configs, work });
    expect(replay.status).toBe('succeeded'); expect(work).toHaveBeenCalledTimes(1);
    expect(await Question.exists({ _id: f.question._id })).toBeTruthy();
  });

  test.each(['append', 'replace'])('%s failure retains the complete previous list and never publishes partial success', async mode => {
    const f = await fixture(); const jobs = service(); const requestId = randomUUID();
    await jobs.start({ ...f, requestId, mode, questionConfigs: [...configs, ...configs], work: context => stage(context, f.owner, f.quizId, { failIndex: 1 }) });
    await jobs.waitForIdle();
    const final = await jobs.get(f.owner, requestId);
    expect(final.status).toBe('failed');
    expect(final.items.map(item => item.status)).toEqual(['ready', 'failed']);
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
    expect(serializeQuestionJob(final).questionIds).toEqual([]);
  });

  test('simultaneous duplicate requests across service instances admit one paid execution; changed intent is rejected', async () => {
    const f = await fixture(); const first = service(); const second = service(); const hold = gate(); const requestId = randomUUID();
    const work = jest.fn(async context => { await hold.promise; await stage(context, f.owner, f.quizId); });
    const args = { ...f, requestId, mode: 'replace', questionConfigs: configs, work };
    const receipts = await Promise.all([first.start(args), second.start(args)]);
    expect(String(receipts[0]._id)).toBe(String(receipts[1]._id)); expect(work).toHaveBeenCalledTimes(1);
    await expect(second.start({ ...args, mode: 'append' })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
    await expect(second.start({ ...args, requestId: randomUUID() })).rejects.toMatchObject({ code: 'QUESTION_GENERATION_BUSY' });
    hold.resolve(); await Promise.all([first.waitForIdle(), second.waitForIdle()]);
  });

  test('restart recovery interrupts an expired receipt without replay, and a late old worker cannot replace the new batch', async () => {
    const f = await fixture(); let clock = new Date(); const now = () => clock;
    const old = service({ now }); const replacement = service({ now }); const hold = gate();
    const oldWork = jest.fn(async context => { await hold.promise; await stage(context, f.owner, f.quizId); });
    const oldRequest = randomUUID();
    const previous = await old.start({ ...f, requestId: oldRequest, mode: 'replace', questionConfigs: configs, work: oldWork });
    clock = new Date(+clock + 121_000);
    expect((await replacement.get(f.owner, oldRequest)).status).toBe('interrupted');
    expect((await replacement.start({ ...f, requestId: oldRequest, mode: 'replace', questionConfigs: configs, work: oldWork })).status).toBe('interrupted');
    const next = await replacement.start({ ...f, requestId: randomUUID(), mode: 'replace', questionConfigs: configs, work: context => stage(context, f.owner, f.quizId) });
    await replacement.waitForIdle(); hold.resolve(); await old.waitForIdle();
    expect(oldWork).toHaveBeenCalledTimes(1);
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual(next.items.map(item => String(item.savedQuestionId)));
    expect(await Question.countDocuments({ generationJob: previous._id })).toBe(0);
    expect((await Job.findById(previous._id)).status).toBe('interrupted');
  });

  test('a real question edit advances the CAS revision and preserves the edit instead of replacing it', async () => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work: async context => { await stage(context, f.owner, f.quizId); await hold.promise; } });
    const edited = await Question.findById(f.question._id); edited.questionText = 'Instructor edit during generation'; await edited.save();
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('conflict');
    expect((await Question.findById(f.question._id)).questionText).toBe('Instructor edit during generation');
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
  });

  test('an active edit lease blocks admission and prevents publication across the cross-document write window', async () => {
    const f = await fixture(); const jobs = service(); const edit = await beginQuestionMutation(Quiz, f.quizId, f.owner);
    const work = jest.fn();
    await expect(jobs.start({ ...f, requestId: randomUUID(), mode: 'replace', questionConfigs: configs, work })).rejects.toMatchObject({ code: 'QUESTION_GENERATION_BUSY' });
    expect(work).not.toHaveBeenCalled(); await edit.finish();
  });

  test('an edit whose database write returns after its lease expires cannot claim success or republish a retired question', async () => {
    const f = await fixture(); const jobs = service(); const entered = gate(); const releaseWrite = gate();
    const originalUpdate = Question.collection.updateOne.bind(Question.collection);
    const delayed = jest.spyOn(Question.collection, 'updateOne').mockImplementation(async (...args) => {
      entered.resolve(); await releaseWrite.promise; return originalUpdate(...args);
    });
    try {
      const question = await Question.findById(f.question._id); question.questionText = 'Late old edit';
      const pendingEdit = question.save().then(() => null, error => error);
      await entered.promise;
      await Quiz.updateOne({ _id: f.quizId }, { $set: { 'questionMutation.leaseUntil': new Date(Date.now() - 1000) } });
      const receipt = await jobs.start({ ...f, requestId: randomUUID(), mode: 'replace', questionConfigs: configs, work: context => stage(context, f.owner, f.quizId) });
      await jobs.waitForIdle(); expect((await jobs.get(f.owner, receipt.requestId)).status).toBe('succeeded');
      releaseWrite.resolve(); expect(await pendingEdit).toMatchObject({ code: 'QUESTION_EDIT_EXPIRED' });
      expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual(receipt.items.map(item => String(item.savedQuestionId)));
      const visible = await request(app).get(`/questions/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(JSON.stringify(visible.body)).not.toContain('Late old edit');
    } finally { releaseWrite.resolve(); delayed.mockRestore(); }
  });

  test('a changed delivery setting conflicts through Quiz version even when its question list did not change', async () => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work: async context => { await stage(context, f.owner, f.quizId); await hold.promise; } });
    const changed = await Quiz.findById(f.quizId); changed.containerMode = 'interactive-book'; await changed.save();
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('conflict');
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
  });

  test.each(['add', 'remove', 'reorder', 'delete-all', 'delete-objective', 'delete-all-objectives', 'replace-imported-objectives'])('a delayed %s manifest write is fenced at MongoDB after a newer generation publishes', async action => {
    const f = await fixture(); const jobs = service(); const entered = gate(); const releaseWrite = gate();
    const second = await Question.create({ quiz: f.quizId, createdBy: f.owner, type: 'essay', difficulty: 'moderate', questionText: 'Second published question', order: 1 });
    await Quiz.updateOne({ _id: f.quizId }, { $push: { questions: second._id } });
    const originalWrite = Quiz.collection.findOneAndUpdate.bind(Quiz.collection);
    const delayed = jest.spyOn(Quiz.collection, 'findOneAndUpdate').mockImplementation(async (...args) => {
      if (args[0]['questionMutation.token'] && (args[1].$set?.questions !== undefined || args[1].$set?.learningObjectives !== undefined || args[1].$addToSet?.questions)) {
        entered.resolve(); await releaseWrite.promise;
      }
      return originalWrite(...args);
    });
    let pending;
    try {
      const agent = request(app);
      const operation = action === 'add' ? agent.post('/questions').send({ quizId: f.quizId, type: 'essay', difficulty: 'moderate', questionText: 'Late manual addition' })
        : action === 'remove' ? agent.delete(`/questions/${f.question._id}`)
        : action === 'reorder' ? agent.put('/questions/reorder').send({ quizId: f.quizId, questionIds: [second._id, f.question._id] })
        : action === 'delete-all' ? agent.delete(`/questions/quiz/${f.quizId}`)
        : action === 'delete-objective' ? agent.delete(`/objectives/${f.objective._id}?confirmed=true`)
        : action === 'delete-all-objectives' ? agent.delete(`/objectives/quiz/${f.quizId}/all`)
        : agent.post('/objectives').send([{ quizId: f.quizId, text: 'Imported replacement' }]);
      pending = operation.set('x-test-owner', String(f.owner)).then(response => response);
      await entered.promise;
      await Quiz.updateOne({ _id: f.quizId }, { $set: { 'questionMutation.leaseUntil': new Date(Date.now() - 1000) } });
      const receipt = await jobs.start({ ...f, requestId: randomUUID(), mode: 'replace', questionConfigs: configs,
        work: context => stage(context, f.owner, f.quizId, { objectiveId: f.objective._id }) });
      await jobs.waitForIdle(); expect((await jobs.get(f.owner, receipt.requestId)).status).toBe('succeeded');
      releaseWrite.resolve(); expect((await pending).status).toBe(409);
      expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual(receipt.items.map(item => String(item.savedQuestionId)));
      expect(await Question.exists({ _id: f.question._id })).toBeTruthy();
      expect(await LearningObjective.exists({ _id: f.objective._id })).toBeTruthy();
      expect(await Question.countDocuments({ generationJob: receipt._id })).toBe(1);
      expect((await Question.findById(f.question._id)).order).toBe(0);
    } finally { releaseWrite.resolve(); if (pending) await pending; delayed.mockRestore(); }
  });

  test('imported objective replacement remains usable and rejects a mixed-owner batch before clearing existing objectives', async () => {
    const f = await fixture(); const foreign = await fixture();
    await request(app).post('/objectives').set('x-test-owner', String(f.owner)).send([
      { quizId: f.quizId, text: 'Own imported objective' }, { quizId: foreign.quizId, text: 'Foreign imported objective' }
    ]).expect(400);
    expect(await LearningObjective.exists({ _id: f.objective._id })).toBeTruthy();
    expect(await LearningObjective.exists({ _id: foreign.objective._id })).toBeTruthy();
    const response = await request(app).post('/objectives').set('x-test-owner', String(f.owner)).send([
      { quizId: f.quizId, text: 'First imported objective' }, { quizId: f.quizId, text: 'Second imported objective' }
    ]).expect(201);
    expect(response.body.data.summary).toMatchObject({ successful: 2, failed: 0 });
    expect((await Quiz.findById(f.quizId)).learningObjectives.map(String)).toEqual(response.body.data.objectives.map(objective => objective._id));
    expect(await LearningObjective.exists({ _id: f.objective._id })).toBeTruthy();
    const visible = await request(app).get(`/objectives/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
    expect(visible.body.data.objectives.map(objective => objective.text)).toEqual(['First imported objective', 'Second imported objective']);
  });

  test('a queued manifest write uses database execution time to reject an expired lease even without a competing publication', async () => {
    const f = await fixture(); const entered = gate(); const releaseWrite = gate();
    const originalWrite = Quiz.collection.findOneAndUpdate.bind(Quiz.collection);
    const delayed = jest.spyOn(Quiz.collection, 'findOneAndUpdate').mockImplementation(async (...args) => {
      if (args[0]['questionMutation.token'] && args[1].$set?.questions !== undefined) { entered.resolve(); await releaseWrite.promise; }
      return originalWrite(...args);
    });
    let pending;
    try {
      const quiz = await Quiz.findById(f.quizId);
      pending = quiz.removeQuestion(f.question._id).then(() => null, error => error);
      await entered.promise;
      await Quiz.updateOne({ _id: f.quizId }, { $set: { 'questionMutation.leaseUntil': new Date(Date.now() - 1000) } });
      releaseWrite.resolve(); expect(await pending).toMatchObject({ code: 'QUESTION_EDIT_EXPIRED' });
      expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
    } finally { releaseWrite.resolve(); if (pending) await pending; delayed.mockRestore(); }
  });

  test.each(['question', 'objective'])('a late %s order write cannot overwrite a newer completed reorder after the old lease expires', async kind => {
    const f = await fixture(); const entered = gate(); const release = gate();
    const Model = kind === 'question' ? Question : LearningObjective;
    const first = kind === 'question' ? f.question : f.objective;
    const second = kind === 'question'
      ? await Question.create({ quiz: f.quizId, createdBy: f.owner, type: 'essay', difficulty: 'moderate', questionText: 'Second reorder item', order: 1 })
      : await LearningObjective.create({ quiz: f.quizId, createdBy: f.owner, text: 'Second reorder item', order: 1 });
    const field = kind === 'question' ? 'questions' : 'learningObjectives';
    const bodyKey = kind === 'question' ? 'questionIds' : 'objectiveIds';
    const endpoint = kind === 'question' ? '/questions/reorder' : '/objectives/reorder';
    await Quiz.updateOne({ _id: f.quizId }, { $push: { [field]: second._id } });
    const write = Model.collection.findOneAndUpdate.bind(Model.collection);
    const delayed = jest.spyOn(Model.collection, 'findOneAndUpdate').mockImplementation(async (...args) => {
      if (String(args[0]._id) === String(first._id) && args[1].$set?.order === 1) {
        entered.resolve(); await release.promise;
      }
      return write(...args);
    });
    let pending;
    try {
      pending = request(app).put(endpoint).set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, [bodyKey]: [second._id, first._id] }).then(response => response);
      await entered.promise;
      await Quiz.updateOne({ _id: f.quizId }, { $set: { 'questionMutation.leaseUntil': new Date(Date.now() - 1000) } });
      // Move the queued command's deadline into the past to simulate elapsed
      // lease time while retaining a real server-side $$NOW comparison.
      const queued = delayed.mock.calls.find(args => String(args[0]._id) === String(first._id) && args[1].$set?.order === 1);
      queued[0].$expr.$lte[1] = new Date(Date.now() - 1000);
      await request(app).put(endpoint).set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, [bodyKey]: [first._id, second._id] }).expect(200);
      release.resolve(); expect((await pending).status).toBe(409);
      expect((await Quiz.findById(f.quizId))[field].map(String)).toEqual([String(first._id), String(second._id)]);
      expect((await Model.findById(first._id)).order).toBe(0);
      expect((await Model.findById(second._id)).order).toBe(1);
    } finally { release.resolve(); if (pending) await pending; delayed.mockRestore(); }
  });

  test.each(['materials', 'delivery', 'objective-text', 'objective-metadata', 'objective-order'])('admission rejects a %s change after controller validation without starting paid work', async change => {
    const f = await fixture(); const requestId = randomUUID();
    const material = await Material.create({ name: 'Synthetic completed source', type: 'text', folder: new mongoose.Types.ObjectId(), uploadedBy: f.owner, processingStatus: 'completed' });
    const quiz = await Quiz.findById(f.quizId); quiz.materials = [material._id]; await quiz.save();
    const create = Job.create.bind(Job);
    const insertion = jest.spyOn(Job, 'create').mockImplementation(async data => {
      if (data.requestId === requestId) {
        if (change === 'objective-order') await LearningObjective.reorderObjectives(f.quizId, [String(f.objective._id)]);
        else if (change.startsWith('objective-')) {
          const objective = await LearningObjective.findById(f.objective._id);
          if (change === 'objective-text') objective.text = 'A changed instructor objective';
          else objective.generationMetadata.subpoints = ['A changed scope'];
          await objective.save();
        } else {
          const changed = await Quiz.findById(f.quizId);
          if (change === 'materials') changed.materials = [];
          else changed.containerMode = 'interactive-book';
          await changed.save();
        }
      }
      return create(data);
    });
    const prompts = jest.spyOn(coursePromptService, 'buildCoursePromptInstructions').mockResolvedValue({ prompt: '' });
    const model = jest.spyOn(llmService, 'generateQuestionStreaming').mockRejectedValue(new Error('Paid work must not be reached.'));
    try {
      const response = await request(app).post('/streaming/generate-questions').set('x-test-owner', String(f.owner)).send({
        quizId: f.quizId, requestId, mode: 'replace', questionConfigs: [{ questionType: 'multiple-choice', learningObjectiveId: String(f.objective._id) }]
      }).expect(409);
      expect(response.body.error.code).toBe('GENERATION_SNAPSHOT_CHANGED');
      const receipt = await Job.findOne({ owner: f.owner, requestId });
      expect(receipt.status).toBe('conflict'); expect(receipt.active).toBe(false);
      expect(prompts).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
      expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
    } finally { insertion.mockRestore(); prompts.mockRestore(); model.mockRestore(); }
  });

  test('an actual objective edit invalidates an already running question batch and preserves the changed teaching goal', async () => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs,
      work: async context => { await stage(context, f.owner, f.quizId); await hold.promise; } });
    await request(app).put(`/objectives/${f.objective._id}`).set('x-test-owner', String(f.owner)).send({ text: 'Explain a different instructor goal.' }).expect(200);
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('conflict');
    expect((await LearningObjective.findById(f.objective._id)).text).toBe('Explain a different instructor goal.');
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
  });

  test('an objective database write delayed beyond its lease cannot change the goal after new questions publish', async () => {
    const f = await fixture(); const jobs = service(); const entered = gate(); const release = gate();
    const write = LearningObjective.collection.updateOne.bind(LearningObjective.collection);
    const delayed = jest.spyOn(LearningObjective.collection, 'updateOne').mockImplementation(async (...args) => {
      entered.resolve(); await release.promise; return write(...args);
    });
    let pending;
    try {
      const objective = await LearningObjective.findById(f.objective._id); objective.text = 'Late changed goal';
      pending = objective.save().then(() => null, error => error);
      await entered.promise;
      await Quiz.updateOne({ _id: f.quizId }, { $set: { 'questionMutation.leaseUntil': new Date(Date.now() - 1000) } });
      // Expire the deadline already attached to the delayed MongoDB command.
      // This simulates elapsed lease time without waiting a real minute.
      delayed.mock.calls[0][0].$expr.$lte[1] = new Date(Date.now() - 1000);
      const receipt = await jobs.start({ ...f, requestId: randomUUID(), mode: 'replace', questionConfigs: configs,
        work: context => stage(context, f.owner, f.quizId, { objectiveId: f.objective._id }) });
      await jobs.waitForIdle(); expect((await jobs.get(f.owner, receipt.requestId)).status).toBe('succeeded');
      release.resolve(); expect(await pending).toMatchObject({ code: 'QUESTION_EDIT_EXPIRED' });
      expect((await LearningObjective.findById(f.objective._id)).text).toBe(f.objective.text);
    } finally { release.resolve(); if (pending) await pending; delayed.mockRestore(); }
  });

  test.each(['late-manifest', 'changed-during-model'])('AI objective replacement preserves published content when %s invalidates its snapshot', async race => {
    const f = await fixture(); const jobs = service(); const entered = gate(); const release = gate();
    const quiz = await Quiz.findById(f.quizId);
    const material = await Material.create({ name: 'LO replacement source', type: 'text', folder: quiz.folder, uploadedBy: f.owner, processingStatus: 'completed' });
    const prompts = jest.spyOn(coursePromptService, 'buildCoursePromptInstructions').mockResolvedValue({ prompt: '', source: 'synthetic' });
    const model = jest.spyOn(llmService, 'generateLearningObjectives').mockImplementation(async () => {
      if (race === 'changed-during-model') { entered.resolve(); await release.promise; }
      return { objectives: [{ text: 'Replacement objective' }], llmModel: 'synthetic' };
    });
    const write = Quiz.collection.findOneAndUpdate.bind(Quiz.collection);
    const delayed = jest.spyOn(Quiz.collection, 'findOneAndUpdate').mockImplementation(async (...args) => {
      if (race === 'late-manifest' && args[0]['questionMutation.token'] && args[1].$set?.questions !== undefined) {
        entered.resolve(); await release.promise;
      }
      return write(...args);
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    let pending;
    try {
      pending = request(app).post('/objectives/generate').set('x-test-owner', String(f.owner))
        .send({ quizId: f.quizId, materialIds: [material._id], replaceExisting: true }).then(response => response);
      await entered.promise;
      let expectedIds = [String(f.question._id)];
      if (race === 'late-manifest') {
        await Quiz.updateOne({ _id: f.quizId }, { $set: { 'questionMutation.leaseUntil': new Date(Date.now() - 1000) } });
        const receipt = await jobs.start({ ...f, requestId: randomUUID(), mode: 'replace', questionConfigs: configs,
          work: context => stage(context, f.owner, f.quizId, { objectiveId: f.objective._id }) });
        await jobs.waitForIdle(); expect((await jobs.get(f.owner, receipt.requestId)).status).toBe('succeeded');
        expectedIds = receipt.items.map(item => String(item.savedQuestionId));
      } else {
        await request(app).put(`/questions/${f.question._id}`).set('x-test-owner', String(f.owner)).send({ questionText: 'Instructor edit while objectives generated' }).expect(200);
      }
      release.resolve(); expect((await pending).status).toBe(409);
      expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual(expectedIds);
      expect(await LearningObjective.exists({ _id: f.objective._id })).toBeTruthy();
      expect(await Question.exists({ _id: f.question._id })).toBeTruthy();
      const visible = await request(app).get(`/objectives/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(visible.body.data.objectives.map(objective => objective._id)).toEqual([String(f.objective._id)]);
    } finally { release.resolve(); if (pending) await pending; prompts.mockRestore(); model.mockRestore(); delayed.mockRestore(); log.mockRestore(); }
  });

  test.each([
    ['manual', 'empty-text'], ['manual', 'candidate-save-failure'], ['ai', 'empty-text'], ['ai', 'candidate-save-failure']
  ])('%s objective replacement preserves old objectives and questions on %s', async (kind, failure) => {
    const f = await fixture(); const quiz = await Quiz.findById(f.quizId);
    const material = await Material.create({ name: 'Synthetic source', type: 'text', folder: quiz.folder, uploadedBy: f.owner, processingStatus: 'completed' });
    const candidates = [{ quizId: f.quizId, text: 'First replacement candidate' },
      { quizId: f.quizId, text: failure === 'empty-text' ? '' : 'Second replacement candidate' }];
    const prompts = jest.spyOn(coursePromptService, 'buildCoursePromptInstructions').mockResolvedValue({ prompt: '', source: 'synthetic' });
    const model = jest.spyOn(llmService, 'generateLearningObjectives').mockResolvedValue({ objectives: candidates, llmModel: 'synthetic' });
    const originalSave = LearningObjective.prototype.save;
    const saving = jest.spyOn(LearningObjective.prototype, 'save').mockImplementation(function(...args) {
      if (failure === 'candidate-save-failure' && this.isNew && this.text === 'Second replacement candidate') throw new Error('Synthetic candidate save failure.');
      return originalSave.apply(this, args);
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const operation = kind === 'manual' ? request(app).post('/objectives').send(candidates)
        : request(app).post('/objectives/generate').send({ quizId: f.quizId, materialIds: [material._id], replaceExisting: true });
      await operation.set('x-test-owner', String(f.owner)).expect(kind === 'manual' && failure === 'empty-text' ? 400 : 503);
      const unchanged = await Quiz.findById(f.quizId);
      expect(unchanged.learningObjectives.map(String)).toEqual([String(f.objective._id)]);
      expect(unchanged.questions.map(String)).toEqual([String(f.question._id)]);
      expect(await LearningObjective.exists({ _id: f.objective._id })).toBeTruthy();
      expect(await Question.exists({ _id: f.question._id })).toBeTruthy();
      const visible = await request(app).get(`/objectives/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(visible.body.data.objectives.map(objective => objective._id)).toEqual([String(f.objective._id)]);
      const coverage = await request(app).get(`/coverage/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(JSON.stringify(coverage.body)).not.toContain('First replacement candidate');
      if (failure === 'empty-text') expect(await LearningObjective.countDocuments({ quiz: f.quizId })).toBe(1);
      else expect(await LearningObjective.countDocuments({ quiz: f.quizId })).toBe(2);
    } finally { prompts.mockRestore(); model.mockRestore(); saving.mockRestore(); log.mockRestore(); }
  });

  test('staged and retired objectives stay outside public reads and mutations; empty published manifest does not fall back to them', async () => {
    const f = await fixture(); const entered = gate(); const release = gate();
    const write = Quiz.collection.findOneAndUpdate.bind(Quiz.collection);
    const delayed = jest.spyOn(Quiz.collection, 'findOneAndUpdate').mockImplementation(async (...args) => {
      if (args[0]['questionMutation.token'] && args[1].$set?.learningObjectives) { entered.resolve(); await release.promise; }
      return write(...args);
    });
    let pending;
    try {
      pending = request(app).post('/objectives').set('x-test-owner', String(f.owner)).send([
        { quizId: f.quizId, text: 'Staged objective replacement' }
      ]).then(response => response);
      await entered.promise;
      const staged = await LearningObjective.findOne({ quiz: f.quizId, text: 'Staged objective replacement' });
      expect(staged).toBeTruthy();
      const before = await request(app).get(`/objectives/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(before.body.data.objectives.map(objective => objective._id)).toEqual([String(f.objective._id)]);
      const coverage = await request(app).get(`/coverage/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(JSON.stringify(coverage.body)).not.toContain(staged.text);
      await request(app).post(`/objectives/${staged._id}/regenerate`).set('x-test-owner', String(f.owner)).send({}).expect(404);
      await request(app).put(`/objectives/${staged._id}`).set('x-test-owner', String(f.owner)).send({ text: 'Unauthorized staged edit' }).expect(404);
      await request(app).post('/questions').set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, learningObjectiveId: staged._id,
        type: 'essay', difficulty: 'moderate', questionText: 'Question from unaccepted objective' }).expect(404);
      release.resolve(); expect((await pending).status).toBe(201);
      const after = await request(app).get(`/objectives/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(after.body.data.objectives.map(objective => objective._id)).toEqual([String(staged._id)]);
      await request(app).post(`/objectives/${f.objective._id}/regenerate`).set('x-test-owner', String(f.owner)).send({}).expect(404);
      await request(app).post('/objectives/enrich').set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, objectiveIds: [f.objective._id] }).expect(400);
      await Quiz.updateOne({ _id: f.quizId }, { $set: { learningObjectives: [] } });
      const emptyCoverage = await request(app).get(`/coverage/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(400);
      expect(emptyCoverage.body.error.code).toBe('NO_OBJECTIVES');
    } finally { release.resolve(); if (pending) await pending; delayed.mockRestore(); }
  });

  test.each(['add', 'reorder', 'delete'])('an actual %s request wins over an in-flight replacement without losing its change', async action => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    const second = await Question.create({ quiz: f.quizId, createdBy: f.owner, type: 'essay', difficulty: 'moderate', questionText: 'Second published question', order: 1 });
    await Quiz.updateOne({ _id: f.quizId }, { $push: { questions: second._id } });
    await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work: async context => { await stage(context, f.owner, f.quizId); await hold.promise; } });
    if (action === 'add') await request(app).post('/questions').set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, type: 'essay', difficulty: 'moderate', questionText: 'New manual question' }).expect(201);
    if (action === 'reorder') await request(app).put('/questions/reorder').set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, questionIds: [second._id, f.question._id] }).expect(200);
    if (action === 'delete') await request(app).delete(`/questions/${f.question._id}`).set('x-test-owner', String(f.owner)).expect(200);
    const afterMutation = (await Quiz.findById(f.quizId)).questions.map(String);
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('conflict');
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual(afterMutation);
  });

  test('losing the Quiz fence prevents a stale worker saving or clearing another worker lease', async () => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    const receipt = await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work: async context => { await hold.promise; await stage(context, f.owner, f.quizId); } });
    await Quiz.updateOne({ _id: f.quizId }, { $set: { 'questionGenerationLease.token': 'new-owner-fence' } });
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('interrupted');
    expect(await Question.countDocuments({ generationJob: receipt._id })).toBe(0);
    expect((await Quiz.findById(f.quizId)).questionGenerationLease.token).toBe('new-owner-fence');
  });

  test('publication with a lost acknowledgement is recovered as success instead of replayed or reported failed', async () => {
    const f = await fixture(); const jobs = service(); const requestId = randomUUID();
    const originalUpdate = Quiz.updateOne.bind(Quiz);
    const update = jest.spyOn(Quiz, 'updateOne').mockImplementation((filter, operation, ...args) => {
      const result = originalUpdate(filter, operation, ...args);
      return operation.$set?.lastQuestionGenerationJob ? result.then(() => { throw new Error('Synthetic lost commit response'); }) : result;
    });
    try {
      await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work: context => stage(context, f.owner, f.quizId) });
      await jobs.waitForIdle(); expect((await service().get(f.owner, requestId)).status).toBe('succeeded');
    } finally { update.mockRestore(); }
  });

  test('receipts and SSE enforce owner plus quiz ownership and never disclose prompts, source text, or lease tokens', async () => {
    const f = await fixture(); const foreign = new mongoose.Types.ObjectId(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    const receipt = await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work: async context => { await hold.promise; await stage(context, f.owner, f.quizId); } });
    expect(await jobs.get(foreign, requestId)).toBeNull(); expect(await jobs.list(foreign, f.quizId)).toBeNull();
    await expect(jobs.start({ ...f, owner: foreign, requestId: randomUUID(), mode: 'replace', questionConfigs: configs, work: jest.fn() })).rejects.toMatchObject({ status: 404 });
    const visible = serializeQuestionJob(receipt); const stored = (await Job.findById(receipt._id)).toObject();
    expect(JSON.stringify(visible)).not.toContain(receipt.leaseToken); expect(JSON.stringify(visible)).not.toContain(receipt.requestHash);
    expect(JSON.stringify(stored)).not.toContain(configs[0].customPrompt); expect(visible.items[0].savedQuestionId).toBeUndefined();
    await request(app).get(`/streaming/generation-jobs/${requestId}`).set('x-test-owner', String(foreign)).expect(404);
    await request(app).get(`/streaming/questions/${receipt.sessionId}`).set('x-test-owner', String(foreign)).expect(404);
    const client = jest.spyOn(sseService, 'addClient').mockImplementation((_id, res) => res.status(200).end());
    try { await request(app).get(`/streaming/questions/${receipt.sessionId}`).set('x-test-owner', String(f.owner)).expect(200); }
    finally { client.mockRestore(); }
    hold.resolve(); await jobs.waitForIdle();
    const list = await request(app).get(`/streaming/generation-jobs?quizId=${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
    expect(list.body.data.jobs[0].status).toBe('succeeded');
  });

  test('actual Questions and Coverage routes exclude staged and retired records; the old client without requestId is rejected', async () => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work: async context => { await stage(context, f.owner, f.quizId, { objectiveId: f.objective._id }); await hold.promise; } });
    await until(async () => (await jobs.get(f.owner, requestId)).items.every(item => item.status === 'ready'));
    const before = await request(app).get(`/questions/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
    expect(before.body.data.questions.map(question => question.questionText)).toEqual(['Original published question']);
    const coverage = await request(app).get(`/coverage/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
    expect(JSON.stringify(coverage.body)).not.toContain('New candidate');
    hold.resolve(); await jobs.waitForIdle();
    const after = await request(app).get(`/questions/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
    expect(after.body.data.questions.map(question => question.questionText)).toEqual(['New candidate 1']);
    const finalCoverage = await request(app).get(`/coverage/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
    expect(JSON.stringify(finalCoverage.body)).not.toContain('Original published question');
    await request(app).post('/streaming/generate-questions').set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, questionConfigs: configs }).expect(400);
    const replay = await request(app).post('/streaming/generate-questions').set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, questionConfigs: configs, requestId, mode: 'replace', sessionId: 'different-transport-session' }).expect(200);
    expect(replay.body.job.status).toBe('succeeded');
  });

  test.each(['learning-objectives', 'quiz-blueprint'])('%s can subscribe before POST without a receipt and keeps its owner across reconnects', async kind => {
    const f = await fixture(); const foreign = new mongoose.Types.ObjectId(); const sessionId = `${kind}-${randomUUID()}`;
    const client = jest.spyOn(sseService, 'addClient').mockImplementation((_id, res) => res.status(200).end());
    try {
      await request(app).get(`/streaming/questions/${sessionId}`).set('x-test-owner', String(f.owner)).expect(200);
      sseService.removeClient(sessionId);
      await request(app).get(`/streaming/questions/${sessionId}`).set('x-test-owner', String(foreign)).expect(403);
      await request(app).get(`/streaming/questions/${sessionId}`).set('x-test-owner', String(f.owner)).expect(200);
      const endpoint = kind === 'learning-objectives' ? '/objectives/generate' : '/plans/generate-ai';
      await request(app).post(endpoint).set('x-test-owner', String(foreign)).send({ quizId: f.quizId, sessionId, materialIds: [new mongoose.Types.ObjectId()] }).expect(403);
    } finally { client.mockRestore(); }
  });

  test('the real POST, streaming service staging, and polling API complete without SSE or a second paid call after resubmission', async () => {
    const f = await fixture(); const hold = gate(); const requestId = randomUUID();
    services.push(questionGenerationJobs);
    const prompts = jest.spyOn(coursePromptService, 'buildCoursePromptInstructions').mockResolvedValue({ prompt: '' });
    const resolveConfig = jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue({ provider: 'synthetic', model: 'isolated-test' });
    const novelty = jest.spyOn(questionMemoryService, 'reserveIfNovel').mockResolvedValue({ novel: true, noveltyScore: 1 });
    const model = jest.spyOn(llmService, 'generateQuestionStreaming').mockImplementation(async () => {
      await hold.promise;
      return { success: true, questionData: { type: 'multiple-choice', difficulty: 'moderate', questionText: 'Controller staged candidate', correctAnswer: 'Yes',
        content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] } } };
    });
    const body = { quizId: f.quizId, requestId, mode: 'replace', questionConfigs: [{ ...configs[0], learningObjective: null }] };
    try {
      const started = await request(app).post('/streaming/generate-questions').set('x-test-owner', String(f.owner)).send(body).expect(202);
      await until(() => model.mock.calls.length === 1);
      const replay = await request(app).post('/streaming/generate-questions').set('x-test-owner', String(f.owner)).send({ ...body, sessionId: randomUUID() }).expect(202);
      expect(replay.body.jobId).toBe(started.body.jobId); expect(replay.body.sessionId).toBe(started.body.sessionId);
      expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
      hold.resolve(); await questionGenerationJobs.waitForIdle();
      const recovered = await request(app).get(`/streaming/generation-jobs/${requestId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(recovered.body.data.job.status).toBe('succeeded'); expect(model).toHaveBeenCalledTimes(1);
      const questions = await request(app).get(`/questions/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
      expect(questions.body.data.questions.map(question => question.questionText)).toEqual(['Controller staged candidate']);
      expect(questions.body.data.questions[0].learningObjective).toBeUndefined();
    } finally {
      hold.resolve(); await questionGenerationJobs.waitForIdle();
      prompts.mockRestore(); resolveConfig.mockRestore(); novelty.mockRestore(); model.mockRestore();
    }
  });

  test('deleting a learning objective during generation invalidates publication and preserves unrelated custom questions', async () => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    const custom = await Question.create({ quiz: f.quizId, createdBy: f.owner, type: 'essay', difficulty: 'moderate', questionText: 'Unlinked custom question', order: 1 });
    await Quiz.updateOne({ _id: f.quizId }, { $push: { questions: custom._id } });
    await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work: async context => { await hold.promise; await stage(context, f.owner, f.quizId, { objectiveId: f.objective._id }); } });
    await request(app).delete(`/objectives/${f.objective._id}?confirmed=true`).set('x-test-owner', String(f.owner)).expect(200);
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('conflict');
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(custom._id)]);
  });

  test('abandoning an unregistered request is idempotent and permanently rejects a late original POST without model work', async () => {
    const f = await fixture(); const jobs = service(); const requestId = randomUUID(); const work = jest.fn();
    const endpoint = `/streaming/generation-jobs/${requestId}/abandon`;
    const replies = await Promise.all([1, 2].map(() => request(app).post(endpoint).set('x-test-owner', String(f.owner)).send({ quizId: f.quizId }).expect(200)));
    const tombstone = replies[0].body.data.job;
    expect(tombstone).toMatchObject({ status: 'interrupted', abandoned: true, totalQuestions: 0, questionIds: [] });
    expect(replies[1].body.data.job.jobId).toBe(tombstone.jobId);
    expect(await Job.countDocuments({ owner: f.owner, requestId })).toBe(1);
    await expect(jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work })).rejects.toMatchObject({ code: 'GENERATION_REQUEST_ABANDONED' });
    const late = await request(app).post('/streaming/generate-questions').set('x-test-owner', String(f.owner)).send({ quizId: f.quizId, requestId, mode: 'replace', questionConfigs: configs }).expect(409);
    expect(late.body.error.code).toBe('GENERATION_REQUEST_ABANDONED'); expect(work).not.toHaveBeenCalled();
    const recovered = await request(app).get(`/streaming/generation-jobs/${requestId}`).set('x-test-owner', String(f.owner)).expect(200);
    expect(recovered.body.data.job.abandoned).toBe(true);
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
  });

  test('abandon returns an already accepted task and does not cancel it or interfere with a different active request', async () => {
    const f = await fixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    const work = jest.fn(async context => { await hold.promise; await stage(context, f.owner, f.quizId); });
    const receipt = await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work });
    const active = await request(app).post(`/streaming/generation-jobs/${requestId}/abandon`).set('x-test-owner', String(f.owner)).send({ quizId: f.quizId }).expect(200);
    expect(active.body.data.job).toMatchObject({ jobId: String(receipt._id), status: 'running', abandoned: false });
    const unrelated = await jobs.abandon({ ...f, requestId: randomUUID() });
    expect(unrelated.abandoned).toBe(true); expect(unrelated.active).toBe(false);
    const listed = await jobs.list(f.owner, f.quizId);
    expect(String(listed[0]._id)).toBe(String(receipt._id));
    expect(listed[0].active).toBe(true);
    expect((await Quiz.findById(f.quizId)).questionGenerationLease.token).toBe(receipt.leaseToken);
    expect((await jobs.get(f.owner, requestId)).status).toBe('running');
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('succeeded'); expect(work).toHaveBeenCalledTimes(1);
    const complete = await jobs.abandon({ ...f, requestId });
    expect(complete.status).toBe('succeeded'); expect(complete.abandoned).toBe(false);
  });

  test('abandon validates IDs and ownership without disclosing or blocking another owner request', async () => {
    const f = await fixture(); const foreign = await fixture(); const requestId = randomUUID(); const jobs = service();
    const endpoint = `/streaming/generation-jobs/${requestId}/abandon`;
    await request(app).post(endpoint).send({ quizId: f.quizId }).expect(401);
    await request(app).post(endpoint).set('x-test-owner', String(foreign.owner)).send({ quizId: f.quizId }).expect(404);
    await request(app).post(endpoint).set('x-test-owner', String(f.owner)).send({ quizId: 'invalid' }).expect(400);
    await request(app).post('/streaming/generation-jobs/short/abandon').set('x-test-owner', String(f.owner)).send({ quizId: f.quizId }).expect(400);
    const ownTombstone = await jobs.abandon({ ...f, requestId });
    const otherTombstone = await jobs.abandon({ ...foreign, requestId });
    expect(String(otherTombstone._id)).not.toBe(String(ownTombstone._id));
    const sameOwnerQuiz = await Quiz.create({ name: 'Other owned object', folder: new mongoose.Types.ObjectId(), createdBy: f.owner });
    await request(app).post(endpoint).set('x-test-owner', String(f.owner)).send({ quizId: sameOwnerQuiz._id }).expect(404);
    expect(await Job.countDocuments({ requestId })).toBe(2);
  });

  test('when abandon wins while the original request is paused immediately before insert, its late insert cannot run paid work', async () => {
    const f = await fixture(); const jobs = service(); const requestId = randomUUID(); const entered = gate(); const release = gate(); const work = jest.fn();
    const create = Job.create.bind(Job);
    const insert = jest.spyOn(Job, 'create').mockImplementation(async data => {
      if (data.requestId === requestId && data.active) { entered.resolve(); await release.promise; }
      return create(data);
    });
    const started = jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work }).then(job => ({ job }), error => ({ error }));
    try {
      await entered.promise;
      const tombstone = await jobs.abandon({ ...f, requestId });
      expect(tombstone.abandoned).toBe(true);
      release.resolve();
      expect((await started).error).toMatchObject({ code: 'GENERATION_REQUEST_ABANDONED' });
      expect(work).not.toHaveBeenCalled(); expect(await Job.countDocuments({ owner: f.owner, requestId })).toBe(1);
    } finally { release.resolve(); await started; insert.mockRestore(); }
  });

  test('when the original request wins while abandon is paused immediately before insert, recovery returns the accepted task unchanged', async () => {
    const f = await fixture(); const jobs = service(); const requestId = randomUUID(); const entered = gate(); const release = gate(); const holdWork = gate();
    const create = Job.create.bind(Job);
    const insert = jest.spyOn(Job, 'create').mockImplementation(async data => {
      if (data.requestId === requestId && data.abandoned) { entered.resolve(); await release.promise; }
      return create(data);
    });
    const abandoned = jobs.abandon({ ...f, requestId });
    const work = jest.fn(async context => { await holdWork.promise; await stage(context, f.owner, f.quizId); });
    try {
      await entered.promise;
      const accepted = await jobs.start({ ...f, requestId, mode: 'replace', questionConfigs: configs, work });
      release.resolve(); const recovered = await abandoned;
      expect(String(recovered._id)).toBe(String(accepted._id)); expect(recovered.abandoned).toBe(false); expect(recovered.status).toBe('running');
      holdWork.resolve(); await jobs.waitForIdle(); expect(work).toHaveBeenCalledTimes(1);
      expect((await jobs.get(f.owner, requestId)).status).toBe('succeeded');
      expect(await Job.countDocuments({ owner: f.owner, requestId })).toBe(1);
    } finally { release.resolve(); holdWork.resolve(); await abandoned; insert.mockRestore(); }
  });
});

// Assistant integration uses the same random database and the real staged
// question/publication/native conversion pipeline. Only paid AI and retrieval
// responses are synthetic.
const { createAssistantGenerationService, expandAssistantQuestionPlan } = await import('../../services/studioAssistantGeneration.js');
const { default: ragService } = await import('../../services/ragService.js');

async function assistantFixture() {
  const f = await fixture();
  const quiz = await Quiz.findById(f.quizId);
  const selected = await Material.create({ name: 'Selected source', type: 'text', folder: quiz.folder,
    uploadedBy: f.owner, processingStatus: 'completed', content: 'Synthetic selected source.',
    processingMetadata: { chunkCount: 1, embeddedChunkCount: 1 } });
  const other = await Material.create({ name: 'Unselected source', type: 'text', folder: quiz.folder,
    uploadedBy: f.owner, processingStatus: 'failed', content: 'Do not use this source.' });
  quiz.materials = [selected._id, other._id];
  quiz.settings.planItems = [{ type: 'multiple-choice', learningObjective: f.objective._id,
    count: 1, customPrompt: 'Use the selected synthetic example.', difficulty: 'moderate', selectionMode: 'single' }];
  await quiz.save();
  return { ...f, selected, other };
}

function assistantModelMocks(f, implementation) {
  const initialized = ragService.isInitialized;
  ragService.isInitialized = true;
  const spies = [
    jest.spyOn(coursePromptService, 'buildCoursePromptInstructions').mockResolvedValue({ prompt: '' }),
    jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue({ provider: 'synthetic', model: 'isolated-test' }),
    jest.spyOn(questionMemoryService, 'reserveIfNovel').mockResolvedValue({ novel: true, noveltyScore: 1 }),
    jest.spyOn(llmService, 'questionMatchesPlannedTask').mockReturnValue({ valid: true }),
    jest.spyOn(ragService, 'retrieveRelevantContent').mockResolvedValue({ chunks: [{ content: 'Synthetic selected source.', score: 0.91,
      metadata: { materialId: String(f.selected._id), materialName: f.selected.name, sourceFile: 'source.pdf', pageNumber: 3, chunkIndex: 0 } }] })
  ];
  const model = jest.spyOn(llmService, 'generateQuestionStreaming').mockImplementation(implementation || (async () => ({ success: true,
    questionData: { type: 'multiple-choice', difficulty: 'moderate', questionText: 'Assistant candidate', correctAnswer: 'Yes',
      content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] } } })));
  return { model, retrieval: spies.at(-1), restore() { for (const spy of [...spies, model]) spy.mockRestore(); ragService.isInitialized = initialized; } };
}

describe('Studio assistant reuses durable course question generation', () => {
  test('selected subset reaches retrieval, real questions append atomically, and the native package includes original and generated content', async () => {
    const f = await assistantFixture(); const jobs = service(); const mocks = assistantModelMocks(f); const progress = [];
    const run = createAssistantGenerationService({ jobs, pollMs: 5 });
    const requestId = randomUUID();
    try {
      const result = await run({ userId: f.owner, quizId: f.quizId, requestId, materialIds: [f.selected._id], onProgress: item => progress.push(item) });
      expect(result.job.status).toBe('succeeded');
      expect(result.quiz.questions.map(question => question.questionText)).toEqual(['Original published question', 'Assistant candidate']);
      expect(result.document.library).toBe('H5P.Column 1.18');
      expect(JSON.stringify(result.document)).toContain('Original published question');
      expect(JSON.stringify(result.document)).toContain('Assistant candidate');
      expect(mocks.retrieval).toHaveBeenCalledWith(expect.any(String), 'multiple-choice', expect.objectContaining({ materialIds: [String(f.selected._id)] }));
      expect(result.quiz.questions[1].generationMetadata.sourceReferences[0]).toMatchObject({ materialName: 'Selected source', sourceFile: 'source.pdf', pageNumber: 3, chunkIndex: 0 });
      expect(progress.at(-1)).toMatchObject({ stage: 'questions-published', published: true, readyCount: 1 });
      const replay = await run({ userId: f.owner, quizId: f.quizId, requestId, materialIds: [f.selected._id] });
      expect(replay.jobId).toBe(result.jobId); expect(mocks.model).toHaveBeenCalledTimes(1);
      expect(await Question.countDocuments({ generationJob: result.jobId })).toBe(1);
    } finally { await jobs.waitForIdle(); mocks.restore(); }
  });

  test('a second caller recovers a running receipt without starting another paid request', async () => {
    const f = await assistantFixture(); const jobs = service(); const hold = gate(); const requestId = randomUUID();
    const mocks = assistantModelMocks(f, async () => { await hold.promise; return { success: true, questionData: {
      type: 'multiple-choice', difficulty: 'moderate', questionText: 'Recovered assistant candidate', correctAnswer: 'Yes',
      content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] } } }; });
    const run = createAssistantGenerationService({ jobs, pollMs: 5 });
    const args = { userId: f.owner, quizId: f.quizId, requestId, materialIds: [f.selected._id] };
    const first = run(args);
    try {
      await until(() => mocks.model.mock.calls.length === 1);
      const second = run(args); hold.resolve();
      const results = await Promise.all([first, second]);
      expect(results[0].jobId).toBe(results[1].jobId); expect(mocks.model).toHaveBeenCalledTimes(1);
      expect((await Quiz.findById(f.quizId)).questions).toHaveLength(2);
    } finally { hold.resolve(); await first.catch(() => {}); await jobs.waitForIdle(); mocks.restore(); }
  });

  test.each(['foreign-owner', 'unassigned-material', 'unready-material', 'retired-objective', 'incompatible-question'])('%s is rejected before creating a generation receipt or paid work', async scenario => {
    const f = await assistantFixture(); const jobs = service(); const work = jest.fn();
    const args = { userId: f.owner, quizId: f.quizId, requestId: randomUUID(), materialIds: [f.selected._id] };
    if (scenario === 'foreign-owner') args.userId = new mongoose.Types.ObjectId();
    if (scenario === 'unassigned-material') args.materialIds = [new mongoose.Types.ObjectId()];
    if (scenario === 'unready-material') args.materialIds = [f.other._id];
    if (scenario === 'retired-objective') await Quiz.updateOne({ _id: f.quizId }, { $set: { learningObjectives: [] } });
    if (scenario === 'incompatible-question') await Question.updateOne({ _id: f.question._id }, { $set: { type: 'sort-paragraphs' } });
    const run = createAssistantGenerationService({ jobs, createWork: work, pollMs: 5 });
    await expect(run(args)).rejects.toMatchObject({ code: {
      'foreign-owner': 'NOT_FOUND', 'unassigned-material': 'ASSISTANT_MATERIALS_CHANGED', 'unready-material': 'MATERIALS_NOT_READY',
      'retired-objective': 'ASSISTANT_OBJECTIVES_CHANGED', 'incompatible-question': 'ASSISTANT_CONTAINER_INCOMPATIBLE'
    }[scenario] });
    expect(work).not.toHaveBeenCalled(); expect(await Job.countDocuments({})).toBe(0);
  });

  test('approval snapshot mismatch blocks changed plan before any receipt or paid work', async () => {
    const f = await assistantFixture(); const jobs = service(); const work = jest.fn(); const snapshot = jest.fn(async quiz => {
      expect(String(quiz.learningObjectives[0]._id)).toBe(String(f.objective._id));
      throw Object.assign(new Error('The approved plan changed.'), { code: 'APPROVAL_CHANGED' });
    });
    const run = createAssistantGenerationService({ jobs, createWork: work });
    await expect(run({ userId: f.owner, quizId: f.quizId, requestId: randomUUID(), materialIds: [f.selected._id], assertQuizSnapshot: snapshot }))
      .rejects.toMatchObject({ code: 'APPROVAL_CHANGED' });
    expect(work).not.toHaveBeenCalled(); expect(await Job.countDocuments({})).toBe(0);
  });

  test('partially generated assistant batch remains staged and a repeated failed receipt never pays again', async () => {
    const f = await assistantFixture(); const jobs = service(); const requestId = randomUUID(); const preview = jest.fn();
    const quiz = await Quiz.findById(f.quizId); quiz.settings.planItems[0].count = 2; await quiz.save();
    const work = jest.fn(context => stage(context, f.owner, f.quizId, { failIndex: 1, objectiveId: f.objective._id }));
    const run = createAssistantGenerationService({ jobs, createWork: () => work, buildDocument: preview, pollMs: 5 });
    const args = { userId: f.owner, quizId: f.quizId, requestId, materialIds: [f.selected._id] };
    await expect(run(args)).rejects.toMatchObject({ code: 'ASSISTANT_QUESTION_BATCH_FAILED', job: { status: 'failed' } });
    await expect(run(args)).rejects.toMatchObject({ code: 'ASSISTANT_QUESTION_BATCH_FAILED' });
    expect(work).toHaveBeenCalledTimes(1); expect(preview).not.toHaveBeenCalled();
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
    const visible = await request(app).get(`/questions/quiz/${f.quizId}`).set('x-test-owner', String(f.owner)).expect(200);
    expect(visible.body.data.questions).toHaveLength(1);
  });

  test('external source invalidation aborts an accepted worker and fences late candidates', async () => {
    const f = await assistantFixture(); const jobs = service(); const hold = gate(); let invalid = false;
    const work = jest.fn(async context => { await hold.promise; await stage(context, f.owner, f.quizId, { objectiveId: f.objective._id }); });
    const run = createAssistantGenerationService({ jobs, createWork: () => work, pollMs: 5 });
    const requestId = randomUUID();
    const pending = run({ userId: f.owner, quizId: f.quizId, requestId, materialIds: [f.selected._id],
      assertActive: async () => { if (invalid) throw Object.assign(new Error('Selected source changed.'), { code: 'SOURCE_CHANGED' }); } }).catch(error => error);
    await until(() => work.mock.calls.length === 1); invalid = true;
    expect(await pending).toMatchObject({ code: 'SOURCE_CHANGED' });
    hold.resolve(); await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).active).toBe(false);
    expect(await Question.countDocuments({ generationJob: work.mock.calls[0][0].job._id })).toBe(0);
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
  });

  test.each(['signal', 'context'])('%s cancellation is checked by publication after work returns, even when work has staged every candidate', async kind => {
    const f = await assistantFixture(); const jobs = service(); const controller = new AbortController(); const requestId = randomUUID();
    let invalid = false;
    const receipt = await jobs.start({ owner: f.owner, quizId: f.quizId, requestId, questionConfigs: configs, signal: controller.signal,
      assertContextActive: async () => { if (invalid) throw Object.assign(new Error('Assistant lease ended.'), { code: 'GENERATION_INTERRUPTED' }); },
      work: async context => { await stage(context, f.owner, f.quizId, { objectiveId: f.objective._id });
        if (kind === 'signal') controller.abort(); else invalid = true; } });
    await jobs.waitForIdle();
    expect((await jobs.get(f.owner, requestId)).status).toBe('interrupted');
    expect((await Quiz.findById(f.quizId)).questions.map(String)).toEqual([String(f.question._id)]);
    expect(await Question.countDocuments({ generationJob: receipt._id })).toBe(1);
  });

  test('saved plans expand exact counts and preserve the instructor instructions and objective links', () => {
    const objective = new mongoose.Types.ObjectId();
    const expanded = expandAssistantQuestionPlan({ settings: { planItems: [{ type: 'essay', learningObjective: objective,
      count: 2, customPrompt: 'Compare two examples.', rationale: 'Evidence comparison', difficulty: 'challenging' }] } });
    expect(expanded).toHaveLength(2);
    expect(expanded[0]).toMatchObject({ questionType: 'essay', learningObjectiveId: String(objective), customPrompt: 'Compare two examples.',
      planRationale: 'Evidence comparison', difficulty: 'challenging', useCustomPromptOnly: false });
    expect(() => expandAssistantQuestionPlan({ settings: { planItems: [{ type: 'essay', learningObjective: objective, count: 21 }] } })).toThrow();
  });
});
