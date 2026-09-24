import mongoose from 'mongoose';
import { setTimeout as delay } from 'node:timers/promises';
import Quiz from '../models/Quiz.js';
import questionGenerationJobs, { questionGenerationRequestHash, serializeQuestionJob } from './questionGenerationJobs.js';
import { createQuestionBatchWork, normalizeGenerationConfigs } from './questionBatchGeneration.js';
import { getGenerationReadiness, isMaterialReady } from '../utils/generationReadiness.js';
import { getH5PTypeAdapter } from '../config/h5pTypeAdapterRegistry.js';
import { buildNativeH5PDocument } from './h5pExportService.js';

const failure = (message, code, status = 409) => Object.assign(new Error(message), { code, status });

export function expandAssistantQuestionPlan(quiz) {
  const rows = quiz.settings?.planItems || [];
  if (!rows.length || rows.length > 8) throw failure('Save a question plan with between 1 and 8 rows before approving it.', 'ASSISTANT_PLAN_INVALID', 400);
  const configs = [];
  for (const row of rows) {
    if (!Number.isInteger(row.count) || row.count < 1 || configs.length + row.count > 20) {
      throw failure('An assistant plan can generate between 1 and 20 questions.', 'ASSISTANT_PLAN_INVALID', 400);
    }
    const objectiveId = row.learningObjective?._id || row.learningObjective;
    if (!objectiveId) throw failure('Every assistant question row must use a saved learning objective.', 'ASSISTANT_PLAN_INVALID', 400);
    const config = {
      questionType: row.type, learningObjectiveId: String(objectiveId), difficulty: row.difficulty || 'moderate',
      customPrompt: row.customPrompt || '', useCustomPromptOnly: false,
      ...Object.fromEntries(['pedagogicalIntent', 'bloomLevel', 'focusArea', 'selectionMode', 'branchingLayers', 'branchingChoices']
        .filter(key => row[key] !== undefined && row[key] !== null).map(key => [key, row[key]])),
      ...(row.rationale ? { planRationale: row.rationale } : {})
    };
    for (let index = 0; index < row.count; index++) configs.push({ ...config });
  }
  return configs;
}

export function createAssistantGenerationService({ QuizModel = Quiz, jobs = questionGenerationJobs,
  createWork = createQuestionBatchWork, buildDocument = buildNativeH5PDocument, pollMs = 500 } = {}) {
  const loadQuiz = (quizId, owner) => QuizModel.findOne({ _id: quizId, createdBy: owner })
    .populate('materials').populate('learningObjectives')
    .populate({ path: 'questions', populate: { path: 'learningObjective', select: 'text order' }, options: { sort: { order: 1 } } });

  return async function runAssistantGeneration({ user, userId, quizId, requestId, materialIds, questionConfigs,
    assertActive = async () => {}, assertQuizSnapshot = async () => {}, onProgress = async () => {}, signal }) {
    const owner = String(userId || user?.id || user?._id || '');
    if (!mongoose.isValidObjectId(owner) || !mongoose.isValidObjectId(quizId) || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '')) {
      throw failure('A valid author, learning object and generation request are required.', 'ASSISTANT_GENERATION_INVALID', 400);
    }
    const controller = new AbortController();
    const cancel = () => controller.abort(failure('The assistant task was interrupted. Check its saved status before retrying.', 'GENERATION_INTERRUPTED'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const checkContext = async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      try { await assertActive(); }
      catch (error) { controller.abort(error); throw error; }
    };
    let lastProgress;
    const report = async job => {
      const serialized = serializeQuestionJob(job);
      const signature = JSON.stringify(serialized);
      if (signature === lastProgress) return;
      lastProgress = signature;
      // Delivery is optional; the durable question receipt remains authoritative.
      try { await onProgress({ ...serialized,
        stage: job.status === 'succeeded' ? 'questions-published' : job.active ? 'generating-questions' : 'generation-stopped',
        readyCount: serialized.completedQuestions,
        published: job.status === 'succeeded'
      }); } catch { /* A failed progress notification must not purchase a retry. */ }
    };

    try {
      await checkContext();
      const quiz = await loadQuiz(quizId, owner);
      if (!quiz) throw failure('Learning object not found.', 'NOT_FOUND', 404);
      const previous = await jobs.get(owner, requestId);
      if (!previous) await assertQuizSnapshot(quiz);
      const configs = normalizeGenerationConfigs(questionConfigs || expandAssistantQuestionPlan(quiz));
      if (configs.length > 20 || configs.some(config => !getH5PTypeAdapter(config.questionType)?.containers.includes('column'))) {
        throw failure('Choose at most 20 questions using supported Column question types.', 'ASSISTANT_PLAN_INVALID', 400);
      }
      if (previous?.abandoned) throw failure('This generation request was closed. Start a new attempt.', 'GENERATION_REQUEST_ABANDONED');
      if (previous && previous.requestHash !== questionGenerationRequestHash({ quizId, mode: 'append', questionConfigs: configs })) {
        throw failure('This request ID belongs to a different approved question plan.', 'REQUEST_ID_CONFLICT');
      }
      let readiness = { ready: true };
      if (!previous) {
        if (quiz.questions.some(question => !getH5PTypeAdapter(question.type)?.containers.includes('column'))) {
          throw failure('This learning object contains questions that cannot be combined in a Column package. Choose a compatible learning object before generating.', 'ASSISTANT_CONTAINER_INCOMPATIBLE', 400);
        }
        const suppliedIds = materialIds === undefined ? quiz.materials.map(material => material._id) : materialIds;
        if (!Array.isArray(suppliedIds) || !suppliedIds.length || suppliedIds.some(id => !mongoose.isValidObjectId(id))) {
          throw failure('Select processed course materials before generating questions.', 'ASSISTANT_MATERIALS_INVALID', 400);
        }
        const selectedIds = suppliedIds.map(String);
        if (new Set(selectedIds).size !== selectedIds.length) {
          throw failure('Select processed course materials before generating questions.', 'ASSISTANT_MATERIALS_INVALID', 400);
        }
        const selected = selectedIds.map(id => quiz.materials.find(material => String(material._id) === id));
        if (selected.some(material => !material || String(material.uploadedBy) !== owner || String(material.folder) !== String(quiz.folder))) {
          throw failure('A selected material is no longer assigned to this learning object or owned by this author.', 'ASSISTANT_MATERIALS_CHANGED');
        }
        if (selected.some(material => !isMaterialReady(material))) throw failure('Every selected material must finish processing before question generation.', 'MATERIALS_NOT_READY');
        if (configs.some(config => !config.learningObjectiveId || !quiz.learningObjectives.some(objective => String(objective._id) === config.learningObjectiveId))) {
          throw failure('A planned learning objective is no longer part of this learning object.', 'ASSISTANT_OBJECTIVES_CHANGED');
        }
        readiness = getGenerationReadiness({ materials: selected }, configs);
        if (!readiness.ready) throw failure(readiness.message, readiness.code, readiness.status);
      }
      await checkContext();
      let job = await jobs.start({ owner, quizId, requestId, mode: 'append', questionConfigs: configs,
        expectedQuizVersion: quiz.__v || 0, signal: controller.signal, assertContextActive: checkContext,
        work: createWork({ quiz, questionConfigs: configs, readiness, userId: owner, mode: 'append' }) });
      while (true) {
        await checkContext();
        await report(job);
        if (!job.active) break;
        await delay(pollMs, undefined, { signal: controller.signal });
        job = await jobs.get(owner, requestId);
        if (!job) throw failure('The generation receipt could not be found. Keep the request ID and check again.', 'GENERATION_RECOVERY_FAILED', 503);
      }
      if (job.status !== 'succeeded') {
        throw Object.assign(failure(job.status === 'failed'
          ? 'The question batch failed. No questions from this batch were added. An explicit retry generates the whole batch again and may use additional AI credits.'
          : job.message || 'Generation did not complete. Existing questions are unchanged.',
        job.status === 'conflict' ? 'GENERATION_SNAPSHOT_CHANGED' : job.status === 'interrupted' ? 'GENERATION_INTERRUPTED' : 'ASSISTANT_QUESTION_BATCH_FAILED'), {
          job: serializeQuestionJob(job)
        });
      }
      await checkContext();
      const published = await loadQuiz(quizId, owner);
      if (!published) throw failure('Learning object not found.', 'NOT_FOUND', 404);
      const visibleIds = new Set(published.questions.map(question => String(question._id)));
      if (job.questionIds.some(id => !visibleIds.has(String(id)))) {
        throw failure('Some generated questions were changed or removed. Review the current learning object before creating its Studio draft.', 'GENERATION_SNAPSHOT_CHANGED');
      }
      const document = await buildDocument(published, { containerMode: 'column' });
      await checkContext();
      return { job: serializeQuestionJob(job), jobId: String(job._id), quiz: published, document };
    } catch (error) {
      if (!controller.signal.aborted) controller.abort(error);
      throw error;
    } finally { signal?.removeEventListener('abort', cancel); }
  };
}

export const runAssistantGeneration = createAssistantGenerationService();
export default runAssistantGeneration;
