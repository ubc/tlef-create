import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { addQuestionContent, addAnswerContent, createPDFExport } from '../../services/pdfExportService.js';

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
      expect(texts.some(t => t.includes('The ________ is blue'))).toBe(true);
      expect(texts.some(t => t.includes('The $$ is blue'))).toBe(false);
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

    test('mark-the-words: renders the statement without revealing answer markers', () => {
      const question = {
        type: 'mark-the-words',
        content: { text: 'Plants use *sunlight* to make *glucose*.' }
      };
      addQuestionContent(doc, question);
      const texts = getTextCalls(doc);
      expect(texts).toContain('Statement:');
      expect(texts).toContain('Plants use sunlight to make glucose.');
      expect(texts.join(' ')).not.toContain('*sunlight*');
    });

    test('single-choice-set: renders every sub-question and option', () => {
      addQuestionContent(doc, {
        type: 'single-choice-set',
        content: { questions: [
          { question: 'Capital of France?', answers: ['Paris', 'Rome'] },
          { question: 'Capital of Japan?', answers: ['Tokyo', 'Seoul'] }
        ] }
      });
      const texts = getTextCalls(doc);
      expect(texts).toContain('1. Capital of France?');
      expect(texts).toContain('A. Paris');
      expect(texts).toContain('2. Capital of Japan?');
      expect(texts).toContain('B. Seoul');
    });

    test('documentation-tool: renders generated page content and fields', () => {
      addQuestionContent(doc, {
        type: 'documentation-tool',
        content: {
          title: 'Lab Reflection',
          pages: [
            { type: 'intro', introText: 'Document your investigation.', fields: [{ label: 'What did you observe?' }] },
            { type: 'task', title: 'Analysis', fields: [{ label: 'Explain the result' }] },
            { type: 'goals' }
          ]
        }
      });
      const texts = getTextCalls(doc);
      expect(texts).toContain('Lab Reflection');
      expect(texts).toContain('1. Introduction');
      expect(texts).toContain('Document your investigation.');
      expect(texts.some(text => text.includes('What did you observe?'))).toBe(true);
      expect(texts).toContain('2. Analysis');
      expect(texts).toContain('3. Goals');
    });

    test('summary: renders all knowledge points', () => {
      addQuestionContent(doc, {
        type: 'summary',
        content: { keyPoints: [
          { title: 'Force', explanation: 'A push or pull.' },
          { title: 'Net force', explanation: 'The vector sum.' }
        ] }
      });
      const texts = getTextCalls(doc);
      expect(texts).toContain('Knowledge points:');
      expect(texts).toContain('1. Force — A push or pull.');
      expect(texts).toContain('2. Net force — The vector sum.');
    });

    test('essay: renders the actual essay topic', () => {
      addQuestionContent(doc, {
        type: 'essay',
        questionText: 'Write an essay about the topic below',
        content: { taskDescription: 'Compare positive and negative feedback loops.' }
      });
      const texts = getTextCalls(doc);
      expect(texts).toContain('Essay topic:');
      expect(texts).toContain('Compare positive and negative feedback loops.');
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

    test('multiple-choice: includes option feedback and explanation', () => {
      const question = {
        type: 'multiple-choice',
        explanation: 'Because this aligns with the learning objective.',
        content: {
          options: [
            { text: 'Wrong', isCorrect: false, chosenFeedback: 'This reflects a common misconception.' },
            { text: 'Right', isCorrect: true, notChosenFeedback: 'You should have selected this option.' }
          ]
        }
      };

      addAnswerContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts).toContain('Option Feedback:');
      expect(texts.some(t => t.includes('A. If selected: This reflects a common misconception.'))).toBe(true);
      expect(texts.some(t => t.includes('B. If not selected: You should have selected this option.'))).toBe(true);
      expect(texts).toContain('Explanation:');
      expect(texts).toContain('Because this aligns with the learning objective.');
    });

    test('multiple-choice: supports multiple correct answers', () => {
      const question = {
        type: 'multiple-choice',
        content: {
          selectionMode: 'multiple',
          options: [
            { text: 'Alpha', isCorrect: true },
            { text: 'Beta', isCorrect: false },
            { text: 'Gamma', isCorrect: true }
          ]
        }
      };

      addAnswerContent(doc, question);
      const texts = getTextCalls(doc);

      expect(texts.some(t => t.includes('A. Alpha'))).toBe(true);
      expect(texts.some(t => t.includes('C. Gamma'))).toBe(true);
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

    test('single-choice-set: uses the first option as each correct answer', () => {
      addAnswerContent(doc, {
        type: 'single-choice-set',
        content: { questions: [
          { question: 'One?', answers: ['Correct one', 'Wrong one'] },
          { question: 'Two?', answers: ['Correct two', 'Wrong two'] }
        ] }
      });
      expect(getTextCalls(doc)).toEqual(expect.arrayContaining(['1. Correct one', '2. Correct two']));
    });

    test('essay: renders sample answer and scoring keywords', () => {
      addAnswerContent(doc, {
        type: 'essay',
        content: {
          sampleAnswer: 'A model essay response.',
          keywords: [{ keyword: 'homeostasis', points: 2 }]
        }
      });
      const texts = getTextCalls(doc);
      expect(texts).toContain('A model essay response.');
      expect(texts).toContain('Suggested criteria:');
      expect(texts).toContain('homeostasis (2 points)');
    });

    test('unknown type: falls back to correctAnswer', () => {
      addAnswerContent(doc, { type: 'unknown', correctAnswer: 'Fallback answer' });
      expect(getTextCalls(doc).some(t => t.includes('Fallback answer'))).toBe(true);
    });

    test('unknown type with no answer: shows N/A', () => {
      addAnswerContent(doc, { type: 'unknown' });
      expect(getTextCalls(doc).some(t => t === 'N/A')).toBe(true);
    });
  });

  test('creates a multi-page PDF without adding footer-only pages', async () => {
    const outputPath = join(tmpdir(), `tlef-create-pdf-${randomUUID()}.pdf`);
    const blankMarker = String.fromCharCode(36, 36);
    const questions = [
      { type: 'mark-the-words', questionText: 'Mark correct words', content: { text: 'Plants use *sunlight*.' }, correctAnswer: 'sunlight' },
      { type: 'cloze', questionText: `The ${blankMarker} is blue`, content: { textWithBlanks: `The ${blankMarker} is blue`, correctAnswers: ['sky'] } },
      { type: 'single-choice-set', questionText: 'Choose answers', content: { questions: [{ question: 'Capital of France?', answers: ['Paris', 'Rome'] }] } },
      { type: 'documentation-tool', questionText: 'Document the lab', content: { title: 'Lab Reflection', pages: [{ type: 'intro', introText: 'Record evidence.', fields: [{ label: 'Observation' }] }] } },
      { type: 'summary', questionText: 'Summarize', content: { keyPoints: [{ title: 'Force', explanation: 'A push or pull.' }] } },
      { type: 'essay', questionText: 'Write an essay', content: { taskDescription: 'Compare feedback loops.', sampleAnswer: 'Sample.' } }
    ];

    try {
      await createPDFExport({ name: 'PDF regression check', questions }, outputPath, 'combined');
      const pdfSource = (await readFile(outputPath)).toString('latin1');
      const pageObjects = pdfSource.match(/\/Type \/Page\b/g) || [];
      expect(pageObjects).toHaveLength(2);
    } finally {
      await unlink(outputPath).catch(() => undefined);
    }
  });
});
