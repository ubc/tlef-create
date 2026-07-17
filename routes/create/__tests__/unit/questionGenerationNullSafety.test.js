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
});
