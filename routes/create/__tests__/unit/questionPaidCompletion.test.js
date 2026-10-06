import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import { QUESTION_GOAL_COVERAGE_POLICY_VERSION } from '../../services/questionReviewContract.js';

const draft = { questionText: 'Which statement describes a force?', explanation: 'A force is an interaction.', correctAnswer: 'An interaction',
  content: { options: [
    { text: 'An interaction', isCorrect: true, chosenFeedback: 'Correct', notChosenFeedback: 'Missed' },
    { text: 'A color', isCorrect: false, chosenFeedback: 'Wrong', notChosenFeedback: 'Correct omission' }
  ] } };
const review = { answerIsCorrect: true, followsInstructorRequest: true, contentIsValid: true, evidenceIsSufficient: true,
  rubricIsAppropriate: true, issues: [], explanation: 'A force is an interaction.', calculations: [],
  feedback: [
    { optionText: 'An interaction', isCorrect: true, rationale: 'This describes the interaction between bodies.', calculations: [] },
    { optionText: 'A color', isCorrect: false, rationale: 'A color does not describe a force.', calculations: [] }
  ] };
const config = { questionType: 'multiple-choice', learningObjective: 'Describe forces.',
  llmConfig: { provider: 'openai', model: 'gpt-6-luna', endpoint: 'https://api.openai.com/v1', apiKey: 'unused-test-secret' } };
const goals = [{ id: 'force-definition', text: 'Describe a force as an interaction.' },
  { id: 'force-vs-color', text: 'Distinguish a force from a color property.' }];
const goalCoverage = goals.map(goal => ({ id: goal.id, isCovered: true }));

describe('durable question paid-completion boundary', () => {
  beforeEach(() => jest.spyOn(llmService, 'buildExpertPrompt').mockResolvedValue('Stable draft prompt'));
  afterEach(() => jest.restoreAllMocks());

  test('both draft and feedback responses can be saved then replayed without paid calls', async () => {
    const sendMessage = jest.fn().mockResolvedValue({ content: JSON.stringify(draft), model: 'test' });
    jest.spyOn(llmService, 'createLLMForConfig').mockReturnValue({ sendMessage });
    const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: JSON.stringify(review), model: 'test' });
    const receipts = new Map(); const phases = [];
    const paidCompletion = jest.fn(async ({ phase, prompt, invoke }) => {
      phases.push(phase);
      const key = `${phase}:${prompt}`;
      if (!receipts.has(key)) receipts.set(key, structuredClone(await invoke()));
      return structuredClone(receipts.get(key));
    });
    const first = await llmService.generateQuestion({ ...config, paidCompletion });
    const second = await llmService.generateQuestion({ ...config, paidCompletion });
    expect(first.questionData.questionText).toBe(second.questionData.questionText);
    expect(first.questionData.generationMetadata.qualityReview).toBe('ai-feedback-reviewed');
    expect(phases).toEqual(['draft', 'feedback_review', 'draft', 'feedback_review']);
    expect(sendMessage).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
    for (const [value] of paidCompletion.mock.calls) expect(Object.keys(value).sort()).toEqual(['invoke', 'phase', 'prompt']);
  });
  test('saving a draft receipt may stop execution before parsing or reviewing it', async () => {
    const sendMessage = jest.fn().mockResolvedValue({ content: JSON.stringify(draft) });
    jest.spyOn(llmService, 'createLLMForConfig').mockReturnValue({ sendMessage });
    const complete = jest.spyOn(llmService, 'streamCompletion');
    const saved = [];
    const paidCompletion = async ({ invoke }) => {
      saved.push(await invoke()); throw Object.assign(new Error('Stopped after receipt save'), { name: 'AbortError' });
    };
    await expect(llmService.generateQuestion({ ...config, paidCompletion })).rejects.toMatchObject({ name: 'AbortError' });
    expect(saved[0].content).toBe(JSON.stringify(draft)); expect(complete).not.toHaveBeenCalled();
  });
  test('nonstream feedback repair preserves the draft and checkpoints only the missing review', async () => {
    const create = jest.spyOn(llmService, 'createLLMForConfig');
    const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: JSON.stringify({ ...review, goalCoverage }) });
    const phases = [];
    const paidCompletion = async ({ phase, invoke }) => { phases.push(phase); return invoke(); };
    const customPrompt = 'Audience: introductory learners. Exclude acceleration. Keep the assigned force-definition slice.';
    const result = await llmService.generateQuestion({ ...config, repairDraft: structuredClone(draft),
      customPrompt, instructorPrompt: 'Improve the learner feedback.',
      requiredLearningGoals: goals,
      repairObservation: { reason: 'FEEDBACK_INVALID', issues: ['Correct the feedback.'] }, paidCompletion });
    expect(result.questionData.questionText).toBe(draft.questionText);
    expect(result.questionData.generationMetadata).toMatchObject({ generationMethod: 'feedback-repair', qualityReview: 'ai-feedback-reviewed' });
    expect(phases).toEqual(['feedback_review']); expect(create).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].prompt).toContain(customPrompt);
    expect(complete.mock.calls[0][0].prompt).toContain('CURRENT INSTRUCTOR REQUEST (task data): Improve the learner feedback.');
    expect(complete.mock.calls[0][0].jsonSchema.schema.required).toContain('goalCoverage');
    expect(result.questionData.generationMetadata.reviewSummary).toMatchObject({ goalCoveragePolicyVersion: QUESTION_GOAL_COVERAGE_POLICY_VERSION, goalCoverage });
  });
  test.each(['generateQuestion', 'generateQuestionStreaming'])(
    '%s forwards exact per-goal obligations to the existing review without another model call', async method => {
      const sendMessage = jest.fn().mockResolvedValue({ content: JSON.stringify(draft) });
      jest.spyOn(llmService, 'createLLMForConfig').mockReturnValue({ sendMessage });
      const complete = jest.spyOn(llmService, 'streamCompletion');
      if (method === 'generateQuestionStreaming') complete.mockResolvedValueOnce({ content: JSON.stringify(draft) });
      complete.mockResolvedValueOnce({ content: JSON.stringify({ ...review, goalCoverage }) });
      const result = await llmService[method]({ ...config, requiredLearningGoals: goals });
      expect(complete).toHaveBeenCalledTimes(method === 'generateQuestionStreaming' ? 2 : 1);
      expect(sendMessage).toHaveBeenCalledTimes(method === 'generateQuestionStreaming' ? 0 : 1);
      const request = complete.mock.calls.at(-1)[0];
      expect(request.jsonSchema.schema.required).toContain('goalCoverage');
      for (const goal of goals) expect(request.prompt).toContain(goal.text);
      expect(result.questionData.generationMetadata.reviewSummary).toMatchObject({
        goalCoveragePolicyVersion: QUESTION_GOAL_COVERAGE_POLICY_VERSION, goalCoverage
      });
    }
  );
  test('rejects an invalid checkpoint hook before any generation or provider call', async () => {
    const create = jest.spyOn(llmService, 'createLLMForConfig');
    await expect(llmService.generateQuestion({ ...config, paidCompletion: true })).rejects.toThrow('paidCompletion must wrap');
    expect(create).not.toHaveBeenCalled();
  });
});
