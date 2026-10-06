import { describe, expect, jest, test } from '@jest/globals';
import { createQuestionFailureCorrection } from '../../services/questionFailureCorrection.js';

function fixture() {
  const args = { owner: '507f1f77bcf86cd799439011', jobId: '507f1f77bcf86cd799439012', assistantId: '507f1f77bcf86cd799439013',
    index: 9, code: 'QUESTION_DUPLICATE_DETECTED', assertObservation: jest.fn(async () => true) };
  const job = { owner: args.owner, quiz: '507f1f77bcf86cd799439014', requestId: 'current-attempt', active: false, status: 'partial',
    items: [{ index: 9, questionId: 'question-10', status: 'failed', code: 'QUESTION_GENERATION_FAILED', attempts: 1 }] };
  const updateOne = jest.fn(async (_filter, update) => { job.items[0].code = update.$set['items.0.code']; return { matchedCount: 1, modifiedCount: 1 }; });
  const findOne = jest.fn(() => ({ select: () => ({ lean: async () => job }) }));
  const quizExists = jest.fn(async () => true); const assistantExists = jest.fn(async () => true);
  const correct = createQuestionFailureCorrection({ JobModel: { findOne, updateOne }, QuizModel: { exists: quizExists }, AssistantModel: { exists: assistantExists } });
  return { args, job, updateOne, findOne, quizExists, assistantExists, correct };
}

describe('observed terminal failure correction', () => {
  test('changes only safe diagnosis fields with exact ownership/current-attempt and item guards, and is idempotent', async () => {
    const f = fixture();
    expect(await f.correct(f.args)).toEqual({ corrected: true, code: f.args.code });
    expect(f.findOne).toHaveBeenCalledWith({ _id: f.args.jobId, owner: f.args.owner });
    expect(f.assistantExists).toHaveBeenCalledWith({ _id: f.args.assistantId, owner: f.args.owner, quizId: f.job.quiz, questionJobRequestId: f.job.requestId });
    const [filter, update] = f.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ owner: f.args.owner, _id: f.args.jobId, active: false, 'items.0.status': 'failed', 'items.0.questionId': 'question-10', 'items.0.code': 'QUESTION_GENERATION_FAILED' });
    expect(Object.keys(update.$set)).toEqual(['items.0.code', 'items.0.message', 'items.0.failure']);
    expect(update.$set['items.0.failure'].stage).toBe('review');
    expect(f.args.assertObservation).toHaveBeenCalledWith(expect.objectContaining({ jobId: f.args.jobId, index: 9, questionId: 'question-10', attempts: 1 }));
    expect(await f.correct(f.args)).toEqual({ corrected: false, code: f.args.code });
    expect(f.updateOne).toHaveBeenCalledTimes(1);
  });
  test.each(['active', 'ready', 'specific', 'notCurrent', 'wrongOwner', 'noObservation'])(
    'does not alter receipts when guard %s fails', async kind => {
      const f = fixture();
      if (kind === 'active') f.job.active = true;
      if (kind === 'ready') f.job.items[0].status = 'ready';
      if (kind === 'specific') f.job.items[0].code = 'QUESTION_QUALITY_REVIEW';
      if (kind === 'notCurrent') f.assistantExists.mockResolvedValue(false);
      if (kind === 'wrongOwner') f.quizExists.mockResolvedValue(false);
      if (kind === 'noObservation') f.args.assertObservation.mockResolvedValue(false);
      await expect(f.correct(f.args)).rejects.toMatchObject({ code: 'QUESTION_DIAGNOSIS_CONFLICT' });
      expect(f.updateOne).not.toHaveBeenCalled();
    });
  test('a concurrent receipt change cannot be overwritten', async () => {
    const f = fixture(); f.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    await expect(f.correct(f.args)).rejects.toMatchObject({ code: 'QUESTION_DIAGNOSIS_CONFLICT' });
  });
});
