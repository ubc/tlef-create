import { describe, expect, test } from '@jest/globals';
import {
  normalizeGeneratedQuestionText,
  QUESTION_TEXT_LIMITS
} from '../../utils/questionTextLimits.js';

describe('generated question text limits', () => {
  test('preserves detailed explanations within the database limit', () => {
    const explanation = 'A'.repeat(1037);
    const normalized = normalizeGeneratedQuestionText({
      questionText: 'What happens during the interval?',
      explanation
    });

    expect(normalized.explanation).toBe(explanation);
  });

  test('bounds abnormal model output before database validation', () => {
    const normalized = normalizeGeneratedQuestionText({
      questionText: `  ${'Q'.repeat(QUESTION_TEXT_LIMITS.questionText + 50)}  `,
      explanation: `  ${'E'.repeat(QUESTION_TEXT_LIMITS.explanation + 50)}  `
    });

    expect(normalized.questionText).toHaveLength(QUESTION_TEXT_LIMITS.questionText);
    expect(normalized.explanation).toHaveLength(QUESTION_TEXT_LIMITS.explanation);
  });
});
