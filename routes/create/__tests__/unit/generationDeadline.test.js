import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { runWithGenerationDeadline } from '../../utils/generationDeadline.js';
import llmService from '../../services/llmService.js';
import questionStreamingService from '../../services/questionStreamingService.js';
import Question from '../../models/Question.js';
import Quiz from '../../models/Quiz.js';
import questionMemoryService from '../../services/questionMemoryService.js';
import sseService from '../../services/sseService.js';

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe('question generation deadline', () => {
  test('clears the deadline after success or early failure', async () => {
    jest.useFakeTimers();
    expect(await runWithGenerationDeadline(async () => 'done', 100)).toBe('done');
    expect(jest.getTimerCount()).toBe(0);
    await expect(runWithGenerationDeadline(async () => { throw new Error('failed'); }, 100)).rejects.toThrow('failed');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a provider that completes after timeout cannot save a late question', async () => {
    jest.useFakeTimers();
    jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue({ provider: 'test', model: 'test' });
    let finishModel;
    const model = jest.spyOn(llmService, 'generateQuestionStreaming').mockImplementation(() => new Promise(resolve => { finishModel = resolve; }));
    const save = jest.spyOn(Question.prototype, 'save').mockResolvedValue({ _id: 'late-question' });
    const count = jest.spyOn(Question, 'countDocuments').mockResolvedValue(0);
    let work;
    const run = runWithGenerationDeadline(context => {
      work = questionStreamingService.generateQuestionWithStreaming({
        ...context, quizId: 'quiz', questionId: 'question', sessionId: 'test-session', userId: 'user',
        questionConfig: { questionType: 'multiple-choice', customPrompt: 'Use this scenario.', useCustomPromptOnly: true },
        learningObjective: null, relevantContent: []
      });
      return work;
    }, 100);
    const timedOut = expect(run).rejects.toMatchObject({ code: 'GENERATION_TIMEOUT' });
    await jest.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(model.mock.calls[0][0].signal.aborted).toBe(true);
    finishModel({ success: true, questionData: { type: 'multiple-choice', questionText: 'Late completion' } });
    await expect(work).rejects.toMatchObject({ code: 'GENERATION_TIMEOUT' });
    expect(count).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('once a commit starts, waits for its result instead of falsely announcing a generation timeout', async () => {
    jest.useFakeTimers();
    let finishCommit;
    let signal;
    const run = runWithGenerationDeadline(context => {
      signal = context.signal;
      context.beginPersistence();
      return new Promise(resolve => { finishCommit = resolve; });
    }, 100);
    await jest.advanceTimersByTimeAsync(200);
    expect(signal.aborted).toBe(false);
    finishCommit('saved');
    expect(await run).toBe('saved');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('quality rejection exits the outer service without an automatic novelty retry', async () => {
    jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue({ provider: 'test', model: 'test' });
    const error = Object.assign(new Error('Answer failed review'), { code: 'QUESTION_QUALITY_REVIEW' });
    const model = jest.spyOn(llmService, 'generateQuestionStreaming').mockRejectedValue(error);
    const save = jest.spyOn(Question.prototype, 'save');
    await expect(questionStreamingService.generateQuestionWithStreaming({
      quizId: 'quiz', questionId: 'question', sessionId: 'test-session', userId: 'user',
      questionConfig: { questionType: 'multiple-choice', customPrompt: 'Use this scenario.' },
      learningObjective: null, relevantContent: []
    })).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
    expect(model).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  test('successful persistence clears generation and database timers and keeps review metadata', async () => {
    jest.useFakeTimers();
    jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue({ provider: 'test', model: 'test' });
    jest.spyOn(llmService, 'generateQuestionStreaming').mockResolvedValue({ success: true, questionData: {
      type: 'multiple-choice', questionText: 'Is condensation gas to liquid?', correctAnswer: 'Yes', difficulty: 'moderate',
      content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] },
      generationMetadata: { qualityReview: 'ai-feedback-reviewed' }
    } });
    jest.spyOn(questionMemoryService, 'reserveIfNovel').mockResolvedValue({ novel: true, noveltyScore: 1 });
    jest.spyOn(Question, 'countDocuments').mockResolvedValue(0);
    let persisted;
    jest.spyOn(Question.prototype, 'save').mockImplementation(async function () { persisted = this; return this; });
    jest.spyOn(Quiz, 'findById').mockResolvedValue({ addQuestion: jest.fn(async () => {}) });
    await runWithGenerationDeadline(context => questionStreamingService.generateQuestionWithStreaming({
      ...context, quizId: '507f1f77bcf86cd799439011', questionId: 'question', sessionId: 'test-session', userId: '507f1f77bcf86cd799439012',
      questionConfig: { questionType: 'multiple-choice', customPrompt: 'Use this scenario.', useCustomPromptOnly: true, instructorPrompt: 'Use this scenario.' },
      learningObjective: null, relevantContent: []
    }), 100);
    expect(persisted.generationMetadata.qualityReview).toBe('ai-feedback-reviewed');
    expect(persisted.generationMetadata.instructorPrompt).toBe('Use this scenario.');
    expect(llmService.generateQuestionStreaming.mock.calls[0][0].instructorPrompt).toBe('Use this scenario.');
    expect(jest.getTimerCount()).toBe(0);
  });

  function preparePersistence() {
    jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue({ provider: 'test', model: 'test' });
    const model = jest.spyOn(llmService, 'generateQuestionStreaming').mockResolvedValue({ success: true, questionData: {
      type: 'multiple-choice', questionText: 'Is condensation gas to liquid?', correctAnswer: 'Yes', difficulty: 'moderate',
      content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] }
    } });
    jest.spyOn(questionMemoryService, 'reserveIfNovel').mockResolvedValue({ novel: true, noveltyScore: 1 });
    jest.spyOn(Question, 'countDocuments').mockResolvedValue(0);
    const save = jest.spyOn(Question.prototype, 'save').mockImplementation(async function () { return this; });
    const add = jest.fn(async () => {});
    jest.spyOn(Quiz, 'findById').mockResolvedValue({ addQuestion: add });
    const completed = jest.spyOn(sseService, 'notifyQuestionComplete').mockReturnValue(true);
    const run = () => runWithGenerationDeadline(context => questionStreamingService.generateQuestionWithStreaming({
      ...context, quizId: '507f1f77bcf86cd799439011', questionId: 'question', sessionId: 'test-session', userId: '507f1f77bcf86cd799439012',
      questionConfig: { questionType: 'multiple-choice', customPrompt: 'Use this scenario.', useCustomPromptOnly: true },
      learningObjective: null, relevantContent: []
    }), 120000);
    return { model, save, add, completed, run };
  }

  test.each(['save', 'add'])('a late %s commit reports an unconfirmed result without retrying generation', async phase => {
    jest.useFakeTimers();
    const fixture = preparePersistence();
    let finishCommit;
    fixture[phase].mockImplementationOnce(function () {
      return new Promise(resolve => { finishCommit = () => resolve(this); });
    });
    const outcome = fixture.run().catch(error => error);
    await jest.advanceTimersByTimeAsync(30000);
    const error = await outcome;
    expect(error).toMatchObject({ code: 'GENERATION_OUTCOME_UNCONFIRMED', errorType: 'GENERATION_OUTCOME_UNCONFIRMED' });
    expect(error.message).toContain('Refresh Review before retrying');
    expect(error.message).not.toMatch(/failed to save|no question was saved/i);
    finishCommit();
    await jest.advanceTimersByTimeAsync(120000);
    expect(fixture.model).toHaveBeenCalledTimes(1);
    expect(fixture.model.mock.calls[0][0].instructorPrompt).toBe('Use this scenario.');
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.completed).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a quiz update error after the question was saved cannot claim generation failed', async () => {
    const fixture = preparePersistence();
    fixture.add.mockRejectedValueOnce(new Error('Quiz update refused'));
    await expect(fixture.run()).rejects.toMatchObject({ code: 'GENERATION_OUTCOME_UNCONFIRMED' });
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.model).toHaveBeenCalledTimes(1);
  });

  test('an explicit question validation rejection remains a definite failure', async () => {
    const fixture = preparePersistence();
    const error = Object.assign(new Error('Question text is required'), { name: 'ValidationError' });
    fixture.save.mockRejectedValueOnce(error);
    await expect(fixture.run()).rejects.toMatchObject({ name: 'ValidationError', errorType: 'database-error' });
    expect(error.code).not.toBe('GENERATION_OUTCOME_UNCONFIRMED');
    expect(fixture.add).not.toHaveBeenCalled();
  });
});
