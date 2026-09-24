import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import QuestionGenerationJob from '../models/QuestionGenerationJob.js';
import Quiz from '../models/Quiz.js';
import Question from '../models/Question.js';
import { freeQuestionMutation } from './questionPublication.js';

const LEASE_MS = 120_000;
const MAX_RUN_MS = 90 * 60_000;
const interruptedMessage = 'Generation was interrupted. Your previous questions are unchanged. Start a new attempt only when you are ready; CREATE will not automatically spend more AI credits.';
const conflictMessage = 'The learning object or its questions changed while this batch was generating. Your current questions are unchanged. Review them before starting a new attempt.';
const failureMessage = 'This batch could not be completed. Your previous questions are unchanged. Review the failed items before starting a new attempt.';
const abandonedMessage = 'This request was not accepted for generation and is now closed. Your questions are unchanged. You can start a new attempt.';
const ABANDONED_REQUEST_HASH = 'abandoned-before-acceptance-v1';
const jobError = (message, code, status = 409) => Object.assign(new Error(message), { code, status });
const stableJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function questionGenerationRequestHash({ quizId, mode, questionConfigs }) {
  // Session identifiers are transport details, never part of generation intent.
  return createHash('sha256').update(stableJson({ quizId: String(quizId), mode, questionConfigs })).digest('hex');
}

export function serializeQuestionJob(job) {
  return {
    jobId: String(job._id), requestId: job.requestId, quizId: String(job.quiz), sessionId: job.sessionId,
    mode: job.mode, status: job.status, abandoned: job.abandoned === true, totalQuestions: job.items.length,
    completedQuestions: job.items.filter(item => item.status === 'ready').length,
    failedQuestions: job.items.filter(item => item.status === 'failed').length,
    questionIds: job.status === 'succeeded' ? (job.questionIds || []).map(String) : [],
    items: job.items.map(item => ({ index: item.index, questionId: item.questionId, status: item.status,
      ...(job.status === 'succeeded' ? { savedQuestionId: String(item.savedQuestionId) } : {}),
      ...(item.code ? { code: item.code } : {}), ...(item.message ? { message: item.message } : {}) })),
    message: job.message || '', createdAt: job.createdAt, updatedAt: job.updatedAt
  };
}

export function safeQuestionJobFailure(error) {
  const known = {
    GENERATION_TIMEOUT: 'This question exceeded its generation deadline. No question from this batch was published.',
    QUESTION_QUALITY_REVIEW: 'This question did not pass the feedback check. Refine its instructions before starting a new attempt.',
    NO_API_KEY: 'An AI API key is required before generating questions.',
    MATERIALS_NOT_READY: 'Assigned materials are not ready for question generation.',
    QUESTION_TYPE_UNAVAILABLE: 'The selected question type is temporarily unavailable.',
    GENERATION_INTERRUPTED: interruptedMessage
  };
  return { code: Object.hasOwn(known, error?.code) ? error.code : 'QUESTION_GENERATION_FAILED', message: known[error?.code] || 'This question could not be completed. Check the instructions and services before starting a new attempt.' };
}

// Durable receipts plus fenced publication, not an automatically replayed queue.
// Paid work lives only in the originating process. Recovery reads MongoDB state.
export function createQuestionJobService({ JobModel = QuestionGenerationJob, QuizModel = Quiz, QuestionModel = Question,
  now = () => new Date(), heartbeatMs = 30_000 } = {}) {
  const workers = new Map();
  const expired = job => !job.leaseUntil || +job.leaseUntil < +now() || +now() - +job.createdAt > MAX_RUN_MS;

  async function initializeReceiptStorage() {
    try {
      await JobModel.init();
    } catch (error) {
      // Older installations may already enforce the same invariant under the
      // default quiz_1 name. MongoDB can reject adding an equivalent partial
      // index with our newer explicit name. Preserve every existing index and
      // accept that conflict only after verifying all receipt safety indexes.
      if ([85, 86].includes(error?.code)) {
        try {
          const indexes = await JobModel.collection.indexes();
          const matchesKey = (index, fields) => {
            const entries = Object.entries(index.key || {});
            return entries.length === fields.length && entries.every(([key, direction]) =>
              fields.includes(key) && [1, -1].includes(direction));
          };
          const safeUnique = index => index.unique === true && !index.sparse
            && index.expireAfterSeconds === undefined
            && (!index.collation || index.collation.locale === 'simple');
          const completeUnique = fields => indexes.some(index => safeUnique(index)
            && matchesKey(index, fields) && !index.partialFilterExpression);
          const activeQuizUnique = indexes.some(index => {
            const filter = index.partialFilterExpression;
            return safeUnique(index) && matchesKey(index, ['quiz'])
              && filter && Object.keys(filter).length === 1
              && (filter.active === true || (filter.active && typeof filter.active === 'object'
                && Object.keys(filter.active).length === 1 && filter.active.$eq === true));
          });
          if (completeUnique(['owner', 'requestId']) && completeUnique(['sessionId']) && activeQuizUnique) return;
        } catch {
          // An unreadable index catalog is not evidence of an enforced invariant.
        }
      }
      // Driver messages/stacks may contain connection details or document data.
      // Log only a numeric database code and an application-owned diagnosis.
      const code = Number.isInteger(error?.code) ? error.code : null;
      console.error('[QuestionGenerationJobs] Receipt storage initialization failed.', {
        code,
        reason: [85, 86].includes(code) ? 'INDEX_DEFINITION_CONFLICT'
          : code === 11000 ? 'INDEX_UNIQUENESS_CONFLICT' : 'STORAGE_INITIALIZATION_FAILED'
      });
      throw error;
    }
  }

  async function recover(job) {
    if (!job?.active) return job;
    const quiz = await QuizModel.findOne({ _id: job.quiz, createdBy: job.owner });
    if (quiz && String(quiz.lastQuestionGenerationJob || '') === String(job._id)) {
      await JobModel.updateOne({ _id: job._id, active: true }, { $set: {
        status: 'succeeded', active: false, questionIds: job.items.map(item => item.savedQuestionId), message: 'All questions were saved successfully.'
      } });
    } else if (!quiz || expired(job)) {
      await JobModel.updateOne({ _id: job._id, active: true, leaseToken: job.leaseToken, leaseUntil: job.leaseUntil }, {
        $set: { status: 'interrupted', active: false, message: interruptedMessage }
      });
      await QuizModel.updateOne({ _id: job.quiz, 'questionGenerationLease.token': job.leaseToken, 'questionGenerationLease.leaseUntil': { $lt: now() } }, {
        $unset: { questionGenerationLease: '' }
      });
    }
    return JobModel.findOne({ _id: job._id, owner: job.owner });
  }

  async function terminal(job, status, message) {
    await JobModel.updateOne({ _id: job._id, active: true, leaseToken: job.leaseToken }, { $set: { status, message, active: false } });
    await QuizModel.updateOne({ _id: job.quiz, 'questionGenerationLease.token': job.leaseToken }, { $unset: { questionGenerationLease: '' } });
  }

  const service = {
    async get(owner, requestId) {
      const job = await JobModel.findOne({ owner, requestId });
      if (!job || !await QuizModel.exists({ _id: job.quiz, createdBy: owner })) return null;
      return recover(job);
    },
    async list(owner, quizId) {
      if (!await QuizModel.exists({ _id: quizId, createdBy: owner })) return null;
      const active = await JobModel.find({ owner, quiz: quizId, active: true });
      await Promise.all(active.map(recover));
      return JobModel.find({ owner, quiz: quizId }).sort({ active: -1, createdAt: -1 }).limit(20);
    },
    async findSession(owner, sessionId) {
      const job = await JobModel.findOne({ owner, sessionId });
      return job && await QuizModel.exists({ _id: job.quiz, createdBy: owner }) ? job : null;
    },
    async abandon({ owner, quizId, requestId }) {
      if (!mongoose.isValidObjectId(quizId) || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '')) {
        throw jobError('A valid learning object and generation request ID are required.', 'INVALID_GENERATION_REQUEST', 400);
      }
      if (!await QuizModel.exists({ _id: quizId, createdBy: owner })) throw jobError('Learning object not found.', 'NOT_FOUND', 404);
      await initializeReceiptStorage();
      const existing = await JobModel.findOne({ owner, requestId });
      if (existing) {
        if (String(existing.quiz) !== String(quizId)) throw jobError('Generation task not found.', 'NOT_FOUND', 404);
        return recover(existing);
      }
      try {
        // The same unique key used by start() decides whether the original POST
        // was accepted. This is not cancellation: whichever insert wins remains
        // authoritative, and a late POST can never pay after this tombstone wins.
        return await JobModel.create({ owner, quiz: quizId, requestId,
          requestHash: ABANDONED_REQUEST_HASH, abandoned: true, active: false, status: 'interrupted',
          mode: 'append', sessionId: randomUUID(), leaseToken: randomUUID(),
          items: [], questionIds: [], message: abandonedMessage });
      } catch (error) {
        if (error.code !== 11000) throw error;
        const winner = await JobModel.findOne({ owner, requestId });
        if (!winner || String(winner.quiz) !== String(quizId)) throw jobError('Generation task not found.', 'NOT_FOUND', 404);
        return recover(winner);
      }
    },
    async start({ owner, quizId, requestId, mode = 'append', questionConfigs, expectedQuizVersion, signal,
      assertContextActive = async () => {}, work, onSettled }) {
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '')) throw jobError('A valid generation request ID is required.', 'INVALID_GENERATION_REQUEST', 400);
      if (!['append', 'replace'].includes(mode) || !Array.isArray(questionConfigs) || questionConfigs.length < 1 || questionConfigs.length > 100) {
        throw jobError('Choose append or replace and between 1 and 100 questions.', 'INVALID_GENERATION_REQUEST', 400);
      }
      if (expectedQuizVersion !== undefined && (!Number.isInteger(expectedQuizVersion) || expectedQuizVersion < 0)) {
        throw jobError('The learning object version is invalid. Refresh before generating.', 'INVALID_GENERATION_REQUEST', 400);
      }
      if (!await QuizModel.exists({ _id: quizId, createdBy: owner })) throw jobError('Learning object not found.', 'NOT_FOUND', 404);
      const requestHash = questionGenerationRequestHash({ quizId, mode, questionConfigs });
      await initializeReceiptStorage();
      const previous = await JobModel.findOne({ owner, requestId });
      if (previous) {
        if (previous.abandoned) throw jobError('This request was closed before generation started. Start a new attempt with a new request ID.', 'GENERATION_REQUEST_ABANDONED');
        if (previous.requestHash !== requestHash) throw jobError('This request ID was already used for different generation instructions.', 'REQUEST_ID_CONFLICT');
        return recover(previous);
      }
      if (signal?.aborted) throw jobError(interruptedMessage, 'GENERATION_INTERRUPTED');
      await service.list(owner, quizId);
      let job;
      try {
        job = await JobModel.create({ owner, quiz: quizId, requestId, requestHash, mode,
          sessionId: randomUUID(), leaseToken: randomUUID(), leaseUntil: new Date(+now() + LEASE_MS), status: 'running', active: true,
          items: questionConfigs.map((_config, index) => ({ index, questionId: `question-${index + 1}`, savedQuestionId: new mongoose.Types.ObjectId(), status: 'queued' })) });
      } catch (error) {
        if (error.code !== 11000) throw error;
        const duplicate = await JobModel.findOne({ owner, requestId });
        if (duplicate) {
          if (duplicate.abandoned) throw jobError('This request was closed before generation started. Start a new attempt with a new request ID.', 'GENERATION_REQUEST_ABANDONED');
          if (duplicate.requestHash !== requestHash) throw jobError('This request ID was already used for different generation instructions.', 'REQUEST_ID_CONFLICT');
          return recover(duplicate);
        }
        throw jobError('Another question batch is still running for this learning object. Return to that task before starting a new one.', 'QUESTION_GENERATION_BUSY');
      }
      // The Quiz lease is the publication fence. A stale worker cannot commit
      // after another instance takes over the quiz, even between database calls.
      const quiz = await QuizModel.findOneAndUpdate({ _id: quizId, createdBy: owner,
        ...(expectedQuizVersion !== undefined ? { __v: expectedQuizVersion } : {}), $and: [
        freeQuestionMutation(now()), { $or: [
          { 'questionGenerationLease.token': { $exists: false } }, { 'questionGenerationLease.token': null },
          { 'questionGenerationLease.leaseUntil': { $lt: now() } }
        ] }
      ] }, { $set: { questionGenerationLease: { jobId: job._id, token: job.leaseToken, leaseUntil: job.leaseUntil } }, $inc: { questionRevision: 0 } }, { new: true });
      if (!quiz) {
        await terminal(job, 'conflict', conflictMessage);
        if (expectedQuizVersion !== undefined && !await QuizModel.exists({ _id: quizId, createdBy: owner, __v: expectedQuizVersion })) {
          throw jobError('The learning object changed before generation started. Refresh its materials, objectives and settings before starting a new attempt.', 'GENERATION_SNAPSHOT_CHANGED');
        }
        throw jobError('A question edit or another generation is still finishing. Please try again.', 'QUESTION_GENERATION_BUSY');
      }
      job.baseQuestionIds = [...(quiz.questions || [])];
      job.baseRevision = quiz.questionRevision || 0;
      job.baseQuizVersion = quiz.__v || 0;
      await JobModel.updateOne({ _id: job._id, active: true, leaseToken: job.leaseToken }, { $set: { baseQuestionIds: job.baseQuestionIds, baseRevision: job.baseRevision, baseQuizVersion: job.baseQuizVersion } });

      const abortController = new AbortController();
      const abortFromParent = () => abortController.abort(jobError(interruptedMessage, 'GENERATION_INTERRUPTED'));
      signal?.addEventListener('abort', abortFromParent, { once: true });
      if (signal?.aborted) abortFromParent();
      const assertActive = async () => {
        try { await assertContextActive(); }
        catch (error) { abortController.abort(error); throw error; }
        if (abortController.signal.aborted || expired(job)
          || !await QuizModel.exists({ _id: quizId, createdBy: owner, 'questionGenerationLease.token': job.leaseToken, 'questionGenerationLease.leaseUntil': { $gte: now() } })
          || !await JobModel.exists({ _id: job._id, active: true, leaseToken: job.leaseToken, leaseUntil: { $gte: now() } })) {
          const error = jobError(interruptedMessage, 'GENERATION_INTERRUPTED');
          abortController.abort(error);
          throw error;
        }
      };
      let heartbeating = false;
      const heartbeat = setInterval(async () => {
        if (heartbeating) return;
        heartbeating = true;
        try {
          await assertActive();
          const leaseUntil = new Date(+now() + LEASE_MS);
          const renewed = await QuizModel.updateOne({ _id: quizId, createdBy: owner, 'questionGenerationLease.token': job.leaseToken, 'questionGenerationLease.leaseUntil': { $gte: now() } }, { $set: { 'questionGenerationLease.leaseUntil': leaseUntil } });
          if (!renewed.matchedCount) throw jobError(interruptedMessage, 'GENERATION_INTERRUPTED');
          const receiptRenewed = await JobModel.updateOne({ _id: job._id, active: true, leaseToken: job.leaseToken, leaseUntil: { $gte: now() } }, { $set: { leaseUntil } });
          if (!receiptRenewed.matchedCount) throw jobError(interruptedMessage, 'GENERATION_INTERRUPTED');
          job.leaseUntil = leaseUntil;
        } catch (error) { abortController.abort(jobError(interruptedMessage, 'GENERATION_INTERRUPTED')); }
        finally { heartbeating = false; }
      }, heartbeatMs);
      heartbeat.unref?.();

      const execution = (async () => {
        try {
          await work({ job, signal: abortController.signal, assertActive, async updateItem(index, values) {
            await assertActive();
            const allowed = Object.fromEntries(Object.entries(values).filter(([key]) => ['status', 'code', 'message'].includes(key)));
            const result = await JobModel.updateOne({ _id: job._id, active: true, status: 'running', leaseToken: job.leaseToken, leaseUntil: { $gte: now() } }, {
              $set: Object.fromEntries(Object.entries(allowed).map(([key, value]) => [`items.${index}.${key}`, value]))
            });
            if (!result.matchedCount) throw jobError(interruptedMessage, 'GENERATION_INTERRUPTED');
          } });
          await assertActive();
          const ready = await JobModel.findOne({ _id: job._id, active: true, leaseToken: job.leaseToken });
          if (!ready || ready.items.some(item => item.status !== 'ready')) {
            await terminal(job, 'failed', failureMessage);
            return;
          }
          const ids = ready.items.map(item => item.savedQuestionId);
          const persisted = await QuestionModel.countDocuments({ _id: { $in: ids }, quiz: quizId, createdBy: owner, generationJob: job._id });
          if (persisted !== ids.length) throw jobError('Generated questions could not be confirmed in storage.', 'GENERATION_INTERRUPTED');
          await assertActive();
          const committing = await JobModel.updateOne({ _id: job._id, active: true, status: 'running', leaseToken: job.leaseToken, leaseUntil: { $gte: now() } }, { $set: { status: 'committing' } });
          if (!committing.matchedCount) throw jobError(interruptedMessage, 'GENERATION_INTERRUPTED');
          const publishedIds = mode === 'replace' ? ids : [...job.baseQuestionIds, ...ids];
          const commit = await QuizModel.updateOne({ _id: quizId, createdBy: owner, questionRevision: job.baseRevision, __v: job.baseQuizVersion,
            questions: { $eq: job.baseQuestionIds }, 'questionGenerationLease.token': job.leaseToken,
            'questionGenerationLease.leaseUntil': { $gte: now() }, ...freeQuestionMutation(now())
          }, { $set: { questions: publishedIds, 'progress.questionsGenerated': true, 'progress.reviewCompleted': false, status: 'completed', lastQuestionGenerationJob: job._id },
            $unset: { questionGenerationLease: '' }, $inc: { questionRevision: 1, __v: 1 } });
          if (!commit.matchedCount) {
            await recover(await JobModel.findById(job._id));
            const committed = await QuizModel.exists({ _id: quizId, createdBy: owner, lastQuestionGenerationJob: job._id });
            if (!committed) await terminal(job, abortController.signal.aborted ? 'interrupted' : 'conflict', abortController.signal.aborted ? interruptedMessage : conflictMessage);
            return;
          }
          await JobModel.updateOne({ _id: job._id, active: true, leaseToken: job.leaseToken }, { $set: {
            status: 'succeeded', active: false, questionIds: ids, message: 'All questions were saved successfully.'
          } });
        } catch (error) {
          // A write may have committed even if its response was lost. Never mark
          // a committed batch failed; the durable Quiz marker resolves ambiguity.
          const current = await recover(await JobModel.findById(job._id));
          if (current?.active) await terminal(job, error.code === 'GENERATION_INTERRUPTED' ? 'interrupted' : 'failed', error.code === 'GENERATION_INTERRUPTED' ? interruptedMessage : failureMessage);
        } finally {
          clearInterval(heartbeat);
          signal?.removeEventListener('abort', abortFromParent);
          if (onSettled) {
            try { await onSettled(await JobModel.findOne({ _id: job._id, owner })); } catch { /* Progress delivery is optional. */ }
          }
        }
      })().catch(() => { /* Database outage: get/list recover the expired lease later. */ });
      workers.set(String(job._id), execution);
      void execution.finally(() => workers.delete(String(job._id)));
      return job;
    },
    async waitForIdle() { await Promise.all([...workers.values()]); }
  };
  return service;
}

export default createQuestionJobService();
