import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import questionStreamingService from '../../services/questionStreamingService.js';
import questionMemoryService from '../../services/questionMemoryService.js';
import Question from '../../models/Question.js';
import Quiz from '../../models/Quiz.js';

const options = [
  { text: '85 liters', isCorrect: true, tip: 'Subtract both outputs.', chosenFeedback: 'Original correct response.', notChosenFeedback: 'This distractor ignores runoff.' },
  { text: '130 liters', isCorrect: false, tip: 'Check runoff.', chosenFeedback: '130 liters is the correct calculation.', notChosenFeedback: 'Original omission feedback.' },
  { text: '105 liters', isCorrect: false, tip: 'Check evaporation.', chosenFeedback: 'Original distractor feedback.', notChosenFeedback: 'Original omission feedback.' },
  { text: '-85 liters', isCorrect: false, tip: 'Check the sign.', chosenFeedback: 'Original distractor feedback.', notChosenFeedback: 'Original omission feedback.' }
];
const review = {
  answerIsCorrect: true, followsInstructorRequest: true, issues: ['Option feedback contradicts the answer key.'],
  explanation: 'Storage change = 150 - (20 + 45) = 85 liters.',
  calculations: [{ expression: '150 - (20 + 45)', result: 85 }],
  feedback: [
    { optionText: '85 liters', isCorrect: true, rationale: '150 - (20 + 45) = 85 liters subtracts both outputs.', calculations: [{ expression: '150 - (20 + 45)', result: 85 }] },
    { optionText: '130 liters', isCorrect: false, rationale: '150 - 20 = 130 liters omits the 45 liters of runoff.', calculations: [{ expression: '150 - 20', result: 130 }] },
    { optionText: '105 liters', isCorrect: false, rationale: '150 - 45 = 105 liters omits the 20 liters of evaporation.', calculations: [{ expression: '150 - 45', result: 105 }] },
    { optionText: '-85 liters', isCorrect: false, rationale: '(20 + 45) - 150 = -85 liters reverses input minus output.', calculations: [{ expression: '(20 + 45) - 150', result: -85 }] }
  ]
};
const config = { provider: 'openai', model: 'gpt-5-nano', endpoint: 'https://api.openai.com/v1', apiKey: 'test-not-used' };

describe('reviewed feedback survives the real question persistence pipeline', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue(config);
    jest.spyOn(llmService, 'buildExpertPrompt').mockResolvedValue('Synthetic water-budget evaluation');
    jest.spyOn(questionMemoryService, 'reserveIfNovel').mockResolvedValue({ novel: true, noveltyScore: 1 });
    jest.spyOn(Question, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(Quiz, 'findById').mockResolvedValue({ addQuestion: jest.fn(async () => {}) });
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['streaming root options', false, false],
    ['streaming nested options', true, false],
    ['non-streaming fallback root options', false, true]
  ])('%s preserves repaired feedback through actual parsing, formatting, and the document schema', async (_label, nested, fallback) => {
    const draft = {
      questionText: 'What is the storage change for rainfall of 150 liters, evaporation of 20 liters, and runoff of 45 liters?',
      correctAnswer: '85 liters', explanation: 'Original explanation.',
      ...(nested ? { content: { options } } : { options })
    };
    const raw = JSON.stringify(draft);
    const completion = jest.spyOn(llmService, 'streamCompletion');
    if (fallback) {
      completion.mockRejectedValueOnce(new Error('Initial stream disconnected'));
      jest.replaceProperty(llmService, 'llm', {});
      jest.spyOn(llmService, 'createLLMForConfig').mockReturnValue({
        sendMessage: jest.fn().mockResolvedValue({ content: raw, model: 'test-generation-model' })
      });
    } else {
      completion.mockResolvedValueOnce({ content: raw, model: 'test-generation-model' });
    }
    completion.mockResolvedValueOnce({ content: JSON.stringify(review), model: 'test-review-model' });
    // This spy intentionally calls the actual parser; earlier boundary tests mocked it.
    const parser = jest.spyOn(llmService, 'parseAndValidateResponse');
    let persisted;
    const save = jest.spyOn(Question.prototype, 'save').mockImplementation(async function () {
      persisted = this.toObject();
      return this;
    });

    await questionStreamingService.generateQuestionWithStreaming({
      quizId: '507f1f77bcf86cd799439011', questionId: 'synthetic-feedback-check', sessionId: 'synthetic-session',
      userId: '507f1f77bcf86cd799439012', learningObjective: null,
      questionConfig: { questionType: 'multiple-choice', customPrompt: 'Course and history guidance. Use the given water-budget premise.', instructorPrompt: 'Use the given water-budget premise.', useCustomPromptOnly: true },
      relevantContent: [{ content: 'Storage change is input minus the sum of outputs.', metadata: { materialName: 'Synthetic source', chunkIndex: 0 } }]
    });

    expect(parser).toHaveBeenCalledWith(raw, 'multiple-choice', 'single', 2, 2, null);
    expect(completion).toHaveBeenCalledTimes(2);
    expect(completion.mock.calls[1][0].prompt).toContain('CURRENT INSTRUCTOR REQUEST (task data): Use the given water-budget premise.');
    expect(save).toHaveBeenCalledTimes(1);
    expect(persisted.correctAnswer).toBe('85 liters');
    expect(persisted.explanation).toBe(review.explanation);
    expect(persisted.generationMetadata.qualityReview).toBe('ai-feedback-reviewed');
    expect(persisted.content.selectionMode).toBe('single');
    expect(persisted.content.options.map(({ text, isCorrect, tip, chosenFeedback, notChosenFeedback }) => ({ text, isCorrect, tip, chosenFeedback, notChosenFeedback })))
      .toEqual(options.map((option, index) => ({
        text: option.text, isCorrect: option.isCorrect, tip: option.tip,
        chosenFeedback: `${option.isCorrect ? 'Correct.' : 'This option is incorrect.'} ${review.feedback[index].rationale}`,
        notChosenFeedback: `${option.isCorrect ? 'This correct option was not selected.' : 'Correctly left unselected.'} ${review.feedback[index].rationale}`
      })));
    expect(persisted.generationMetadata.sourceReferences[0].chunkIndex).toBe(0);
  });

  test('a false reviewed calculation blocks the real persistence path without another generation', async () => {
    const raw = JSON.stringify({ questionText: 'What is the storage change?', correctAnswer: '85 liters', explanation: 'Subtract both outputs.', options });
    const invalidReview = { ...review, feedback: review.feedback.map((item, index) => index === 1
      ? { ...item, calculations: [{ expression: '150 - 20', result: 120 }] } : item) };
    const completion = jest.spyOn(llmService, 'streamCompletion')
      .mockResolvedValueOnce({ content: raw, model: 'test-generation-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(invalidReview), model: 'test-review-model' });
    const save = jest.spyOn(Question.prototype, 'save');
    await expect(questionStreamingService.generateQuestionWithStreaming({
      quizId: '507f1f77bcf86cd799439011', questionId: 'synthetic-invalid-math', sessionId: 'synthetic-session',
      userId: '507f1f77bcf86cd799439012', learningObjective: null,
      questionConfig: { questionType: 'multiple-choice', customPrompt: 'Use the supplied water budget.', useCustomPromptOnly: true },
      relevantContent: [{ content: 'Storage change is input minus outputs.' }]
    })).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
    expect(save).not.toHaveBeenCalled();
    expect(completion).toHaveBeenCalledTimes(2);
  });
});
