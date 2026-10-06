import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import { getStudioCatalog } from '../../services/h5pStudioCatalog.js';

const config = {
  questionType: 'multiple-choice', learningObjective: 'Apply a fictional premise.',
  courseContext: 'In this simulation, gravity points upward.', customPrompt: 'Use the instructor premise, not terrestrial gravity.',
  llmConfig: { provider: 'openai', model: 'gpt-5-nano', endpoint: 'https://api.openai.com/v1', apiKey: 'test-not-used' }
};
const draft = {
  questionText: 'Which way does gravity point in this simulation?',
  correctAnswer: 'Upward', explanation: 'The instructor defined it this way.',
  content: { options: [
    { text: 'Upward', isCorrect: true, chosenFeedback: 'Correct', notChosenFeedback: 'You missed it.' },
    { text: 'Downward', isCorrect: false, chosenFeedback: 'Incorrect', notChosenFeedback: 'Correct omission.' }
  ] }
};

describe('question generation quality boundary', () => {
  beforeEach(() => {
    jest.spyOn(llmService, 'buildExpertPrompt').mockResolvedValue('Draft prompt');
    jest.spyOn(llmService, 'parseAndValidateResponse').mockImplementation(() => structuredClone(draft));
  });
  afterEach(() => jest.restoreAllMocks());

  test.each(['answer rejection', 'instruction rejection', 'malformed review', 'review transport failure'])(
    '%s never falls back to a second paid question generation', async reason => {
      const completion = jest.spyOn(llmService, 'streamCompletion').mockResolvedValueOnce({ content: 'draft', model: 'test' });
      if (reason === 'review transport failure') completion.mockRejectedValueOnce(new Error('Premature close'));
      else completion.mockResolvedValueOnce({ content: reason === 'malformed review' ? '{}'
        : reason === 'instruction rejection' ? '{"answerIsCorrect":true,"followsInstructorRequest":false}' : '{"answerIsCorrect":false}' });
      const fallback = jest.spyOn(llmService, 'generateQuestion');
      await expect(llmService.generateQuestionStreaming(config)).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
      expect(completion).toHaveBeenCalledTimes(2);
      expect(fallback).not.toHaveBeenCalled();
      const reviewRequest = completion.mock.calls[1][0];
      expect(reviewRequest.prompt).toContain(config.learningObjective);
      expect(reviewRequest.prompt).toContain(config.courseContext);
      expect(reviewRequest.prompt).toContain(config.customPrompt);
      expect(reviewRequest.maxTokens).toBeLessThanOrEqual(8000);
    }
  );

  test('propagates a cancelled stream without triggering fallback generation', async () => {
    const abort = Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    jest.spyOn(llmService, 'streamCompletion').mockRejectedValue(abort);
    const fallback = jest.spyOn(llmService, 'generateQuestion');
    await expect(llmService.generateQuestionStreaming(config)).rejects.toBe(abort);
    expect(fallback).not.toHaveBeenCalled();
  });

  test.each(['generateQuestion', 'generateQuestionStreaming'])(
    '%s feedback-only repair preserves saved constraints alongside the latest request and rejects their violation', async method => {
      const completion = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: JSON.stringify({
        contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true,
        evidenceIsSufficient: true, followsInstructorRequest: false,
        issues: ['The revised explanation contradicts the retained hypothetical premise.']
      }) });
      const provider = jest.spyOn(llmService, 'createLLMForConfig');
      await expect(llmService[method]({ ...config, repairDraft: structuredClone(draft),
        instructorPrompt: 'Improve the learner feedback.' })).rejects.toMatchObject({
        code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'INSTRUCTION_MISMATCH'
      });
      expect(completion).toHaveBeenCalledTimes(1);
      expect(provider).not.toHaveBeenCalled();
      expect(llmService.buildExpertPrompt).not.toHaveBeenCalled();
      const prompt = completion.mock.calls[0][0].prompt;
      for (const value of [config.learningObjective, config.courseContext, config.customPrompt, 'Improve the learner feedback.']) {
        expect(prompt).toContain(value);
      }
    }
  );

  test.each(['AUTHORING_MODEL_UNCERTAIN', 'AUTHORING_CONTRACT_CHANGED', 'GENERATION_INTERRUPTED'])(
    'a review checkpoint %s cannot trigger a paid streaming fallback', async code => {
      const error = Object.assign(new Error('Saved execution cannot continue.'), { code });
      const completion = jest.spyOn(llmService, 'streamCompletion').mockResolvedValueOnce({ content: 'draft' }).mockRejectedValueOnce(error);
      const fallback = jest.spyOn(llmService, 'generateQuestion');
      await expect(llmService.generateQuestionStreaming(config)).rejects.toBe(error);
      expect(completion).toHaveBeenCalledTimes(2); expect(fallback).not.toHaveBeenCalled();
    });

  test('requests JSON and stops after a completed malformed draft without a paid fallback', async () => {
    llmService.parseAndValidateResponse.mockRestore();
    const completion = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: '{"questionText": + "bad"}', model: 'gpt-6-luna' });
    const fallback = jest.spyOn(llmService, 'generateQuestion');
    await expect(llmService.generateQuestionStreaming(config)).rejects.toMatchObject({ code: 'QUESTION_INVALID_RESPONSE' });
    expect(completion).toHaveBeenCalledTimes(1);
    expect(completion.mock.calls[0][0].jsonMode).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
  });
  test.each([{ status: 429 }, { code: 429 }, { code: 'insufficient_quota' }, { response: { status: 429 } }])(
    'does not start fallback generation after a provider limit: %j', async fields => {
      const completion = jest.spyOn(llmService, 'streamCompletion').mockRejectedValue(Object.assign(new Error('PRIVATE provider request'), fields));
      const fallback = jest.spyOn(llmService, 'generateQuestion');
      await expect(llmService.generateQuestionStreaming(config)).rejects.toMatchObject({ code: 'MODEL_SERVICE_LIMIT_REACHED', status: 429 });
      expect(completion).toHaveBeenCalledTimes(1);
      expect(fallback).not.toHaveBeenCalled();
    }
  );

  test('requests JSON through the non-streaming OpenAI toolkit transport', async () => {
    const sendMessage = jest.fn().mockResolvedValue({ content: 'draft', model: 'gpt-6-luna' });
    jest.spyOn(llmService, 'createLLMForConfig').mockReturnValue({ sendMessage });
    jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: '{"answerIsCorrect":false}' });
    await expect(llmService.generateQuestion(config)).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
    expect(sendMessage.mock.calls[0][1].responseFormat).toBe('json');
  });

  test.each(['generateQuestion', 'generateQuestionStreaming'])(
    '%s blocks unavailable types before resolving credentials or doing model work', async method => {
      const libraries = getStudioCatalog().libraries;
      const editor = libraries.get('H5PEditor.BranchingScenario 1.5');
      libraries.delete('H5PEditor.BranchingScenario 1.5');
      try {
        const resolve = jest.spyOn(llmService, 'resolveUserLLMConfig');
        const completion = jest.spyOn(llmService, 'streamCompletion');
        await expect(llmService[method]({ questionType: 'branching-scenario', customPrompt: 'Create two choices' }))
          .rejects.toMatchObject({ code: 'QUESTION_TYPE_UNAVAILABLE' });
        expect(resolve).not.toHaveBeenCalled();
        expect(completion).not.toHaveBeenCalled();
        expect(llmService.buildExpertPrompt).not.toHaveBeenCalled();
      } finally {
        libraries.set('H5PEditor.BranchingScenario 1.5', editor);
      }
    }
  );
});
