import { describe, test, expect } from '@jest/globals';
import { formatContentForDatabase } from '../../services/questionContentService.js';

describe('questionContentService', () => {
  describe('formatContentForDatabase', () => {
    test('multiple-choice: wraps options array', () => {
      const result = formatContentForDatabase({
        options: [
          { text: 'A', isCorrect: true },
          { text: 'B', isCorrect: false }
        ]
      }, 'multiple-choice');
      expect(result.options).toHaveLength(2);
      expect(result.options[0].isCorrect).toBe(true);
    });

    test('multiple-choice: defaults to empty options', () => {
      const result = formatContentForDatabase({}, 'multiple-choice');
      expect(result.options).toEqual([]);
    });

    test('true-false: wraps options same as multiple-choice', () => {
      const result = formatContentForDatabase({
        options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }]
      }, 'true-false');
      expect(result.options).toHaveLength(2);
    });

    test('flashcard: uses content when present', () => {
      const result = formatContentForDatabase({
        content: { front: 'Q?', back: 'A!' }
      }, 'flashcard');
      expect(result.front).toBe('Q?');
      expect(result.back).toBe('A!');
    });

    test('flashcard: falls back to top-level front/back', () => {
      const result = formatContentForDatabase({
        front: 'Top Q', back: 'Top A'
      }, 'flashcard');
      expect(result.front).toBe('Top Q');
      expect(result.back).toBe('Top A');
    });

    test('flashcard: defaults to empty strings', () => {
      const result = formatContentForDatabase({}, 'flashcard');
      expect(result.front).toBe('');
      expect(result.back).toBe('');
    });

    test('matching: extracts left/right items and pairs', () => {
      const result = formatContentForDatabase({
        leftItems: ['France'],
        rightItems: ['Paris'],
        matchingPairs: [['France', 'Paris']]
      }, 'matching');
      expect(result.leftItems).toEqual(['France']);
      expect(result.rightItems).toEqual(['Paris']);
      expect(result.matchingPairs).toEqual([['France', 'Paris']]);
    });

    test('matching: defaults to empty arrays', () => {
      const result = formatContentForDatabase({}, 'matching');
      expect(result.leftItems).toEqual([]);
      expect(result.rightItems).toEqual([]);
      expect(result.matchingPairs).toEqual([]);
    });

    test('ordering: extracts items and correctOrder', () => {
      const result = formatContentForDatabase({
        items: ['A', 'B', 'C'],
        correctOrder: ['C', 'B', 'A']
      }, 'ordering');
      expect(result.items).toEqual(['A', 'B', 'C']);
      expect(result.correctOrder).toEqual(['C', 'B', 'A']);
    });

    test('cloze: prefers content nested fields', () => {
      const result = formatContentForDatabase({
        content: {
          textWithBlanks: 'The $$ is blue',
          blankOptions: [['sky', 'sea']],
          correctAnswers: ['sky']
        }
      }, 'cloze');
      expect(result.textWithBlanks).toBe('The $$ is blue');
      expect(result.blankOptions).toEqual([['sky', 'sea']]);
      expect(result.correctAnswers).toEqual(['sky']);
    });

    test('cloze: falls back to top-level fields', () => {
      const result = formatContentForDatabase({
        textWithBlanks: 'Top $$',
        blankOptions: [['x']],
        correctAnswers: ['x']
      }, 'cloze');
      expect(result.textWithBlanks).toBe('Top $$');
    });

    test('cloze: falls back to questionText for textWithBlanks', () => {
      const result = formatContentForDatabase({
        questionText: 'Fallback text'
      }, 'cloze');
      expect(result.textWithBlanks).toBe('Fallback text');
    });

    test('summary: returns content as-is', () => {
      const content = { keyPoints: [{ title: 'A', explanation: 'B' }] };
      const result = formatContentForDatabase({ content }, 'summary');
      expect(result.keyPoints).toEqual([{ title: 'A', explanation: 'B' }]);
    });

    test('summary: defaults to empty object', () => {
      const result = formatContentForDatabase({}, 'summary');
      expect(result).toEqual({});
    });

    test('discussion: returns content via default case', () => {
      const result = formatContentForDatabase({ content: { notes: 'some' } }, 'discussion');
      expect(result.notes).toBe('some');
    });

    test('unknown type: returns content or empty object', () => {
      expect(formatContentForDatabase({}, 'unknown-type')).toEqual({});
      expect(formatContentForDatabase({ content: { x: 1 } }, 'unknown-type')).toEqual({ x: 1 });
    });
  });
});
