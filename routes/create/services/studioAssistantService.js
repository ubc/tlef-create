import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Session from '../models/StudioAssistantSession.js';
import Folder from '../models/Folder.js';
import Material from '../models/Material.js';
import Quiz from '../models/Quiz.js';
import LearningObjective from '../models/LearningObjective.js';
import Question from '../models/Question.js';
import H5PContent from '../models/H5PContent.js';
import QuestionGenerationJob from '../models/QuestionGenerationJob.js';
import studioJobs from './studioGenerationJobs.js';
import questionJobs, { serializeQuestionJob } from './questionGenerationJobs.js';
import { withQuestionMutation } from './questionPublication.js';
import { isMaterialReady } from '../utils/generationReadiness.js';
import { getH5PTypeAdapter } from '../config/h5pTypeAdapterRegistry.js';
import { buildH5PSourceFingerprint, saveNativeH5PDocumentAndRecord } from './h5pEditorService.js';
import { buildNativeH5PDocument } from './h5pExportService.js';
import { getEditor, getSystemUser, toLumiUser, finalizeContentOwnership } from './lumiService.js';
import { buildAssistantContext, proposeAssistantObjectives, proposeAssistantPlan,
  validateAssistantApproval, fingerprintAssistantMaterials } from './studioAssistantPlanning.js';
import { runAssistantGeneration } from './studioAssistantGeneration.js';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, status = 409, code = 'STUDIO_ASSISTANT_CONFLICT') => { throw Object.assign(new Error(message), { status, code }); };
const objectId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const requestIdValid = value => typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
const assistantRunId = (sessionId, phase, requestId) => `asst-${sessionId}-${digest({ phase, requestId }).slice(0, 40)}`;
function matchesAssistantRun(session, phase, requestId) {
  if (session.phase !== phase) return false;
  if (session.currentJobId === assistantRunId(session._id, phase, requestId)) return true;
  // Older UUID receipts encoded the exact request ID. Keep replay recovery for
  // those IDs, but do not treat a truncated long-ID prefix as proof of identity.
  return requestId.length <= 40 && session.currentJobId === `asst-${session._id}-${requestId}`;
}
const event = (stage, message) => ({ stage, message, createdAt: new Date() });
const sourceChanged = () => fail('The course materials or learning object changed. Start a new assistant task to review an updated plan. Existing work is preserved.', 409, 'STUDIO_ASSISTANT_SOURCE_CHANGED');
const loadQuiz = (id, owner) => Quiz.findOne({ _id: id, createdBy: owner }).populate('learningObjectives').populate('questions');
const quizFingerprint = quiz => digest({ content: buildH5PSourceFingerprint(quiz), materials: quiz.materials.map(material => String(material._id || material)), settings: quiz.settings });
function assertColumnCompatibleQuiz(quiz) {
  if ((quiz.questions || []).some(question => !getH5PTypeAdapter(question?.type)?.containers?.includes('column'))) {
    fail('This learning object contains questions that cannot be combined in a Column package. Choose a compatible learning object or create a new one. Existing questions and settings are unchanged.',
      400, 'ASSISTANT_CONTAINER_INCOMPATIBLE');
  }
}
const safeError = error => {
  const safe = /^(?:STUDIO_ASSISTANT_|H5P_ASSISTANT_|H5P_AI_|QUESTION_EDIT_)/.test(error?.code || '')
    || ['MATERIALS_NOT_READY', 'NOT_FOUND', 'H5P_EDITOR_NOT_READY', 'ASSISTANT_QUESTION_BATCH_FAILED',
      'ASSISTANT_CONTAINER_INCOMPATIBLE', 'ASSISTANT_MATERIALS_CHANGED', 'ASSISTANT_OBJECTIVES_CHANGED',
      'ASSISTANT_PLAN_INVALID', 'GENERATION_SNAPSHOT_CHANGED', 'GENERATION_INTERRUPTED', 'REQUEST_ID_CONFLICT'].includes(error?.code);
  return {
    error: safe ? error.message : 'This step could not finish. Check your model/key and materials, then explicitly retry. Existing course questions are preserved.',
    errorCode: safe ? error.code : 'STUDIO_ASSISTANT_FAILED'
  };
};

export function serializeAssistantSession(session) {
  return {
    id: String(session._id), requestId: session.requestId, courseId: String(session.courseId),
    quizId: String(session.quizId), quizName: session.quizName, materialIds: session.materialIds.map(String),
    instructions: session.instructions, revision: session.revision, status: session.status, phase: session.phase,
    objectives: session.objectives, plan: session.plan, outputs: session.outputs, events: session.events,
    error: session.error, errorCode: session.errorCode, currentJobId: session.currentJobId,
    approvedAt: session.approvedAt, createdAt: session.createdAt, updatedAt: session.updatedAt
  };
}

async function ownedMaterials(session) {
  if (!await Folder.exists({ _id: session.courseId, instructor: session.owner })) fail('Course not found.', 404, 'NOT_FOUND');
  const materials = await Material.find({ _id: { $in: session.materialIds }, folder: session.courseId, uploadedBy: session.owner });
  if (materials.length !== session.materialIds.length) fail('Selected materials are no longer available in this course.', 409, 'STUDIO_ASSISTANT_SOURCE_CHANGED');
  if (materials.some(material => !isMaterialReady(material))) fail('Wait for all selected materials to finish processing, or retry failed materials.', 409, 'MATERIALS_NOT_READY');
  return materials;
}

async function assertSources(session) {
  const materials = await ownedMaterials(session);
  if (session.materialSignature && fingerprintAssistantMaterials(materials) !== session.materialSignature) sourceChanged();
  if (!await Quiz.exists({ _id: session.quizId, createdBy: session.owner, folder: session.courseId })) fail('Learning object not found.', 404, 'NOT_FOUND');
  return materials;
}

async function ownedSession(owner, id) {
  if (!objectId(id)) fail('Assistant task not found.', 404, 'NOT_FOUND');
  const session = await Session.findOne({ _id: id, owner });
  if (!session) fail('Assistant task not found.', 404, 'NOT_FOUND');
  return session;
}

async function ensureQuiz(session) {
  let quiz = await loadQuiz(session.quizId, session.owner);
  if (!quiz && session.createdQuiz) {
    await Quiz.updateOne({ _id: session.quizId }, { $setOnInsert: {
      name: session.quizName, folder: session.courseId, createdBy: session.owner,
      materials: session.materialIds, status: 'materials-assigned', 'progress.materialsAssigned': true
    } }, { upsert: true, runValidators: true, setDefaultsOnInsert: true });
    quiz = await loadQuiz(session.quizId, session.owner);
  }
  if (!quiz || String(quiz.folder) !== String(session.courseId)) fail('Learning object not found in this course.', 404, 'NOT_FOUND');
  assertColumnCompatibleQuiz(quiz);
  await Folder.updateOne({ _id: session.courseId, instructor: session.owner }, { $addToSet: { quizzes: session.quizId }, $set: { 'stats.lastActivity': new Date() } });
  await Folder.updateOne({ _id: session.courseId, instructor: session.owner }, { $set: {
    'stats.totalQuizzes': await Quiz.countDocuments({ folder: session.courseId, createdBy: session.owner })
  } });
  const missing = session.materialIds.filter(id => !quiz.materials.some(existing => String(existing) === String(id)));
  if (missing.length) await withQuestionMutation(Quiz, quiz._id, session.owner, mutation => mutation.writeQuiz({
    $addToSet: { materials: { $each: missing } }, $set: { 'progress.materialsAssigned': true }
  }));
  return loadQuiz(session.quizId, session.owner);
}

// New objectives are staged first and published by one Quiz manifest update.
// Existing objectives referenced by questions retain their identity and text.
async function saveBlueprint(session, proposed, expectedFingerprint, assertActive = async () => {}) {
  const normalized = validateAssistantApproval(proposed, undefined, session.sources);
  const original = await loadQuiz(session.quizId, session.owner);
  if (!original || (expectedFingerprint && quizFingerprint(original) !== expectedFingerprint)) sourceChanged();
  assertColumnCompatibleQuiz(original);
  const existing = new Map(original.learningObjectives.map(objective => [String(objective._id), objective]));
  const referenced = new Set(original.questions.map(question => String(question.learningObjective || '')));
  for (const id of referenced) {
    const before = existing.get(id);
    if (before && !normalized.objectives.some(objective => objective.id === id && objective.text === before.text)) {
      fail('An objective already used by course questions must be edited in Learning Objectives. Keep it here or start a new learning object.', 409, 'STUDIO_ASSISTANT_OBJECTIVE_IN_USE');
    }
  }
  const candidates = [];
  const mapping = new Map();
  const objectives = [];
  for (const objective of normalized.objectives) {
    const previous = existing.get(objective.id);
    if (previous && previous.text === objective.text) {
      mapping.set(objective.id, String(previous._id));
      objectives.push({ ...objective, id: String(previous._id), sourceReferences: previous.generationMetadata?.sourceReferences || [] });
    } else {
      const candidate = new LearningObjective({ quiz: session.quizId, createdBy: session.owner,
        text: objective.text, order: objectives.length, generatedFrom: session.materialIds,
        generationMetadata: { isAIGenerated: true, sourceReferences: objective.sourceReferences, generationPrompt: 'Studio assistant approved teaching brief' }
      });
      await candidate.validate(); candidates.push(candidate); mapping.set(objective.id, String(candidate._id));
      objectives.push({ ...objective, id: String(candidate._id) });
    }
  }
  const plan = normalized.plan.map(row => ({ ...row, objectiveIds: row.objectiveIds.map(id => mapping.get(id)) }));
  // Keep staged objectives if publication has an uncertain database outcome.
  // A delayed successful manifest write must never reference deleted records.
    for (const candidate of candidates) { await assertActive(); await candidate.save(); }
    await withQuestionMutation(Quiz, session.quizId, session.owner, async mutation => {
      await assertActive();
      const current = await loadQuiz(session.quizId, session.owner);
      if (quizFingerprint(current) !== quizFingerprint(original)) sourceChanged();
      await mutation.writeQuiz({ $set: {
        learningObjectives: objectives.map(objective => new mongoose.Types.ObjectId(objective.id)),
        'settings.planMode': 'ai-auto', 'settings.deliveryTarget': 'h5p-package', 'settings.targetFormat': 'column',
        'settings.planItems': plan.map(row => ({ type: row.questionType, learningObjective: row.objectiveIds[0], count: row.count,
          customPrompt: row.instructions || '', difficulty: row.difficulty || 'moderate', pedagogicalIntent: 'support',
          selectionMode: 'single', useCustomPromptOnly: false, rationale: row.title })),
        'progress.objectivesSet': true, 'progress.planGenerated': true, 'progress.planApproved': false,
        ...(current.questions.length ? {} : { status: 'plan-generated' })
      } });
    });
    return { objectives, plan, quizFingerprint: quizFingerprint(await loadQuiz(session.quizId, session.owner)) };
}

async function patchActive(session, values, nextEvent) {
  const result = await Session.findOneAndUpdate({ _id: session._id, owner: session.owner,
    currentJobId: session.currentJobId, status: { $in: ['planning', 'generating'] } }, {
    $set: values, ...(nextEvent ? { $push: { events: { $each: [nextEvent], $slice: -80 } } } : {})
  }, { new: true });
  if (!result) fail('This assistant attempt is no longer active.', 409, 'H5P_AI_INTERRUPTED');
  return result;
}

async function planSession(session, assertActive) {
  await assertActive();
  const materials = await ownedMaterials(session);
  const quiz = await ensureQuiz(session);
  const before = quizFingerprint(quiz);
  await patchActive(session, {}, event('materials', 'Reading the selected course materials and their source evidence.'));
  const context = await buildAssistantContext(materials, { userId: String(session.owner) });
  await assertActive();
  const reused = quiz.learningObjectives.map(objective => ({ id: String(objective._id), text: objective.text,
    sourceReferences: objective.generationMetadata?.sourceReferences || [] }));
  const sources = [...context.sources, ...reused.flatMap(objective => objective.sourceReferences)];
  session = await patchActive(session, { sources, materialSignature: fingerprintAssistantMaterials(materials), materialFingerprint: context.materialFingerprint },
    event('objectives', reused.length ? 'Reusing the learning objectives already saved in this learning object.' : 'Drafting learning objectives from the selected materials.'));
  const objectives = reused.length ? reused : await proposeAssistantObjectives({ instructions: session.instructions, context: context.context, sources, userId: String(session.owner) });
  await assertActive();
  await patchActive(session, { objectives }, event('plan', 'Recommending question types and quantities for the learning objectives.'));
  const plan = await proposeAssistantPlan({ instructions: session.instructions, objectives, context: context.context, userId: String(session.owner) });
  await assertActive(); await assertSources(session);
  const saved = await saveBlueprint(session, { objectives, plan }, before, assertActive);
  await patchActive(session, { ...saved, status: 'awaiting_approval', error: '', errorCode: '' },
    event('approval', 'Learning objectives and the blueprint are saved in your course. Review or edit them, then approve question generation.'));
}

async function saveFinalContent(session, user, document, quiz, assertActive) {
  const existing = await H5PContent.findOne({ owner: session.owner, assistantSessionId: session._id });
  if (existing) return existing;
  const editor = getEditor();
  if (!editor) fail('The H5P editor is still starting. Retry to prepare the saved questions for Studio.', 503, 'H5P_EDITOR_NOT_READY');
  await H5PContent.init(); await assertActive();
  try {
    const saved = await saveNativeH5PDocumentAndRecord({ editor, document, user: toLumiUser(user), cleanupUser: getSystemUser(),
      createRecord: async result => {
        await assertActive();
        return H5PContent.create({ owner: session.owner, folder: session.courseId, quiz: session.quizId,
          assistantSessionId: session._id, lumiContentId: result.id, title: document.metadata.title,
          mainLibrary: document.library.split(' ')[0], source: 'generated', status: 'draft',
          sourceFingerprint: buildH5PSourceFingerprint(quiz), sourceQuizUpdatedAt: quiz.updatedAt });
      }
    });
    finalizeContentOwnership(saved.result.id);
    return saved.record;
  } catch (error) {
    if (error.code === 11000) {
      const record = await H5PContent.findOne({ owner: session.owner, assistantSessionId: session._id });
      if (record) return record;
    }
    throw error;
  }
}

async function generateSession(session, user, assertActive) {
  await assertSources(session); await assertActive();
  await patchActive(session, {}, event('generating', 'Building the approved questions. Live previews are drafts until the whole batch succeeds.'));
  const result = await runAssistantGeneration({ user, quizId: String(session.quizId), requestId: session.questionJobRequestId,
    materialIds: session.materialIds.map(String),
    assertQuizSnapshot: quiz => { if (quizFingerprint(quiz) !== session.quizFingerprint) sourceChanged(); },
    assertActive: async () => { await assertActive(); await assertSources(session); },
    onProgress: async progress => {
      await assertActive();
      await patchActive(session, {}, event(progress.stage || 'generating', progress.message || 'Generating the approved question batch.'));
    }
  });
  await assertActive();
  await patchActive(session, {}, event('studio', 'Questions are saved in the course. Preparing the official H5P editor draft.'));
  const content = await saveFinalContent(session, user, result.document, result.quiz, assertActive);
  await patchActive(session, { status: 'completed', error: '', errorCode: '', outputs: [{
    contentId: content.lumiContentId, title: content.title, planItemId: 'approved-plan', index: 0
  }] }, event('completed', 'The course questions and Studio draft are ready. Open the official editor to continue editing.'));
}

async function launch(session, user, phase, requestId) {
  if (!requestIdValid(requestId)) fail('A valid request ID is required.', 400, 'VALIDATION_ERROR');
  const runId = assistantRunId(session._id, phase, requestId);
  const claimed = await Session.findOneAndUpdate({ _id: session._id, owner: session.owner, revision: session.revision,
    status: session.status, currentJobId: session.currentJobId || { $exists: false } }, {
    $set: { status: phase, phase, currentJobId: runId, error: '', errorCode: '' }, $inc: { revision: 1, attempt: 1 }
  }, { new: true });
  if (!claimed) fail('This task changed in another tab. Reload the saved task before continuing.');
  try {
    await studioJobs.start(String(claimed.owner), runId, async checkJob => {
      const active = async () => {
        await checkJob();
        if (!await Session.exists({ _id: claimed._id, owner: claimed.owner, currentJobId: runId, status: phase })) fail('This assistant attempt is no longer active.', 409, 'H5P_AI_INTERRUPTED');
      };
      try {
        if (phase === 'planning') await planSession(claimed, active);
        else await generateSession(claimed, user, active);
        return undefined;
      } catch (error) {
        await Session.updateOne({ _id: claimed._id, currentJobId: runId, status: phase }, {
          $set: { status: error.code === 'H5P_AI_INTERRUPTED' ? 'interrupted' : 'failed', ...safeError(error) },
          $push: { events: { $each: [event('error', safeError(error).error)], $slice: -80 } }
        });
        throw error;
      }
    });
  } catch (error) {
    await Session.updateOne({ _id: claimed._id, currentJobId: runId, status: phase }, { $set: { status: 'failed', ...safeError(error) } });
    throw error;
  }
  return readAssistantSession(String(session.owner), String(session._id));
}

export async function readAssistantSession(owner, id) {
  let session = await ownedSession(owner, id);
  if (['planning', 'generating'].includes(session.status)) {
    const job = session.currentJobId ? await studioJobs.get(owner, session.currentJobId) : null;
    if ((job && ['failed', 'interrupted'].includes(job.status))
      || ((!job || job.status === 'succeeded') && Date.now() - +session.updatedAt > 120000)) {
      await Session.updateOne({ _id: session._id, currentJobId: session.currentJobId, status: session.status }, { $set: {
        status: 'interrupted', error: 'This task was interrupted. Review the saved progress and explicitly retry to continue.', errorCode: 'H5P_AI_INTERRUPTED'
      } });
      session = await ownedSession(owner, id);
    }
  }
  const value = serializeAssistantSession(session);
  if (session.questionJobRequestId) {
    const job = await questionJobs.get(owner, session.questionJobRequestId);
    if (job && String(job.quiz) === String(session.quizId)) {
      const serialized = serializeQuestionJob(job);
      value.generation = { ...serialized, totalQuestions: job.items.length, readyCount: job.items.filter(item => item.status === 'ready').length };
      value.previewVersion = value.generation.readyCount;
    }
  }
  return value;
}

export async function listAssistantSessions(owner) {
  const sessions = await Session.find({ owner }).sort({ updatedAt: -1 }).limit(30);
  return sessions.map(serializeAssistantSession);
}

export async function createAssistantSession(user, body) {
  const owner = String(user.id);
  if (!requestIdValid(body.requestId) || !objectId(body.courseId) || (body.quizId && !objectId(body.quizId))
    || !Array.isArray(body.materialIds) || !body.materialIds.length || body.materialIds.length > 20
    || body.materialIds.some(id => !objectId(id)) || new Set(body.materialIds).size !== body.materialIds.length
    || typeof body.instructions !== 'string' || body.instructions.trim().length < 10 || body.instructions.length > 12000) {
    fail('Choose a course, 1–20 processed materials, and describe the task in 10–12,000 characters.', 400, 'VALIDATION_ERROR');
  }
  const requestHash = digest({ courseId: body.courseId, quizId: body.quizId || null, materialIds: [...body.materialIds].sort(), instructions: body.instructions.trim() });
  const previous = await Session.findOne({ owner, requestId: body.requestId });
  if (previous) {
    if (previous.requestHash !== requestHash) fail('This request ID belongs to different instructions.', 409, 'REQUEST_ID_CONFLICT');
    return readAssistantSession(owner, String(previous._id));
  }
  const draft = { owner, courseId: body.courseId, materialIds: body.materialIds };
  await ownedMaterials(draft);
  const existingQuiz = body.quizId ? await loadQuiz(body.quizId, owner) : null;
  if (body.quizId && (!existingQuiz || String(existingQuiz.folder) !== body.courseId)) fail('Learning object not found in this course.', 404, 'NOT_FOUND');
  if (existingQuiz) assertColumnCompatibleQuiz(existingQuiz);
  const id = new mongoose.Types.ObjectId();
  await Session.init();
  let session;
  try {
    session = await Session.create({ ...draft, _id: id, requestId: body.requestId, requestHash,
      quizId: existingQuiz?._id || new mongoose.Types.ObjectId(), createdQuiz: !existingQuiz,
      quizName: existingQuiz?.name || `Studio learning object ${String(id).slice(-6)}`,
      instructions: body.instructions.trim(), status: 'planning', phase: 'planning', events: [event('started', 'Preparing the course workspace.')] });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicate = await Session.findOne({ owner, requestId: body.requestId });
    if (!duplicate || duplicate.requestHash !== requestHash) fail('This request ID belongs to different instructions.', 409, 'REQUEST_ID_CONFLICT');
    return readAssistantSession(owner, String(duplicate._id));
  }
  await ensureQuiz(session);
  return launch(session, user, 'planning', body.requestId);
}

export async function updateAssistantPlan(user, id, body) {
  const session = await ownedSession(String(user.id), id);
  if (session.status !== 'awaiting_approval' || session.revision !== body.revision) fail('Reload the current plan before saving.');
  await assertSources(session);
  // Reserve this edit before changing the shared learning object. Approval and
  // concurrent saves cannot run against the previous plan while it is saving.
  const reserved = await Session.findOneAndUpdate({ _id: session._id, owner: session.owner, revision: body.revision, status: 'awaiting_approval' }, {
    $set: { status: 'planning' }, $inc: { revision: 1 }
  }, { new: true });
  if (!reserved) fail('This plan is already being changed. Reload it before continuing.');
  try {
    const saved = await saveBlueprint(reserved, body, session.quizFingerprint);
    await Session.updateOne({ _id: session._id, revision: reserved.revision, status: 'planning' }, { $set: { ...saved, status: 'awaiting_approval', error: '' } });
  } catch (error) {
    await Session.updateOne({ _id: session._id, revision: reserved.revision, status: 'planning' }, { $set: { status: 'awaiting_approval' } });
    throw error;
  }
  return readAssistantSession(String(user.id), id);
}

export async function approveAssistantPlan(user, id, body) {
  let session = await ownedSession(String(user.id), id);
  if (!requestIdValid(body.requestId)) fail('A valid request ID is required.', 400, 'VALIDATION_ERROR');
  if (matchesAssistantRun(session, 'generating', body.requestId)) return readAssistantSession(String(user.id), id);
  if (session.status !== 'awaiting_approval' || session.revision !== body.revision) fail('Review and save the current plan before approving it.');
  await assertSources(session);
  const quiz = await loadQuiz(session.quizId, session.owner);
  if (quizFingerprint(quiz) !== session.quizFingerprint) sourceChanged();
  validateAssistantApproval(session, undefined, session.sources);
  session = await Session.findOneAndUpdate({ _id: session._id, owner: session.owner, revision: body.revision, status: 'awaiting_approval' }, {
    $set: { approvedRevision: session.revision, approvedAt: new Date(), approvedPlanHash: digest({ objectives: session.objectives, plan: session.plan }),
      questionJobRequestId: `asst-q-${session._id}-${session.attempt + 1}` }, $inc: { revision: 1 }
  }, { new: true });
  if (!session) fail('This plan changed before approval. Reload it.');
  await withQuestionMutation(Quiz, session.quizId, session.owner, async mutation => {
    const current = await loadQuiz(session.quizId, session.owner);
    if (quizFingerprint(current) !== session.quizFingerprint) sourceChanged();
    await mutation.writeQuiz({ $set: { 'progress.planApproved': true, ...(current.questions.length ? {} : { status: 'plan-approved' }) } });
  });
  return launch(session, user, 'generating', body.requestId);
}

export async function resumeAssistantSession(user, id, body) {
  let session = await ownedSession(String(user.id), id);
  if (!requestIdValid(body.requestId)) fail('A valid request ID is required.', 400, 'VALIDATION_ERROR');
  if (matchesAssistantRun(session, session.phase, body.requestId)) return readAssistantSession(String(user.id), id);
  if (!['failed', 'interrupted'].includes(session.status) || session.revision !== body.revision) fail('Reload the current task before retrying.');
  await assertSources(session);
  if (session.phase === 'generating') {
    if (!session.approvedAt || digest({ objectives: session.objectives, plan: session.plan }) !== session.approvedPlanHash) fail('This task needs a newly approved plan.');
    const previous = await questionJobs.get(String(user.id), session.questionJobRequestId);
    if (!previous || !['running', 'succeeded'].includes(previous.status)) {
      const quiz = await loadQuiz(session.quizId, session.owner);
      if (quizFingerprint(quiz) !== session.quizFingerprint) sourceChanged();
      session.questionJobRequestId = `asst-q-${session._id}-${session.attempt + 1}`;
      const saved = await Session.findOneAndUpdate({ _id: session._id, owner: session.owner, revision: session.revision, status: session.status }, {
        $set: { questionJobRequestId: session.questionJobRequestId }, $inc: { revision: 1 }
      }, { new: true });
      if (!saved) fail('This task changed before retry.');
      session = saved;
    }
  }
  return launch(session, user, session.phase, body.requestId);
}

export async function assistantPreviewDocument(owner, id) {
  const session = await ownedSession(owner, id);
  const quiz = await loadQuiz(session.quizId, owner);
  if (!quiz) fail('Learning object not found.', 404, 'NOT_FOUND');
  const job = session.questionJobRequestId ? await QuestionGenerationJob.findOne({ owner, requestId: session.questionJobRequestId, quiz: session.quizId }) : null;
  if (!job) fail('No generated questions are ready to preview yet.', 404, 'NOT_FOUND');
  const readyIds = job.items.filter(item => item.status === 'ready').map(item => item.savedQuestionId);
  const questions = await Question.find({ _id: { $in: readyIds }, quiz: session.quizId, createdBy: owner, generationJob: job._id }).sort({ order: 1 });
  if (!questions.length) fail('No generated questions are ready to preview yet.', 404, 'NOT_FOUND');
  return buildNativeH5PDocument({ ...quiz.toObject(), questions, settings: { ...(quiz.settings.toObject?.() || quiz.settings), targetFormat: 'column' }, containerMode: 'column', chapters: [] }, { containerMode: 'column' });
}
