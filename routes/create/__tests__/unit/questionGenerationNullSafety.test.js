import { describe, expect, test } from '@jest/globals';
import llmService, { normalizeLearningObjectiveText } from '../../services/llmService.js';

describe('question generation null safety', () => {
  test('normalizes missing and object learning objectives without throwing', () => {
    expect(normalizeLearningObjectiveText(null)).toBe('');
    expect(normalizeLearningObjectiveText({ text: null })).toBe('');
    expect(normalizeLearningObjectiveText({ text: '  Explain feedback loops  ' })).toBe('Explain feedback loops');
  });

  test('builds metadata labels when a custom-prompt question has no learning objective', () => {
    expect(() => llmService.generateSubObjective(null, 'multiple-choice')).not.toThrow();
    expect(llmService.extractFocusArea(null, 'multiple-choice')).toBe('conceptual understanding');
    expect(llmService.determineComplexity(null, 'multiple-choice')).toBe('medium');
  });

  test('builds a prompt from custom context when the learning objective is null', async () => {
    const prompt = await llmService.buildExpertPrompt(
      null,
      'multiple-choice',
      [],
      'moderate',
      '',
      [],
      'Assess the instructor-provided case study.',
      'single'
    );

    expect(prompt).toContain('TASK CONTEXT (provided by instructor)');
    expect(prompt).toContain('Assess the instructor-provided case study.');
  });

  test('keeps the current teacher task distinct from history and limits novelty to that task', async () => {
    const request = 'Ask about condensation on the outside of a sealed cold glass. Do not ask about runoff.';
    const prompt = await llmService.buildExpertPrompt('Explain the water cycle.', 'multiple-choice', [], 'moderate', '',
      [{ questionText: 'Define condensation.' }], 'History guidance: choose a different slice.', 'single', 2, 2, request);
    expect(prompt).toContain(`REQUEST-SPECIFIC INSTRUCTOR INSTRUCTIONS:\n${request}`);
    expect(prompt).toContain('Novelty and history guidance must never replace an explicitly requested topic');
    expect(prompt).not.toContain('Do NOT reuse the same assessed slice');
    const format = llmService.getFormatInstructions('multiple-choice', 'single');
    expect(format).toContain('Follow the current instructor request first');
    expect(format).not.toContain('Do not repeat the same concept focus or scenario');
  });

  test('generates through the non-streaming fallback contract with a null objective', async () => {
    const originalCreateLLMForConfig = llmService.createLLMForConfig;
    llmService.createLLMForConfig = () => ({
      sendMessage: async () => ({
        content: JSON.stringify({
          questionText: 'Which statement follows the case?',
          options: [
            { text: 'Supported conclusion', isCorrect: true },
            { text: 'Unsupported conclusion', isCorrect: false }
          ],
          correctAnswer: 'Supported conclusion',
          explanation: 'The case supports the first conclusion.'
        }),
        model: 'test-model',
        usage: {}
      })
    });

    try {
      const result = await llmService.generateQuestion({
        learningObjective: null,
        questionType: 'multiple-choice',
        customPrompt: 'Assess the instructor-provided case.',
        relevantContent: [],
        llmConfig: {
          provider: 'ollama',
          model: 'test-model',
          endpoint: 'http://invalid.test'
        }
      });

      expect(result.success).toBe(true);
      expect(result.questionData.generationMetadata.learningObjective).toBeNull();
      expect(result.questionData.generationMetadata.subObjective).toContain('Assess the instructor-provided case.');
    } finally {
      llmService.createLLMForConfig = originalCreateLLMForConfig;
    }
  });

  test('streams GPT-5 nano questions with a reasoning-safe output budget', async () => {
    const originalStreamCompletion = llmService.streamCompletion;
    let completionOptions;
    const content = JSON.stringify({
      questionText: 'What force balances gravity in this diagram?',
      content: {
        solutionLabel: 'Reveal the force',
        solutionText: 'The upward normal force.'
      },
      correctAnswer: 'The upward normal force.',
      explanation: 'A stationary object has zero net vertical force.'
    });

    llmService.streamCompletion = async options => {
      completionOptions = options;
      return { content, model: options.llmConfig.model };
    };

    try {
      const result = await llmService.generateQuestionStreaming({
        learningObjective: 'Construct a free-body diagram for a stationary object.',
        questionType: 'guess-the-answer',
        relevantContent: [],
        llmConfig: {
          provider: 'openai',
          model: 'gpt-5-nano',
          apiKey: 'test-key',
          endpoint: 'https://api.openai.com/v1'
        }
      });

      expect(completionOptions.maxTokens).toBe(8000);
      expect(completionOptions.reasoningEffort).toBe('low');
      expect(result.questionData.content.solutionText).toBe('The upward normal force.');
    } finally {
      llmService.streamCompletion = originalStreamCompletion;
    }
  });
});
