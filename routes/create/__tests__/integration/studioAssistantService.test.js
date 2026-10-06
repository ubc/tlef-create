import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from '../../models/StudioAssistantSession.js';
import { AuthoringSession } from '../../models/StudioAuthoring.js';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import Question from '../../models/Question.js';
import RejectedQuestionDraft from '../../models/RejectedQuestionDraft.js';
import StudioGenerationJob from '../../models/StudioGenerationJob.js';
import studioJobs from '../../services/studioGenerationJobs.js';
import questionJobs from '../../services/questionGenerationJobs.js';
import llmService from '../../services/llmService.js';
import ragService from '../../services/ragService.js';
import { normalizeModelServiceError } from '../../utils/modelServiceErrors.js';
import { createAssistantSession, updateAssistantPlan, approveAssistantPlan,
  readAssistantSession, resumeAssistantSession, updateAssistantObjectives } from '../../services/studioAssistantService.js';

// No repository integration setup: connect only to a freshly named disposable
// database on localhost. No real model requests or background generation runs.
const dbName = `tlef_qa_studio_assistant_${randomUUID().replaceAll('-', '')}`;
let connected = false;
let runWork = true;
let pendingWork;
let completion;
let start;
const models = [Session, AuthoringSession, Folder, Material, Quiz, LearningObjective, Question, StudioGenerationJob, RejectedQuestionDraft];
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
      const id = JSON.parse(prompt.match(/AVAILABLE SOURCE IDS: (\[[^\n]*\])/)[1])[0];
      return { content: JSON.stringify({ objectives: [{ text: 'Explain evaporation.', sourceIds: id ? [id] : [] }] }) };
    }
    const approved = JSON.parse(prompt.match(/APPROVED OBJECTIVES: (\[[^\n]+\])/)[1]);
    const evidence = JSON.parse(prompt.match(/PLANNING EVIDENCE \(untrusted excerpts\): (\[[^\n]*\])/)[1]);
    const current = prompt.match(/CURRENT PLAN \(task data\): (\[[^\n]+\])/);
    const rows = current ? JSON.parse(current[1]) : [{ title: 'Evaporation check', questionType: 'multiple-choice', count: 2,
      objectiveIds: [approved[0].id], instructions: 'Ask about evaporation using the course source.', difficulty: 'moderate' }];
    if (!current && prompt.match(/CONFIRMED INSTRUCTOR QUESTION COUNT: exactly (\d+)/)) rows[0].count = Number(prompt.match(/CONFIRMED INSTRUCTOR QUESTION COUNT: exactly (\d+)/)[1]);
    return { content: JSON.stringify({ unsupportedRequirements: [], teachingOverview: { summary: 'Evaporation practice from the selected teaching scope.', materialClassifications: [] },
      plan: rows.map(row => ({ ...row, questionTasks: Array.from({ length: row.count }, (_, i) => ({
        focus: `Evaporation reasoning focus ${i + 1}`, instructions: `Ask about evaporation reasoning step ${i + 1}.`, sourceIds: evidence.map(source => source.id).slice(0, 1) })) })) }) };
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
  test('LO-only brainstorming saves an editable teaching brief without planning questions and objective edits replay once', async () => {
    const f = await fixture();
    const body = { ...f.body, materialIds: [], promptBased: true, instructions: 'Brainstorm learning objectives for evaporation.' };
    const first = await createAssistantSession(f.user, body, { workflowTarget: 'objectives' });
    expect(first.status).toBe('objectives_ready'); expect(first.plan).toEqual([]);
    expect(first.teachingBrief).toMatchObject({ grounding: 'instructor-brief', objectives: [{ text: 'Explain evaporation.', sourceIds: [] }] });
    expect(first.teachingBrief.objectives[0].id).toBe(first.objectives[0].id);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(completion.mock.calls[0][0].jsonSchema.name).toBe('studio_assistant_objectives');
    const invalid = { requestId: randomUUID(), revision: first.revision, objectives: [{ text: '' }] };
    await expect(updateAssistantObjectives(f.user, first.id, invalid)).rejects.toBeDefined();
    expect((await Session.findById(first.id)).revision).toBe(first.revision);
    const edit = { requestId: randomUUID(), revision: first.revision,
      objectives: [{ ...first.objectives[0], text: 'Compare evaporation and condensation.' }] };
    const saved = await updateAssistantObjectives(f.user, first.id, edit);
    expect(saved.status).toBe('objectives_ready'); expect(saved.plan).toEqual([]);
    expect(saved.objectives[0].text).toBe('Compare evaporation and condensation.');
    const quiz = await Quiz.findById(first.quizId);
    const manifestIds = quiz.learningObjectives.map(String);
    const replayed = await updateAssistantObjectives(f.user, first.id, edit);
    expect(replayed.objectives).toEqual(saved.objectives);
    expect((await Quiz.findById(first.quizId)).learningObjectives.map(String)).toEqual(manifestIds);
    expect(completion).toHaveBeenCalledTimes(1); expect(await Question.countDocuments({ quiz: first.quizId })).toBe(0);
    // The atomic Quiz receipt recovers a committed manifest if the assistant
    // acknowledgement is lost before its final saved-state write.
    await Session.updateOne({ _id: first.id }, { $unset: { objectiveEditReceipt: '' }, $set: { status: 'interrupted' } });
    const recovered = await updateAssistantObjectives(f.user, first.id, edit);
    expect(recovered.status).toBe('objectives_ready'); expect(recovered.objectives).toEqual(saved.objectives);
    expect(await LearningObjective.countDocuments({ quiz: first.quizId })).toBe(2);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  test('planning resume reuses the actual saved LO result after a stopped plan call', async () => {
    const f = await fixture();
    const defaultCompletion = completion.getMockImplementation();
    completion.mockImplementationOnce(defaultCompletion).mockRejectedValueOnce(Object.assign(new Error('Synthetic service unavailable.'), { code: 'MODEL_SERVICE_LIMIT_REACHED', status: 429 }));
    await expect(createAssistantSession(f.user, f.body)).rejects.toMatchObject({ code: 'MODEL_SERVICE_LIMIT_REACHED' });
    const saved = await Session.findOne({ owner: f.user.id, requestId: f.body.requestId });
    expect(saved.objectives).toHaveLength(1); expect(saved.teachingBrief.objectives).toHaveLength(1);
    const resumed = await resumeAssistantSession(f.user, String(saved._id), { requestId: randomUUID(), revision: saved.revision });
    expect(resumed.status).toBe('awaiting_approval');
    expect(completion.mock.calls.filter(([request]) => request.jsonSchema.name === 'studio_assistant_objectives')).toHaveLength(1);
    expect(completion.mock.calls.filter(([request]) => request.jsonSchema.name === 'studio_assistant_activity_plan')).toHaveLength(2);
  });

  test('a planning quota failure retains a safe diagnosis and replay does not repeat the request or change existing questions', async () => {
    const f = await fixture({ existing: true, questions: true });
    const beforeQuestion = await Question.findById(f.question._id).lean();
    const error = normalizeModelServiceError(Object.assign(new Error('PRIVATE provider request details.'), { status: 429 }));
    completion.mockRejectedValueOnce(error);
    await expect(createAssistantSession(f.user, f.body)).rejects.toMatchObject({ code: 'MODEL_SERVICE_LIMIT_REACHED' });
    const stored = await Session.findOne({ owner: f.user.id, requestId: f.body.requestId });
    const view = await readAssistantSession(f.user.id, String(stored._id));
    expect(view).toMatchObject({ status: 'failed', errorCode: 'MODEL_SERVICE_LIMIT_REACHED', error: expect.stringContaining('usage allowance') });
    expect(JSON.stringify(view)).not.toContain('PRIVATE');
    const replay = await createAssistantSession(f.user, f.body);
    expect(replay.id).toBe(view.id);
    expect(replay.status).toBe('failed');
    expect(completion).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(await Question.findById(f.question._id).lean()).toEqual(beforeQuestion);
    expect((await Quiz.findById(f.quiz._id)).questions.map(String)).toEqual([String(f.question._id)]);
  });

  test('reads rejected observations only for the owned quiz, receipt and failed item', async () => {
    const f = await fixture(); const planned = await createAssistantSession(f.user, f.body);
    const jobId = new mongoose.Types.ObjectId(); const requestId = randomUUID();
    await Session.updateOne({ _id: planned.id }, { $set: { questionJobRequestId: requestId } });
    questionJobs.get.mockResolvedValue({ _id: jobId, quiz: planned.quizId, status: 'failed', active: false, requestId,
      items: [{ index: 0, status: 'failed' }, { index: 1, status: 'ready' }] });
    const novelty = { method: 'lexical-and-semantic', similarity: 0.904, noveltyScore: 0.096,
      lexical: { similarity: 0.6078, threshold: 0.76, questionId: 'lexical-ref', questionText: 'Owned lexical comparison' },
      semantic: { similarity: 0.904, threshold: 0.9, questionId: 'question-15', questionText: 'Owned semantic comparison' } };
    // Match the worker's scoped upsert, then exercise the real owned read.
    await RejectedQuestionDraft.updateOne({ owner: f.user.id, quiz: planned.quizId, job: jobId, index: 0 }, {
      $set: { questionText: 'Owned rejected draft', issues: ['Owned observation'], novelty,
        calculationCheck: { location: 'option 1 feedback', expression: '7 * 8', computed: 56, claimed: 54 } }
    }, { upsert: true, runValidators: true });
    await RejectedQuestionDraft.create([
      { owner: new mongoose.Types.ObjectId(), quiz: planned.quizId, job: jobId, index: 0, questionText: 'Other account private draft' },
      { owner: f.user.id, quiz: planned.quizId, job: new mongoose.Types.ObjectId(), index: 0, questionText: 'Old attempt private draft' },
      { owner: f.user.id, quiz: planned.quizId, job: jobId, index: 1, questionText: 'Prepared item obsolete review' }
    ]);
    const view = await readAssistantSession(f.user.id, planned.id);
    expect(view.generation.items[0].review).toMatchObject({ questionText: 'Owned rejected draft', issues: ['Owned observation'],
      calculationCheck: { location: 'option 1 feedback', expression: '7 * 8', computed: 56, claimed: 54 }, novelty });
    expect(view.generation.items[1].review).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('Other account private');
    expect(JSON.stringify(view)).not.toContain('Old attempt private');
    await expect(readAssistantSession(String(new mongoose.Types.ObjectId()), planned.id)).rejects.toMatchObject({ status: 404 });
  });

  test('reopens only a terminal unpublished batch, clears approval and preserves course questions', async () => {
    const f = await fixture({ existing: true, questions: true });
    const planned = await createAssistantSession(f.user, f.body);
    const request = randomUUID();
    await Session.updateOne({ _id: planned.id }, { $set: { status: 'failed', phase: 'generating',
      errorCode: 'ASSISTANT_QUESTION_BATCH_FAILED', questionJobRequestId: request,
      approvedAt: new Date(), approvedRevision: planned.revision, approvedPlanHash: 'old-approval' } });
    questionJobs.get.mockResolvedValue({ _id: new mongoose.Types.ObjectId(), quiz: planned.quizId,
      status: 'failed', active: false, items: [], requestId: request });
    const edited = await updateAssistantPlan(f.user, planned.id, planEdit(planned, { plan: [{ ...planned.plan[0], count: 3 }] }));
    expect(edited.status).toBe('awaiting_approval');
    const stored = await Session.findById(planned.id);
    expect(stored.approvedPlanHash).toBeUndefined();
    expect(stored.questionJobRequestId).toBeUndefined();
    const quiz = await Quiz.findById(planned.quizId);
    expect(quiz.questions.map(String)).toEqual([String(f.question._id)]);
    expect(quiz.progress.planApproved).toBe(false);
    expect(quiz.settings.planItems[0].count).toBe(3);
  });
  test.each(['succeeded', 'running'])('does not edit an already published or active %s batch', async status => {
    const f = await fixture(); const planned = await createAssistantSession(f.user, f.body);
    await Session.updateOne({ _id: planned.id }, { $set: { status: 'failed', phase: 'generating',
      errorCode: 'ASSISTANT_QUESTION_BATCH_FAILED', questionJobRequestId: randomUUID() } });
    questionJobs.get.mockResolvedValue({ quiz: planned.quizId, status, active: status === 'running' });
    await expect(updateAssistantPlan(f.user, planned.id, planEdit(planned))).rejects.toThrow('stopped question batch');
  });

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

  test('conversational tasks retain canonical objective subpoints, evidence and coverage provenance', async () => {
    const f = await fixture();
    const generate = jest.spyOn(llmService, 'generateLearningObjectives').mockResolvedValue({
      objectives: [{ text: 'Explain evaporation.', subpoints: ['Energy transfer'], bloomLevel: 'understand',
        sourceReferences: [{ materialId: String(f.material._id), materialName: f.material.name,
          excerpt: 'Water evaporates into the atmosphere.', pageNumber: 1, chunkIndex: 0 }] }],
      coverageDiagnostics: { requiredSectionCount: 1, coveredSectionCount: 1 }, llmModel: 'fixture-model'
    });
    const session = await createAssistantSession(f.user, { ...f.body, canonicalObjectives: true });
    expect(session.status).toBe('awaiting_approval');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(completion).toHaveBeenCalledTimes(1);
    const quiz = await Quiz.findById(session.quizId).populate('learningObjectives');
    expect(quiz.learningObjectives[0].generationMetadata).toMatchObject({ subpoints: ['Energy transfer'],
      bloomLevel: 'understand', llmModel: 'fixture-model', coverageDiagnostics: { requiredSectionCount: 1, coveredSectionCount: 1 } });
    expect(quiz.learningObjectives[0].generationMetadata.sourceReferences[0].pageNumber).toBe(1);
  });

  test('explicit selected objectives take priority over other objectives already saved in the target learning object', async () => {
    const f = await fixture({ existing: true });
    const chosen = await LearningObjective.create({ quiz: f.quiz._id, createdBy: f.user.id, text: 'Compare evaporation and condensation.' });
    await Quiz.updateOne({ _id: f.quiz._id }, { $addToSet: { learningObjectives: chosen._id } });
    const planned = await createAssistantSession(f.user, { ...f.body, objectiveIds: [String(chosen._id)] });
    expect(planned.status).toBe('awaiting_approval');
    expect(planned.objectives.map(row => row.id)).toEqual([String(chosen._id)]);
    expect(planned.plan[0].objectiveIds).toEqual([String(chosen._id)]);
    expect((await Quiz.findById(f.quiz._id)).learningObjectives.map(String)).toEqual([String(chosen._id)]);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  test('reused objectives cannot reintroduce source references from unselected materials into the plan', async () => {
    const f = await fixture({ existing: true });
    const excluded = await Material.create({ name: 'Excluded source', type: 'text', content: 'Unselected private context.', folder: f.folder._id,
      uploadedBy: f.user.id, processingStatus: 'completed' });
    await LearningObjective.updateOne({ _id: f.objective._id }, { $set: { 'generationMetadata.sourceReferences': [
      { materialId: f.material._id, materialName: f.material.name, excerpt: 'Water evaporates.' },
      { materialId: excluded._id, materialName: excluded.name, excerpt: 'Unselected private context.' }
    ] } });
    const planned = await createAssistantSession(f.user, { ...f.body, objectiveIds: [String(f.objective._id)] });
    expect(planned.status).toBe('awaiting_approval');
    expect(planned.objectives[0].sourceReferences.map(ref => String(ref.materialId))).toEqual([String(f.material._id)]);
    const stored = await Session.findById(planned.id);
    expect(stored.sources.every(ref => String(ref.materialId) === String(f.material._id))).toBe(true);
    expect(completion.mock.calls[0][0].prompt).not.toContain('Unselected private context.');
  });

  test('an existing learning object with no saved questions uses the exact chosen material scope for its new plan', async () => {
    const f = await fixture({ existing: true });
    const omitted = await Material.create({ name: 'Omitted old material', type: 'text', content: 'Old source scope.', folder: f.folder._id,
      uploadedBy: f.user.id, processingStatus: 'completed' });
    await Quiz.updateOne({ _id: f.quiz._id }, { $addToSet: { materials: omitted._id }, $set: { 'progress.planApproved': true } });
    const planned = await createAssistantSession(f.user, f.body);
    expect(planned.status).toBe('awaiting_approval');
    const updated = await Quiz.findById(f.quiz._id);
    expect(updated.materials.map(String)).toEqual([String(f.material._id)]);
    expect(updated.progress.planApproved).toBe(false);
    expect((await Session.findById(planned.id)).materialIds.map(String)).toEqual(updated.materials.map(String));
  });

  test('an existing learning object with saved questions refuses a different material scope before paid planning', async () => {
    const f = await fixture({ existing: true, questions: true });
    const replacement = await Material.create({ name: 'Replacement source', type: 'text', content: 'A different course topic.', folder: f.folder._id,
      uploadedBy: f.user.id, processingStatus: 'completed' });
    await expect(createAssistantSession(f.user, { ...f.body, materialIds: [String(replacement._id)] }))
      .rejects.toMatchObject({ code: 'STUDIO_ASSISTANT_MATERIAL_SCOPE', message: expect.stringContaining('new Learning Object') });
    expect(completion).not.toHaveBeenCalled();
    const preserved = await Quiz.findById(f.quiz._id);
    expect(preserved.materials.map(String)).toEqual([String(f.material._id)]);
    expect(preserved.questions.map(String)).toEqual([String(f.question._id)]);
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
    expect(completion).toHaveBeenCalledTimes(3);
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

 test('brainstorms and saves a prompt-only plan without inventing evidence', async () => {
   const f = await fixture();
   const value = await createAssistantSession(f.user, { ...f.body, materialIds: [], promptBased: true, instructions: 'Brainstorm objectives for first-year water science and two practice questions.' });
   expect(value.status).toBe('awaiting_approval');
   expect(value.promptBased).toBe(true);
   expect(value.objectives[0].sourceReferences).toEqual([]);
   const quiz = await Quiz.findById(value.quizId);
   expect(quiz.materials).toHaveLength(0);
   expect(quiz.settings.planItems[0].useCustomPromptOnly).toBe(true);
   expect(quiz.settings.planItems[0].learningObjective).toBeTruthy();
   expect(quiz.progress.materialsAssigned).toBe(false);
 });
 test('references an existing LO by copying it into the new plan without altering the original', async () => {
   const f = await fixture({ existing: true, questions: true });
   const value = await createAssistantSession(f.user, { ...f.body, quizId: undefined, materialIds: [], promptBased: true, objectiveIds: [String(f.objective._id)] });
   expect(value.status).toBe('awaiting_approval');
   expect(value.objectives[0].text).toBe(f.objective.text);
   expect(value.objectives[0].id).not.toBe(String(f.objective._id));
   expect(String((await Question.findById(f.question._id)).learningObjective)).toBe(String(f.objective._id));
   expect(completion.mock.calls.some(([arg]) => arg.jsonSchema.name === 'studio_assistant_objectives')).toBe(false);
 });

test('explicit fifteen-question request overrides a smaller AI allocation before approval', async () => {
  const f = await fixture();
  const planned = await createAssistantSession(f.user, { ...f.body, instructions: 'Create around 15 questions about evaporation.' });
  expect(planned.status).toBe('awaiting_approval');
  expect(planned.plan.reduce((n, row) => n + row.count, 0)).toBe(15);
  expect(planned.teachingRequirements.fields.questionCount.value).toBe(15);
  const quiz = await Quiz.findById(planned.quizId);
  expect(quiz.settings.planItems.reduce((n, row) => n + row.count, 0)).toBe(15);
  const edited = await updateAssistantPlan(f.user, planned.id, planEdit(planned, { plan: [{ ...planned.plan[0], count: 6 }] }));
  expect(edited.teachingRequirements.fields.questionCount).toMatchObject({ value: 6, source: 'plan-edit' });
});

test('legacy approval also rejects a newer conversation count until the plan is revised', async () => {
  const f = await fixture(); const planned = await createAssistantSession(f.user, f.body);
  await AuthoringSession.create({ owner: f.user.id, requestId: randomUUID(), courseId: f.folder._id,
    assistantId: planned.id, teachingRequirements: { fields: { questionCount: { value: 15 } } } });
  await expect(approveAssistantPlan(f.user, planned.id, { revision: planned.revision, requestId: randomUUID() }))
    .rejects.toMatchObject({ code: 'STUDIO_ASSISTANT_REQUIREMENTS' });
  expect((await Session.findById(planned.id)).approvedAt).toBeFalsy();
});
