import { describe, test, expect } from '@jest/globals';
import {
  escapeHtml,
  getQuestionTypeBreakdown,
  getDifficultyDistribution,
  estimateExportSize,
  generateAvailableOptionsText
} from '../../services/exportUtils.js';

describe('exportUtils', () => {
  describe('escapeHtml', () => {
    test('should return empty string for null/undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml('')).toBe('');
    });

    test('should return text unchanged when no special characters', () => {
      expect(escapeHtml('Hello world')).toBe('Hello world');
    });

    test('should escape all HTML special characters', () => {
      expect(escapeHtml('&')).toBe('&amp;');
      expect(escapeHtml('<')).toBe('&lt;');
      expect(escapeHtml('>')).toBe('&gt;');
      expect(escapeHtml('"')).toBe('&quot;');
      expect(escapeHtml("'")).toBe('&#039;');
    });

    test('should escape XSS vectors', () => {
      const xss = '<script>alert("xss")</script>';
      const result = escapeHtml(xss);
      expect(result).not.toContain('<script>');
      expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('should escape mixed content', () => {
      expect(escapeHtml('A & B < C > D')).toBe('A &amp; B &lt; C &gt; D');
    });
  });

  describe('getQuestionTypeBreakdown', () => {
    test('should return empty object for empty array', () => {
      expect(getQuestionTypeBreakdown([])).toEqual({});
    });

    test('should count single type', () => {
      const questions = [
        { type: 'multiple-choice' },
        { type: 'multiple-choice' },
        { type: 'multiple-choice' }
      ];
      expect(getQuestionTypeBreakdown(questions)).toEqual({ 'multiple-choice': 3 });
    });

    test('should count multiple types', () => {
      const questions = [
        { type: 'multiple-choice' },
        { type: 'true-false' },
        { type: 'multiple-choice' },
        { type: 'flashcard' },
        { type: 'cloze' },
        { type: 'true-false' },
        { type: 'matching' },
        { type: 'ordering' }
      ];
      expect(getQuestionTypeBreakdown(questions)).toEqual({
        'multiple-choice': 2,
        'true-false': 2,
        'flashcard': 1,
        'cloze': 1,
        'matching': 1,
        'ordering': 1
      });
    });
  });

  describe('getDifficultyDistribution', () => {
    test('should return empty object for empty array', () => {
      expect(getDifficultyDistribution([])).toEqual({});
    });

    test('should count mixed difficulties', () => {
      const questions = [
        { difficulty: 'easy' },
        { difficulty: 'medium' },
        { difficulty: 'hard' },
        { difficulty: 'easy' },
        { difficulty: 'medium' }
      ];
      expect(getDifficultyDistribution(questions)).toEqual({
        'easy': 2,
        'medium': 2,
        'hard': 1
      });
    });
  });

  describe('estimateExportSize', () => {
    test('should return KB for quiz at exactly 1024 bytes', () => {
      // 0 questions => 1024 bytes (base), 1024 < 1024 is false so hits KB branch
      expect(estimateExportSize({ questions: [] })).toBe('1 KB');
    });

    test('should return KB for typical quiz', () => {
      // 10 questions => 1024 + 5120 = 6144 => 6 KB
      const questions = new Array(10).fill({});
      expect(estimateExportSize({ questions })).toBe('6 KB');
    });

    test('should return MB for very large quiz', () => {
      // 2048 questions => 1024 + 1048576 = 1049600 => ~1 MB
      const questions = new Array(2048).fill({});
      expect(estimateExportSize({ questions })).toBe('1 MB');
    });
  });

  describe('generateAvailableOptionsText', () => {
    test('should return empty string for null/empty', () => {
      expect(generateAvailableOptionsText(null)).toBe('');
      expect(generateAvailableOptionsText([])).toBe('');
    });

    test('should generate options text for single blank', () => {
      const result = generateAvailableOptionsText([['cat', 'dog', 'bird']]);
      expect(result).toContain('Available options:');
      expect(result).toContain('Blank 1: cat, dog, bird');
    });

    test('should generate options text for multiple blanks', () => {
      const result = generateAvailableOptionsText([
        ['red', 'blue'],
        ['big', 'small']
      ]);
      expect(result).toContain('Blank 1: red, blue');
      expect(result).toContain('Blank 2: big, small');
    });

    test('should escape HTML in options', () => {
      const result = generateAvailableOptionsText([['<script>']]);
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });

    test('should skip empty option arrays', () => {
      const result = generateAvailableOptionsText([[], ['a', 'b']]);
      expect(result).not.toContain('Blank 1:');
      expect(result).toContain('Blank 2: a, b');
    });
  });
});
