import { describe, test, expect } from '@jest/globals';
import {
  convertQuestionToH5P,
  generateH5PColumn,
  generateH5PDialogCards,
  generateH5PQuestionSet
} from '../../services/h5pExportService.js';

// Helper: assert subContentId is a 32-char hex string
function expectValidSubContentId(obj) {
  expect(obj.subContentId).toMatch(/^[0-9a-f]{32}$/);
}

describe('h5pExportService', () => {
  describe('convertQuestionToH5P', () => {
    test('multiple-choice: returns H5P.MultiChoice 1.16 with correct option mapping', () => {
      const question = {
        type: 'multiple-choice',
        questionText: 'What is 2+2?',
        content: {
          options: [
            { text: '3', isCorrect: false },
            { text: '4', isCorrect: true },
            { text: '5', isCorrect: false }
          ]
        }
      };

      const result = convertQuestionToH5P(question);
      expect(result).not.toBeNull();
      expect(result.library).toBe('H5P.MultiChoice 1.16');
      expect(result.params.question).toContain('What is 2+2?');
      expect(result.params.answers).toHaveLength(3);
      expect(result.params.answers[0].correct).toBe(false);
      expect(result.params.answers[1].correct).toBe(true);
      expect(result.params.answers[1].text).toContain('4');
      expectValidSubContentId(result);
    });

    test('true-false: returns H5P.TrueFalse 1.8 with correct answer mapping', () => {
      const questionTrue = {
        type: 'true-false',
        questionText: 'The sky is blue.',
        correctAnswer: 'true'
      };

      const result = convertQuestionToH5P(questionTrue);
      expect(result).not.toBeNull();
      expect(result.library).toBe('H5P.TrueFalse 1.8');
      expect(result.params.correct).toBe('true');
      expect(result.params.question).toContain('The sky is blue.');
      expectValidSubContentId(result);
    });

    test('true-false: case-insensitive answer handling', () => {
      const question = {
        type: 'true-false',
        questionText: 'Test',
        correctAnswer: 'True'
      };
      expect(convertQuestionToH5P(question).params.correct).toBe('true');

      question.correctAnswer = 'FALSE';
      expect(convertQuestionToH5P(question).params.correct).toBe('false');
    });

    test('matching: returns H5P.DragText 1.10 with textField containing asterisk markers', () => {
      const question = {
        type: 'matching',
        questionText: 'Match the capitals',
        content: {
          leftItems: ['France', 'Germany'],
          rightItems: ['Paris', 'Berlin'],
          matchingPairs: [['France', 'Paris'], ['Germany', 'Berlin']]
        }
      };

      const result = convertQuestionToH5P(question);
      expect(result).not.toBeNull();
      expect(result.library).toBe('H5P.DragText 1.10');
      expect(result.params.textField).toContain('*Paris*');
      expect(result.params.textField).toContain('*Berlin*');
      expect(result.params.textField).toContain('France');
      expectValidSubContentId(result);
    });

    test('ordering: returns H5P.DragText 1.10 with position markers', () => {
      const question = {
        type: 'ordering',
        questionText: 'Order these steps',
        content: {
          items: ['Step A', 'Step B', 'Step C'],
          correctOrder: ['Step A', 'Step B', 'Step C']
        }
      };

      const result = convertQuestionToH5P(question);
      expect(result).not.toBeNull();
      expect(result.library).toBe('H5P.DragText 1.10');
      expect(result.params.textField).toBeDefined();
      // Each item should have a position marker like *1*, *2*, *3*
      expect(result.params.textField).toMatch(/\*\d+\*/);
      expect(result.params.behaviour.disableDraggablesRandomization).toBe(true);
      expectValidSubContentId(result);
    });

    test('cloze: returns H5P.Blanks 1.14 with $$ replaced by *answer*', () => {
      const question = {
        type: 'cloze',
        questionText: 'The capital of France is $$',
        content: {
          textWithBlanks: 'The capital of France is $$',
          correctAnswers: ['Paris'],
          blankOptions: [['Paris', 'London', 'Berlin']]
        }
      };

      const result = convertQuestionToH5P(question);
      expect(result).not.toBeNull();
      expect(result.library).toBe('H5P.Blanks 1.14');
      expect(result.params.questions[0]).toContain('*Paris*');
      expect(result.params.questions[0]).not.toContain('$$');
      expectValidSubContentId(result);
    });

    test('discussion: returns H5P.AdvancedText 1.1', () => {
      const question = {
        type: 'discussion',
        questionText: 'Discuss the implications of climate change.'
      };

      const result = convertQuestionToH5P(question);
      expect(result).not.toBeNull();
      expect(result.library).toBe('H5P.AdvancedText 1.1');
      expect(result.params.text).toContain('Discuss the implications');
      expectValidSubContentId(result);
    });

    test('summary with keyPoints: returns H5P.Accordion 1.0', () => {
      const question = {
        type: 'summary',
        questionText: 'Summary of chapter 1',
        content: {
          keyPoints: [
            { title: 'Point 1', explanation: 'First key concept' },
            { title: 'Point 2', explanation: 'Second key concept' }
          ]
        }
      };

      const result = convertQuestionToH5P(question);
      expect(result).not.toBeNull();
      expect(result.library).toBe('H5P.Accordion 1.0');
      expect(result.params.panels).toHaveLength(2);
      expect(result.params.panels[0].title).toBe('Point 1');
      expect(result.params.panels[0].content.library).toBe('H5P.AdvancedText 1.1');
      expectValidSubContentId(result);
    });

    test('summary with learning objectives fallback: returns Accordion with objectives', () => {
      const question = {
        type: 'summary',
        questionText: 'Summary',
        content: {}
      };
      const quiz = {
        learningObjectives: [
          { text: 'Understand arrays' },
          { text: 'Understand loops' }
        ]
      };

      const result = convertQuestionToH5P(question, quiz);
      expect(result.library).toBe('H5P.Accordion 1.0');
      expect(result.params.panels).toHaveLength(2);
      expect(result.params.panels[0].title).toBe('Learning Objective 1');
    });

    test('unknown type: returns null', () => {
      const question = { type: 'unknown-type', questionText: 'test' };
      expect(convertQuestionToH5P(question)).toBeNull();
    });
  });

  describe('generateH5PColumn', () => {
    test('flashcard-only: includes Dialog Cards', () => {
      const quiz = { name: 'Test Quiz' };
      const flashcards = [
        { type: 'flashcard', content: { front: 'Q1', back: 'A1' }, questionText: 'Q1', correctAnswer: 'A1' }
      ];
      const result = generateH5PColumn(quiz, flashcards, []);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].content.library).toBe('H5P.Dialogcards 1.9');
      expect(result.content[0].content.params.dialogs).toHaveLength(1);
    });

    test('non-flashcard only: includes individual questions', () => {
      const quiz = { name: 'Test Quiz' };
      const nonFlashcards = [
        { type: 'multiple-choice', questionText: 'Q1', content: { options: [{ text: 'A', isCorrect: true }] } },
        { type: 'true-false', questionText: 'Q2', correctAnswer: 'true' }
      ];
      const result = generateH5PColumn(quiz, [], nonFlashcards);

      expect(result.content).toHaveLength(2);
      expect(result.content[0].content.library).toBe('H5P.MultiChoice 1.16');
      expect(result.content[1].content.library).toBe('H5P.TrueFalse 1.8');
    });

    test('mixed: includes Dialog Cards + individual questions', () => {
      const quiz = { name: 'Mixed Quiz' };
      const flashcards = [
        { type: 'flashcard', content: { front: 'F1', back: 'B1' }, questionText: 'F1', correctAnswer: 'B1' }
      ];
      const nonFlashcards = [
        { type: 'true-false', questionText: 'TF1', correctAnswer: 'false' }
      ];

      const result = generateH5PColumn(quiz, flashcards, nonFlashcards);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].content.library).toBe('H5P.Dialogcards 1.9');
      expect(result.content[1].content.library).toBe('H5P.TrueFalse 1.8');
    });

    test('empty: returns empty content array', () => {
      const result = generateH5PColumn({ name: 'Empty' }, [], []);
      expect(result.content).toHaveLength(0);
    });
  });

  describe('generateH5PDialogCards', () => {
    test('should generate dialog cards from flashcard questions', () => {
      const flashcards = [
        { content: { front: 'Capital of France?', back: 'Paris' }, questionText: 'Q', correctAnswer: 'A' },
        { content: { front: 'Capital of Japan?', back: 'Tokyo' }, questionText: 'Q', correctAnswer: 'A' }
      ];

      const result = generateH5PDialogCards(flashcards);
      expect(result.dialogs).toHaveLength(2);
      expect(result.dialogs[0].text).toContain('Capital of France?');
      expect(result.dialogs[0].answer).toContain('Paris');
      expect(result.dialogs[1].text).toContain('Capital of Japan?');
      expect(result.behaviour.enableRetry).toBe(true);
    });

    test('should escape HTML in card content', () => {
      const flashcards = [
        { content: { front: '<b>Bold</b>', back: '5 > 3' }, questionText: 'Q', correctAnswer: 'A' }
      ];
      const result = generateH5PDialogCards(flashcards);
      expect(result.dialogs[0].text).not.toContain('<b>');
      expect(result.dialogs[0].answer).toContain('&gt;');
    });
  });

  describe('generateH5PQuestionSet', () => {
    test('should generate question set for mixed question types', () => {
      const questions = [
        {
          type: 'multiple-choice',
          questionText: 'MC Question',
          content: { options: [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: false }] }
        },
        {
          type: 'true-false',
          questionText: 'TF Question',
          correctAnswer: 'true'
        }
      ];

      const result = generateH5PQuestionSet(questions);
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].library).toBe('H5P.MultiChoice 1.16');
      expect(result.questions[1].library).toBe('H5P.TrueFalse 1.8');
      expect(result.progressType).toBe('dots');
      expect(result.passPercentage).toBe(50);
    });

    test('should filter out unsupported types', () => {
      const questions = [
        { type: 'unknown', questionText: 'Unknown' },
        { type: 'multiple-choice', questionText: 'MC', content: { options: [{ text: 'A', isCorrect: true }] } }
      ];
      const result = generateH5PQuestionSet(questions);
      expect(result.questions).toHaveLength(1);
    });

    test('should return empty questions for empty input', () => {
      const result = generateH5PQuestionSet([]);
      expect(result.questions).toHaveLength(0);
    });
  });
});
