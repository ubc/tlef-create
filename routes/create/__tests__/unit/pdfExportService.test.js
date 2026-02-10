import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { addQuestionContent, addAnswerContent } from '../../services/pdfExportService.js';

// Create a mock PDFDocument that tracks method calls
function createMockDoc() {
  const calls = [];

  const doc = {
    calls,
    fontSize(size) { calls.push({ method: 'fontSize', args: [size] }); return doc; },
    font(name) { calls.push({ method: 'font', args: [name] }); return doc; },
    text(str, opts) { calls.push({ method: 'text', args: [str, opts] }); return doc; },
    fillColor(color) { calls.push({ method: 'fillColor', args: [color] }); return doc; },
    moveDown(n) { calls.push({ method: 'moveDown', args: [n] }); return doc; },
    strokeColor() { return doc; },
    moveTo() { return doc; },
    lineTo() { return doc; },
    stroke() { return doc; }
  };

  return doc;
}

// Helper to extract all text() call strings from mock doc
function getTextCalls(doc) {
  return doc.calls.filter(c => c.method === 'text').map(c => c.args[0]);
}

describe('pdfExportService', () => {
  let doc;

  beforeEach(() => {
    doc = createMockDoc();
  });

  describe('addQuestionContent', () => {
    test('multiple-choice: renders options with letters', () => {
      const question = {
        type: 'multiple-choice',
        content: {
          options: [
            { text: 'Alpha', isCorrect: false },
            { text: 'Beta', isCorrect: true },
            { text: 'Gamma', isCorrect: false }
          ]
        }
      };

      addQuestionContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Options:');
      expect(texts.some(t => t.includes('A. Alpha'))).toBe(true);
      expect(texts.some(t => t.includes('B. Beta'))).toBe(true);
      expect(texts.some(t => t.includes('C. Gamma'))).toBe(true);
    });

    test('true-false: renders True and False options', () => {
      const question = { type: 'true-false', correctAnswer: 'true' };

      addQuestionContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Options:');
      expect(texts).toContain('A. True');
      expect(texts).toContain('B. False');
    });

    test('cloze: renders fill-in-the-blanks text and options', () => {
      const question = {
        type: 'cloze',
        questionText: 'The $$ is blue',
        content: {
          textWithBlanks: 'The $$ is blue',
          blankOptions: [['sky', 'sea']]
        }
      };

      addQuestionContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Fill in the blanks:');
      expect(texts.some(t => t.includes('The $$ is blue'))).toBe(true);
      expect(texts.some(t => t.includes('sky, sea'))).toBe(true);
    });

    test('ordering: renders items to order', () => {
      const question = {
        type: 'ordering',
        content: {
          items: ['First', 'Second', 'Third']
        }
      };

      addQuestionContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Items to order:');
      expect(texts.some(t => t.includes('1. First'))).toBe(true);
      expect(texts.some(t => t.includes('2. Second'))).toBe(true);
    });

    test('matching: renders two columns', () => {
      const question = {
        type: 'matching',
        content: {
          leftItems: ['Cat', 'Dog'],
          rightItems: ['Meow', 'Bark']
        }
      };

      addQuestionContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Match the following:');
      expect(texts).toContain('Column A:');
      expect(texts).toContain('Column B:');
      expect(texts.some(t => t.includes('Cat'))).toBe(true);
      expect(texts.some(t => t.includes('Meow'))).toBe(true);
    });

    test('flashcard: renders front text', () => {
      const question = {
        type: 'flashcard',
        questionText: 'Default front',
        content: { front: 'What is H2O?' }
      };

      addQuestionContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Front:');
      expect(texts.some(t => t.includes('What is H2O?'))).toBe(true);
    });

    test('unknown type: renders nothing', () => {
      const question = { type: 'essay', content: {} };
      addQuestionContent(doc, question);
      const texts = getTextCalls(doc);
      // Should have no content-specific text
      expect(texts).toHaveLength(0);
    });
  });

  describe('addAnswerContent', () => {
    test('multiple-choice: shows correct option letter and text', () => {
      const question = {
        type: 'multiple-choice',
        content: {
          options: [
            { text: 'Wrong', isCorrect: false },
            { text: 'Right', isCorrect: true }
          ]
        }
      };

      addAnswerContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts.some(t => t.includes('B. Right'))).toBe(true);
    });

    test('multiple-choice: falls back to correctAnswer when no isCorrect', () => {
      const question = {
        type: 'multiple-choice',
        correctAnswer: 'Fallback answer',
        content: { options: [{ text: 'A', isCorrect: false }] }
      };

      addAnswerContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts.some(t => t.includes('Fallback answer'))).toBe(true);
    });

    test('true-false: shows True for true answer', () => {
      addAnswerContent(doc, { type: 'true-false', correctAnswer: 'true' });
      expect(getTextCalls(doc).some(t => t === 'True')).toBe(true);
    });

    test('true-false: shows False for false answer', () => {
      addAnswerContent(doc, { type: 'true-false', correctAnswer: 'false' });
      expect(getTextCalls(doc).some(t => t === 'False')).toBe(true);
    });

    test('cloze: shows correct answers per blank', () => {
      const question = {
        type: 'cloze',
        content: { correctAnswers: ['Paris', 'France'] }
      };

      addAnswerContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts.some(t => t.includes('Blank 1: Paris'))).toBe(true);
      expect(texts.some(t => t.includes('Blank 2: France'))).toBe(true);
    });

    test('ordering: shows correct order', () => {
      const question = {
        type: 'ordering',
        content: { correctOrder: ['First', 'Second', 'Third'] }
      };

      addAnswerContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Correct order:');
      expect(texts.some(t => t.includes('1. First'))).toBe(true);
    });

    test('matching: shows correct matches', () => {
      const question = {
        type: 'matching',
        content: { matchingPairs: [['France', 'Paris'], ['Japan', 'Tokyo']] }
      };

      addAnswerContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Correct matches:');
      expect(texts.some(t => t.includes('France → Paris'))).toBe(true);
    });

    test('flashcard: shows back text', () => {
      const question = {
        type: 'flashcard',
        content: { back: 'Water' },
        correctAnswer: 'fallback'
      };

      addAnswerContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Back:');
      expect(texts.some(t => t === 'Water')).toBe(true);
    });

    test('unknown type: falls back to correctAnswer', () => {
      addAnswerContent(doc, { type: 'essay', correctAnswer: 'Essay answer' });
      expect(getTextCalls(doc).some(t => t.includes('Essay answer'))).toBe(true);
    });

    test('unknown type with no answer: shows N/A', () => {
      addAnswerContent(doc, { type: 'essay' });
      expect(getTextCalls(doc).some(t => t === 'N/A')).toBe(true);
    });
  });
});
