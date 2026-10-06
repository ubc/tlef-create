import mongoose from 'mongoose';
import Job from '../models/QuestionGenerationJob.js';
import Quiz from '../models/Quiz.js';
import Assistant from '../models/StudioAssistantSession.js';
import { safeQuestionFailure } from './questionGenerationFailure.js';

const fail = () => { throw Object.assign(new Error('This saved failure diagnosis could not be corrected safely.'), { code: 'QUESTION_DIAGNOSIS_CONFLICT', status: 409 }); };

// Internal maintenance boundary, never a public endpoint or an agent tool.
// Correct only a known application rejection independently observed in this
// exact completed attempt. Old generic receipts alone prove no diagnosis.
export function createQuestionFailureCorrection({ JobModel = Job, QuizModel = Quiz, AssistantModel = Assistant } = {}) {
  return async function correctQuestionFailure({ owner, jobId, assistantId, index, code, assertObservation }) {
    if (![owner, jobId, assistantId].every(mongoose.isValidObjectId) || !Number.isInteger(index) || index < 0 || index > 99
      || code !== 'QUESTION_DUPLICATE_DETECTED' || typeof assertObservation !== 'function') fail();
    const job = await JobModel.findOne({ _id: jobId, owner }).select('owner quiz requestId status active items').lean();
    if (!job || job.active || !['failed', 'partial'].includes(job.status)
      || !await QuizModel.exists({ _id: job.quiz, createdBy: owner })
      || !await AssistantModel.exists({ _id: assistantId, owner, quizId: job.quiz, questionJobRequestId: job.requestId })) fail();
    const item = job.items.find(value => value.index === index);
    if (!item || item.status !== 'failed') fail();
    if (item.code === code) return { corrected: false, code };
    if (item.code !== 'QUESTION_GENERATION_FAILED' || item.attempts < 1) fail();
    if (await assertObservation({ jobId: String(jobId), questionId: item.questionId, index, attempts: item.attempts,
      startedAt: item.startedAt, completedAt: item.completedAt }) !== true) fail();
    const safe = safeQuestionFailure({ code });
    const slot = job.items.findIndex(value => value.index === index);
    const result = await JobModel.updateOne({ _id: jobId, owner, active: false, status: { $in: ['failed', 'partial'] },
      [`items.${slot}.status`]: 'failed', [`items.${slot}.index`]: index, [`items.${slot}.questionId`]: item.questionId,
      [`items.${slot}.code`]: 'QUESTION_GENERATION_FAILED' }, { $set: {
      [`items.${slot}.code`]: safe.code, [`items.${slot}.message`]: safe.message, [`items.${slot}.failure`]: safe.failure
    } });
    if (!result.matchedCount) fail();
    return { corrected: result.modifiedCount === 1, code };
  };
}

export default createQuestionFailureCorrection();
