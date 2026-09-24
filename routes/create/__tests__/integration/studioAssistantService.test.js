import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from '../../models/StudioAssistantSession.js';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import Question from '../../models/Question.js';
import StudioGenerationJob from '../../models/StudioGenerationJob.js';
import studioJobs from '../../services/studioGenerationJobs.js';
import questionJobs from '../../services/questionGenerationJobs.js';
import llmService from '../../services/llmService.js';
import ragService from '../../services/ragService.js';
import { createAssistantSession, updateAssistantPlan, approveAssistantPlan,
  readAssistantSession, resumeAssistantSession } from '../../services/studioAssistantService.js';

// No repository integration setup: connect only to a freshly named disposable
// database on localhost. No real model requests or background generation runs.
const dbName = `tlef_qa_studio_assistant_${randomUUID().replaceAll('-', '')}`;
let connected = false;
let runWork = true;
let pendingWork;
let completion;
let start;
const models = [Session, Folder, Material, Quiz, LearningObjective, Question, StudioGenerationJob];
beforeAll(async () => {
  dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });
  const uri = new URL(process.env.E2E_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
  if (!['localhost', '127.0.0.1'].includes(uri.hostname)) throw new Error('Use only a local disposable MongoDB for this suite.');
  await mongoose.connect(uri.toString(), { dbName, serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== dbName) throw new Error('Refusing a non-isolated database.');
  connected = true;
  await Promise.all(models.map(Model => Model.init()));
}, 30000);
beforeEach(() => {
  runWork = true; pendingWork = null;
  jest.spyOn(studioJobs, 'get').mockResolvedValue({ status: 'succeeded' });
  jest.spyOn(questionJobs, 'get').mockResolvedValue(null);
  start = jest.spyOn(studioJobs, 'start').mockImplementation(async (_owner, _requestId, work) => {
    pendingWork = work;
    if (runWork) await work(async () => {});
    return { status: runWork ? 'succeeded' : 'running' };
  });
  jest.spyOn(ragService, 'buildLearningObjectiveInventory').mockImplementation(async materials => ({
    sections: materials.map(material => ({ id: 'water-section', materialId: String(material._id),
      materialName: material.name, sourceFile: 'water.pdf', title: 'Evaporation',
      chunks: [{ content: 'Water evaporates into the atmosphere.', chunkIndex: 0, pageNumber: 1 }] }))
  }));
  completion = jest.spyOn(llmService, 'streamCompletion').mockImplementation(async ({ prompt, jsonSchema }) => {
    if (jsonSchema.name === 'studio_assistant_objectives') {
      const id = JSON.parse(prompt.match(/AVAILABLE SOURCE IDS: (\[[^\n]+\])/)[1])[0];
      return { content: JSON.stringify({ objectives: [{ text: 'Explain evaporation.', sourceIds: [id] }] }) };
    }
    const approved = JSON.parse(prompt.match(/APPROVED OBJECTIVES: (\[[^\n]+\])/)[1]);
    return { content: JSON.stringify({ unsupportedRequirements: [], plan: [{ title: 'Evaporation check',
      questionType: 'multiple-choice', count: 2, objectiveIds: [approved[0].id],
      instructions: 'Ask about evaporation using the course source.', difficulty: 'moderate' }] }) };
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (connected) await Promise.all(models.map(Model => Model.deleteMany({})));
});
afterAll(async () => {
  try {
    if (connected && mongoose.connection.name === dbName && /^tlef_qa_studio_assistant_[a-f0-9]+$/.test(dbName)) await mongoose.connection.dropDatabase();
  } finally { await mongoose.disconnect(); }
});

async function fixture({ existing = false, questions = false } = {}) {
  const user = { id: String(new mongoose.Types.ObjectId()) };
  const folder = await Folder.create({ name: 'Synthetic QA course', instructor: user.id });
  const material = await Material.create({ name: 'Synthetic water cycle', type: 'text', content: 'Water evaporates.',
    folder: folder._id, uploadedBy: user.id, processingStatus: 'completed',
    processingMetadata: { chunkCount: 1, embeddedChunkCount: 1 } });
  await Folder.updateOne({ _id: folder._id }, { $set: { materials: [material._id] } });
  let quiz;
  let objective;
  let question;
  if (existing) {
    quiz = await Quiz.create({ name: 'Existing canonical learning object', folder: folder._id, createdBy: user.id, materials: [material._id] });
    objective = await LearningObjective.create({ quiz: quiz._id, createdBy: user.id, text: 'Explain the existing water objective.' });
    if (questions) {
      question = await Question.create({ quiz: quiz._id, createdBy: user.id, learningObjective: objective._id,
        type: 'multiple-choice', difficulty: 'moderate', questionText: 'Original saved question',
        content: { options: [{ text: 'Water', isCorrect: true }, { text: 'Rock', isCorrect: false }] }, correctAnswer: 'Water' });
    }
    await Quiz.updateOne({ _id: quiz._id }, { $set: { learningObjectives: [objective._id], questions: question ? [question._id] : [] } });
  }
  const body = { requestId: randomUUID(), courseId: String(folder._id), materialIds: [String(material._id)],
    instructions: 'Teach the water cycle using the supplied course material.', ...(quiz ? { quizId: String(quiz._id) } : {}) };
  return { user, folder, material, quiz, objective, question, body };
}

function planEdit(session, changes = {}) {
  return { revision: session.revision, objectives: session.objectives, plan: session.plan, ...changes };
}

describe('assistant and canonical course workflow share the same records', () => {
  test.each(['branching-scenario', 'crossword', 'sort-paragraphs'])(
    'rejects an existing %s learning object before paid planning or any changes to its canonical records', async type => {
      const f = await fixture({ existing: true, questions: true });
      await Question.updateOne({ _id: f.question._id }, { $set: { type } });
      await Quiz.updateOne({ _id: f.quiz._id }, { $set: { 'settings.targetFormat': 'standalone' } });
      const beforeQuiz = await Quiz.findById(f.quiz._id).lean();
      const beforeQuestion = await Question.findById(f.question._id).lean();
      const beforeCourse = await Folder.findById(f.folder._id).lean();
      await expect(createAssistantSession(f.user, f.body)).rejects.toMatchObject({ status: 400, code: 'ASSISTANT_CONTAINER_INCOMPATIBLE' });
      expect(await Quiz.findById(f.quiz._id).lean()).toEqual(beforeQuiz);
      expect(await Question.findById(f.question._id).lean()).toEqual(beforeQuestion);
      expect(await Folder.findById(f.folder._id).lean()).toEqual(beforeCourse);
      expect(await Session.countDocuments({ owner: f.user.id })).toBe(0);
      expect(await LearningObjective.countDocuments({ quiz: f.quiz._id })).toBe(1);
      expect(completion).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    }
  );

  test('staged planning creates one real course learning object, sourced objectives and canonical blueprint before approval, but no questions', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    expect(session.status).toBe('awaiting_approval');
    expect(completion).toHaveBeenCalledTimes(2);
    const quiz = await Quiz.findById(session.quizId).populate('learningObjectives');
    expect(quiz.materials.map(String)).toEqual([String(f.material._id)]);
    expect(quiz.learningObjectives[0].text).toBe('Explain evaporation.');
    expect(quiz.learningObjectives[0].generationMetadata.sourceReferences[0]).toMatchObject({ excerpt: 'Water evaporates into the atmosphere.', pageNumber: 1 });
    expect(session.objectives[0].id).toBe(String(quiz.learningObjectives[0]._id));
    expect(String(quiz.settings.planItems[0].learningObjective)).toBe(session.objectives[0].id);
    expect(quiz.settings.planItems[0]).toMatchObject({ type: 'multiple-choice', count: 2, useCustomPromptOnly: false });
    expect(quiz.progress.planApproved).toBe(false);
    expect(await Question.countDocuments({ quiz: quiz._id })).toBe(0);
    expect((await Folder.findById(f.folder._id)).quizzes.map(String)).toContain(session.quizId);
    await expect(quiz.validate()).resolves.toBeUndefined();
  });

  test('request replay recovers the same session and does not repeat paid planning or create a second learning object', async () => {
    const f = await fixture();
    const first = await createAssistantSession(f.user, f.body);
    const repeated = await createAssistantSession(f.user, f.body);
    expect(repeated.id).toBe(first.id);
    expect(completion).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(await Quiz.countDocuments({ createdBy: f.user.id })).toBe(1);
    await expect(createAssistantSession(f.user, { ...f.body, instructions: 'A changed teaching request using the same ID.' })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
  });

  test('existing course objectives are reused without another objective-generation charge and existing question records are preserved', async () => {
    const f = await fixture({ existing: true, questions: true });
    const session = await createAssistantSession(f.user, f.body);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(session.objectives[0].id).toBe(String(f.objective._id));
    expect(await LearningObjective.countDocuments({ quiz: f.quiz._id })).toBe(1);
    const current = await Quiz.findById(f.quiz._id);
    expect(current.questions.map(String)).toEqual([String(f.question._id)]);
    const edit = planEdit(session, { objectives: [{ ...session.objectives[0], text: 'Overwritten linked objective' }] });
    await expect(updateAssistantPlan(f.user, session.id, edit)).rejects.toMatchObject({ code: 'STUDIO_ASSISTANT_OBJECTIVE_IN_USE' });
    expect((await LearningObjective.findById(f.objective._id)).text).toBe(f.objective.text);
  });

  test('valid teacher edits persist canonical IDs/counts, invalid edits preserve the previously saved manifest', async () => {
    const f = await fixture();
    const first = await createAssistantSession(f.user, f.body);
    const edited = await updateAssistantPlan(f.user, first.id, planEdit(first, {
      objectives: [{ ...first.objectives[0], text: 'Compare evaporation with condensation.' }],
      plan: [{ ...first.plan[0], count: 4 }]
    }));
    expect(edited.revision).toBeGreaterThan(first.revision);
    expect(edited.objectives[0].id).not.toBe(first.objectives[0].id);
    const quiz = await Quiz.findById(first.quizId);
    expect(quiz.learningObjectives.map(String)).toEqual([edited.objectives[0].id]);
    expect(quiz.settings.planItems[0].count).toBe(4);
    await expect(updateAssistantPlan(f.user, first.id, planEdit(edited, { plan: [{ ...edited.plan[0], count: 99 }] }))).rejects.toMatchObject({ code: 'H5P_ASSISTANT_INVALID_APPROVAL' });
    const after = await Quiz.findById(first.quizId);
    expect(after.learningObjectives.map(String)).toEqual(quiz.learningObjectives.map(String));
    expect(after.settings.planItems[0].count).toBe(4);
    expect(completion).toHaveBeenCalledTimes(2);
  });

  test('no current approval, stale revision, cross-owner access and changed sources cannot launch a paid generation', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    const calls = start.mock.calls.length;
    await expect(approveAssistantPlan(f.user, session.id, { revision: session.revision - 1, requestId: randomUUID() })).rejects.toMatchObject({ code: 'STUDIO_ASSISTANT_CONFLICT' });
    await expect(readAssistantSession(String(new mongoose.Types.ObjectId()), session.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await Material.updateOne({ _id: f.material._id }, { $set: { content: 'Changed source content' } });
    await expect(approveAssistantPlan(f.user, session.id, { revision: session.revision, requestId: randomUUID() })).rejects.toMatchObject({ code: 'STUDIO_ASSISTANT_SOURCE_CHANGED' });
    expect(start).toHaveBeenCalledTimes(calls);
  });

  test('approval starts exactly one deferred generation only after the canonical plan is marked approved', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    runWork = false;
    const body = { revision: session.revision, requestId: randomUUID() };
    const approved = await approveAssistantPlan(f.user, session.id, body);
    expect(approved.status).toBe('generating');
    expect((await Quiz.findById(session.quizId)).progress.planApproved).toBe(true);
    expect(await Question.countDocuments({ quiz: session.quizId })).toBe(0);
    expect(pendingWork).toBeInstanceOf(Function);
    const replay = await approveAssistantPlan(f.user, session.id, body);
    expect(replay.id).toBe(approved.id);
    expect(start).toHaveBeenCalledTimes(2);
  });

  test('the same full request ID used for planning and approval has distinct phase receipts and approval replay is idempotent', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    runWork = false;
    const approval = { revision: session.revision, requestId: f.body.requestId };
    const generated = await approveAssistantPlan(f.user, session.id, approval);
    expect(generated.status).toBe('generating');
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0][1]).not.toBe(start.mock.calls[1][1]);
    expect(start.mock.calls[1][1]).toMatch(/^[a-zA-Z0-9-]{16,80}$/);
    const replay = await approveAssistantPlan(f.user, session.id, approval);
    expect(replay.currentJobId).toBe(generated.currentJobId);
    expect(start).toHaveBeenCalledTimes(2);
  });

  test('retry request IDs with the same first 40 characters remain distinct', async () => {
    const f = await fixture();
    const prefix = 'a'.repeat(40);
    const session = await createAssistantSession(f.user, { ...f.body, requestId: `${prefix}-initial` });
    await Session.updateOne({ _id: session.id }, { $set: { status: 'failed' } });
    const continued = await resumeAssistantSession(f.user, session.id, { revision: session.revision, requestId: `${prefix}-retry` });
    expect(continued.status).toBe('awaiting_approval');
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0][1]).not.toBe(start.mock.calls[1][1]);
    expect(completion).toHaveBeenCalledTimes(3);
  });

  test('an existing legacy UUID generation receipt is still recoverable by replaying its approval request', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    const requestId = randomUUID();
    const oldRunId = `asst-${session.id}-${requestId}`;
    await Session.updateOne({ _id: session.id }, { $set: { status: 'generating', phase: 'generating', currentJobId: oldRunId } });
    const replay = await approveAssistantPlan(f.user, session.id, { revision: session.revision, requestId });
    expect(replay.currentJobId).toBe(oldRunId);
    expect(replay.status).toBe('generating');
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('an invalid retry request ID is rejected before changing recovery metadata', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    await Session.updateOne({ _id: session.id }, { $set: { status: 'failed', phase: 'generating' } });
    const before = await Session.findById(session.id).lean();
    await expect(resumeAssistantSession(f.user, session.id, { revision: session.revision, requestId: 'bad' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(await Session.findById(session.id).lean()).toEqual(before);
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('a changed canonical plan after approval is rejected by the actual deferred generation before admission', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    runWork = false;
    await approveAssistantPlan(f.user, session.id, { revision: session.revision, requestId: randomUUID() });
    await Quiz.updateOne({ _id: session.quizId }, { $set: { 'settings.planItems.0.customPrompt': 'An unapproved different teaching request.' }, $inc: { __v: 1 } });
    const admit = jest.spyOn(questionJobs, 'start');
    await expect(pendingWork(async () => {})).rejects.toMatchObject({ code: 'STUDIO_ASSISTANT_SOURCE_CHANGED' });
    expect(admit).not.toHaveBeenCalled();
    expect((await Session.findById(session.id)).status).toBe('failed');
    expect(completion).toHaveBeenCalledTimes(2);
  });

  test('an interrupted plan-edit reservation with a completed old receipt becomes recoverable without automatically purchasing a retry', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    await Session.updateOne({ _id: session.id }, { $set: { status: 'planning', updatedAt: new Date(Date.now() - 121000) } }, { timestamps: false });
    const recovered = await readAssistantSession(f.user.id, session.id);
    expect(recovered.status).toBe('interrupted');
    expect(completion).toHaveBeenCalledTimes(2);
    const continued = await resumeAssistantSession(f.user, session.id, { revision: recovered.revision, requestId: randomUUID() });
    expect(continued.status).toBe('awaiting_approval');
    expect(continued.objectives[0].id).toBe(session.objectives[0].id);
    expect(completion).toHaveBeenCalledTimes(3); // Explicit retry reuses the already-saved objectives.
  });

  test('an uncertain delayed manifest write cannot publish candidate objectives that cleanup already deleted', async () => {
    const f = await fixture();
    const session = await createAssistantSession(f.user, f.body);
    const findAndUpdate = Quiz.findOneAndUpdate.bind(Quiz);
    const update = Quiz.updateOne.bind(Quiz);
    let delayedPublish;
    jest.spyOn(Quiz, 'findOneAndUpdate').mockImplementation((filter, values, options) => {
      if (values?.$set?.learningObjectives && filter['questionMutation.token']) {
        delayedPublish = () => findAndUpdate(filter, values, options);
        return Promise.reject(new Error('Synthetic lost acknowledgement while the write remains queued.'));
      }
      return findAndUpdate(filter, values, options);
    });
    jest.spyOn(Quiz, 'updateOne').mockImplementation((filter, values, options) => {
      if (values?.$unset?.questionMutation !== undefined) {
        return Promise.reject(new Error('Synthetic release outage; the server lease has not expired.'));
      }
      return update(filter, values, options);
    });
    await expect(updateAssistantPlan(f.user, session.id, planEdit(session, {
      objectives: [{ ...session.objectives[0], text: 'An instructor edit whose commit acknowledgement was lost.' }]
    }))).rejects.toThrow('Synthetic release outage');
    expect(delayedPublish).toBeInstanceOf(Function);
    // The queued update is still valid when it reaches MongoDB. No replica-set
    // transaction is assumed, so unpublished candidates must remain available.
    const committed = await delayedPublish();
    expect(committed).not.toBeNull();
    expect(await LearningObjective.countDocuments({ _id: { $in: committed.learningObjectives }, quiz: session.quizId }))
      .toBe(committed.learningObjectives.length);
  });
});
