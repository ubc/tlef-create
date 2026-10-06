import { describe, expect, test } from '@jest/globals';
import { safeQuestionJobFailure, serializeQuestionJob } from '../../services/questionGenerationJobs.js';
import Job from '../../models/QuestionGenerationJob.js';
import { assistantRecoveryMessage } from '../../services/authoring/assistantRecovery.js';

describe('safe question failure diagnostics', () => {
  test('distinguishes a malformed model draft without exposing provider output', () => {
    const result = safeQuestionJobFailure({ code: 'QUESTION_INVALID_RESPONSE', message: 'PRIVATE provider draft' });
    expect(result.code).toBe('QUESTION_INVALID_RESPONSE');
    expect(result.message).toContain('explicit retry');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  test.each(['REVIEW_UNAVAILABLE', 'REVIEW_LIMIT_REACHED', 'REVIEW_INVALID_RESPONSE', 'ANSWER_INVALID', 'INSTRUCTION_MISMATCH',
    'FEEDBACK_INVALID', 'ARITHMETIC_FALSE_EQUALITY', 'ARITHMETIC_INVALID_SCHEMA',
    'ARITHMETIC_DIVISION_BY_ZERO', 'ARITHMETIC_UNSUPPORTED_EXPRESSION', 'FEEDBACK_TEXT_LIMIT'])('persists and exposes the allowlisted diagnosis %s', reason => {
    const safe = safeQuestionJobFailure({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: reason,
      message: 'PRIVATE provider response', issues: ['PRIVATE source text'] });
    expect(safe).toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', reason });
    const job = new Job({ owner: '507f1f77bcf86cd799439011', quiz: '507f1f77bcf86cd799439012',
      status: 'failed', items: [{ index: 0, questionId: 'question-1', status: 'failed', ...safe }] });
    const serialized = serializeQuestionJob(job);
    expect(serialized.items[0]).toMatchObject(safe);
    expect(JSON.stringify(serialized)).not.toContain('PRIVATE');
  });
  test('unknown diagnoses and arbitrary messages never reach the client', () => {
    const result = safeQuestionJobFailure({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'PRIVATE key', message: 'PRIVATE source' });
    expect(result.reason).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  test('reports a provider usage limit without exposing provider messages or implying a bad answer', () => {
    const safe = safeQuestionJobFailure({ code: 'MODEL_SERVICE_LIMIT_REACHED', message: 'PRIVATE key and source' });
    expect(safe).toMatchObject({ code: 'MODEL_SERVICE_LIMIT_REACHED', message: expect.stringContaining('rate limit or usage allowance') });
    expect(safe.message).toContain('No fallback generation');
    expect(JSON.stringify(safe)).not.toContain('PRIVATE');
  });
  test('current-index failure survives schema and serialization with a safe recovery instruction', () => {
    const safe = safeQuestionJobFailure({ code: 'MATERIAL_INDEX_MISSING', message: 'PRIVATE source' }, 'evidence');
    const job = new Job({ owner: '507f1f77bcf86cd799439011', quiz: '507f1f77bcf86cd799439012', status: 'failed',
      items: [{ index: 0, questionId: 'question-1', status: 'failed', attempts: 0, ...safe }] });
    expect(serializeQuestionJob(job).items[0].failure).toEqual({ code: 'MATERIAL_INDEX_MISSING', stage: 'evidence',
      message: expect.stringContaining('generation and review did not start'), recovery: 'Choose Restore material search, then Resume task to continue with the approved plan.', retryable: true });
    expect(JSON.stringify(serializeQuestionJob(job))).not.toContain('PRIVATE');
  });
  test('the same pre-generation cause is summarized once for 15 items without inventing rejected reviews or previews', () => {
    const safe = safeQuestionJobFailure({ code: 'MATERIAL_INDEX_MISSING' }, 'evidence');
    const message = assistantRecoveryMessage({ generation: { totalQuestions: 15, readyCount: 0, published: false,
      items: Array.from({ length: 15 }, (_, index) => ({ index, status: 'failed', ...safe })) } });
    expect(message.match(/MATERIAL_INDEX_MISSING/g)).toHaveLength(1);
    expect(message).toContain('No questions were prepared.');
    expect(message).not.toContain('older attempt');
    expect(message).not.toContain('available in Question set preview');
    expect(message).not.toContain('review flag');
  });
  test('legacy generic failures acknowledge absent diagnostics without assuming when or why they failed', () => {
    const message = assistantRecoveryMessage({ generation: { totalQuestions: 1, readyCount: 0,
      items: [{ index: 0, status: 'failed', code: 'QUESTION_GENERATION_FAILED', message: 'Generic' }] } });
    expect(message).toContain('No detailed failure reason was saved.');
    expect(message).not.toContain('older attempt');
    expect(message).not.toContain('review flag');
  });
});
