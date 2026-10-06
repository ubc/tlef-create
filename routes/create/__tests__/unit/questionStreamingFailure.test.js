import { afterEach, describe, expect, jest, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import streaming from '../../services/questionStreamingService.js';
import memory from '../../services/questionMemoryService.js';
import Question from '../../models/Question.js';
import { safeQuestionJobFailure, serializeQuestionJob } from '../../services/questionGenerationJobs.js';
import { generateWithRework } from '../../services/questionRework.js';

afterEach(() => jest.restoreAllMocks());
const args = { quizId: '507f1f77bcf86cd799439011', questionId: 'question-10', sessionId: 'synthetic-session', userId: '507f1f77bcf86cd799439012',
  questionConfig: { questionType: 'multiple-choice', customPrompt: 'Synthetic task', maxGenerationAttempts: 1 }, learningObjective: null, relevantContent: [] };

function fixture() {
  jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue({ provider: 'test', model: 'synthetic' });
  const model = jest.spyOn(llmService, 'generateQuestionStreaming').mockResolvedValue({ success: true,
    questionData: { questionText: 'PRIVATE duplicate draft', type: 'multiple-choice' } });
  const planned = jest.spyOn(llmService, 'questionMatchesPlannedTask').mockReturnValue({ valid: true });
  const novelty = jest.spyOn(memory, 'reserveIfNovel').mockResolvedValue({ novel: false,
    similarity: 0.9294, noveltyScore: 0.0706, method: 'lexical-and-semantic',
    lexicalSimilarity: 0.6078, threshold: 0.76, lexicalClosest: { questionId: 'question-2', questionText: 'PRIVATE lexical question' },
    semanticSimilarity: 0.9294, semanticThreshold: 0.9, semanticClosest: { questionId: 'question-15', questionText: 'PRIVATE earlier question' },
    mostSimilarQuestionId: 'question-15', mostSimilarQuestionText: 'PRIVATE earlier question' });
  const save = jest.spyOn(Question.prototype, 'save');
  return { model, planned, novelty, save };
}

describe('application question check diagnoses', () => {
  test('a repeated duplicate stops after one targeted repair and has a durable safe cause', async () => {
    const f = fixture(); const attempts = [];
    const error = await generateWithRework({ enabled: true, config: args.questionConfig,
      onAttempt: async attempt => attempts.push(attempt), generate: config => streaming.generateQuestionWithStreaming({ ...args, questionConfig: config })
    }).catch(value => value);
    expect(error.code).toBe('QUESTION_DUPLICATE_DETECTED');
    expect(error.rejectedDraft).toMatchObject({ questionText: 'PRIVATE duplicate draft', novelty: {
      lexical: { similarity: 0.6078, threshold: 0.76, questionId: 'question-2' },
      semantic: { similarity: 0.9294, threshold: 0.9, questionId: 'question-15' }
    } });
    const safe = safeQuestionJobFailure(error, 'generation');
    expect(safe.failure).toMatchObject({ code: 'QUESTION_DUPLICATE_DETECTED', stage: 'review', message: expect.stringContaining('application’s duplicate check') });
    const saved = serializeQuestionJob({ _id: 'job', quiz: args.quizId, status: 'failed', items: [{ index: 9, status: 'failed', attempts: 2, ...safe }] });
    expect(saved.items[0].failure).toEqual(safe.failure);
    expect(JSON.stringify(saved)).not.toContain('PRIVATE');
    expect(attempts).toEqual([1, 2]); expect(f.model).toHaveBeenCalledTimes(2); expect(f.save).not.toHaveBeenCalled();
    expect(f.model.mock.calls[1][0].customPrompt).toContain('PRIVATE earlier question');
  });
  test('assigned slice rejection is distinct from duplicate rejection and does not skip into the novelty check', async () => {
    const f = fixture(); f.planned.mockReturnValue({ valid: false, reason: 'PRIVATE assigned slice detail' });
    const error = await streaming.generateQuestionWithStreaming(args).catch(value => value);
    expect(error.code).toBe('QUESTION_PLANNED_SLICE_MISMATCH');
    expect(safeQuestionJobFailure(error, 'generation').failure).toMatchObject({ stage: 'review', message: expect.stringContaining('coverage check') });
    expect(JSON.stringify(safeQuestionJobFailure(error))).not.toContain('PRIVATE');
    expect(f.novelty).not.toHaveBeenCalled(); expect(f.model).toHaveBeenCalledTimes(1); expect(f.save).not.toHaveBeenCalled();
    expect(error.rejectedDraft).toBeUndefined();
  });
  test('a later slice failure does not inherit a prior duplicate diagnosis', async () => {
    const f = fixture();
    f.planned.mockReturnValueOnce({ valid: true }).mockReturnValue({ valid: false, reason: 'Different terminal cause' });
    const error = await streaming.generateQuestionWithStreaming({ ...args,
      questionConfig: { ...args.questionConfig, maxGenerationAttempts: undefined } }).catch(value => value);
    expect(error.code).toBe('QUESTION_PLANNED_SLICE_MISMATCH');
    expect(error.rejectedDraft).toBeUndefined();
    expect(f.novelty).toHaveBeenCalledTimes(1); expect(f.save).not.toHaveBeenCalled();
  });
});
