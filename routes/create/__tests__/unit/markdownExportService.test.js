import { describe, test, expect } from '@jest/globals';
import {
  renderMarkdownQuestion,
  renderMarkdownQuestionContent,
  renderMarkdownAnswerContent
} from '../../services/markdownExportService.js';

describe('markdownExportService', () => {
  test('renders multiple-choice question content with options', () => {
    const output = renderMarkdownQuestionContent({
      type: 'multiple-choice',
      content: {
        options: [
          { text: 'Alpha', isCorrect: false },
          { text: 'Beta', isCorrect: true }
        ]
      }
    });

    expect(output).toContain('### Options');
    expect(output).toContain('- A. Alpha');
    expect(output).toContain('- B. Beta');
  });

  test('renders answer content with explanation', () => {
    const output = renderMarkdownAnswerContent({
      type: 'multiple-choice',
      content: {
        options: [
          { text: 'Wrong', isCorrect: false },
          { text: 'Right', isCorrect: true }
        ]
      },
      explanation: 'Because Right is supported by the material.'
    });

    expect(output).toContain('- Correct Answer: B\\. Right');
    expect(output).toContain('- Explanation:');
    expect(output).toContain('Because Right is supported by the material.');
  });

  test('renders combined markdown question with metadata and answer section', () => {
    const output = renderMarkdownQuestion({
      type: 'true-false',
      questionText: 'The Earth orbits the Sun.',
      difficulty: 'easy',
      correctAnswer: 'true',
      explanation: 'This is a basic astronomy fact.',
      learningObjective: { text: 'Identify basic astronomy facts' }
    }, 0, 'combined');

    expect(output).toContain('## Question 1');
    expect(output).toContain('The Earth orbits the Sun.');
    expect(output).toContain('- Type: True False');
    expect(output).toContain('- Learning Objective: Identify basic astronomy facts');
    expect(output).toContain('### Answer');
    expect(output).toContain('- Correct Answer: True');
  });
});

