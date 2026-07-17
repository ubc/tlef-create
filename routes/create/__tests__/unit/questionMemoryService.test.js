import { describe, expect, test } from '@jest/globals';
import {
  buildQuestionMemory,
  calculateCosineSimilarity,
  calculateQuestionSimilarity,
  findMostSimilarQuestion,
  normalizeQuestionText
} from '../../services/questionMemoryService.js';

describe('questionMemoryService', () => {
  test('normalizes generic question boilerplate before comparison', () => {
    expect(normalizeQuestionText('Which of the following describes Methane?'))
      .toBe('describes methane');
  });

  test('scores repeated question stems higher than distinct tasks', () => {
    const duplicateScore = calculateQuestionSimilarity(
      'What is the primary anthropogenic source of methane emissions?',
      'Which of the following is the primary anthropogenic source of methane emissions?'
    );
    const distinctScore = calculateQuestionSimilarity(
      'What is the primary anthropogenic source of methane emissions?',
      'Calculate the net force on a block moving down an inclined plane.'
    );

    expect(duplicateScore).toBeGreaterThan(0.76);
    expect(distinctScore).toBeLessThan(0.3);
  });

  test('keeps only recent full questions in the LLM-facing memory', () => {
    const questions = Array.from({ length: 20 }, (_, index) => ({
      _id: `question-${index}`,
      type: 'multiple-choice',
      questionText: `Question ${index} about concept ${index}`,
      learningObjective: `lo-${index % 3}`,
      generationMetadata: { focusArea: `focus-${index % 4}` }
    }));

    const memory = buildQuestionMemory(questions, { recentLimit: 5 });
    expect(memory.previousQuestions).toHaveLength(5);
    expect(memory.comparisonQuestions).toHaveLength(20);
    expect(memory.stats).toEqual({ total: 20, recent: 5, compressed: 15 });
    expect(memory.prompt).toContain('Older history is compressed');
  });

  test('returns the closest existing question for the novelty gate', () => {
    const closest = findMostSimilarQuestion(
      'What is the main source of methane emissions?',
      [
        { id: 'a', questionText: 'Calculate acceleration on a ramp.' },
        { id: 'b', questionText: 'What is the main source of methane emissions?' }
      ]
    );

    expect(closest.questionId).toBe('b');
    expect(closest.similarity).toBe(1);
  });

  test('calculates cosine similarity for semantic duplicate checks', () => {
    expect(calculateCosineSimilarity([1, 0, 1], [1, 0, 1])).toBe(1);
    expect(calculateCosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(calculateCosineSimilarity([1], [1, 0])).toBe(0);
  });
});
