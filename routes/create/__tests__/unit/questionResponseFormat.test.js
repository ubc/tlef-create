import { describe, expect, test } from '@jest/globals';
import llmService from '../../services/llmService.js';

const draft = questionText => ({ questionText,
  options: [{ text: '3 m/s²', isCorrect: true }, { text: '7 m/s²', isCorrect: false }],
  correctAnswer: '3 m/s²', explanation: 'Subtract opposite forces, then divide by mass.' });

describe('question response format boundaries', () => {
  test.each([
    'Preserve the literal punctuation ,} and ,] in this question. What is its value?',
    'Use the notation a_{x} for acceleration. What is its value?',
    'The literal symbol "}" appears in the supplied text. What is the acceleration?',
    'The notes use the incomplete label "{net force". What is the acceleration?',
    'The source contains the literal Markdown delimiter "```". What is the acceleration?'
  ])('preserves literal braces and quotes in learner content: %s', questionText => {
    const result = llmService.parseAndValidateResponse(JSON.stringify(draft(questionText)), 'multiple-choice');
    expect(result.questionText).toBe(questionText);
    expect(result.correctAnswer).toBe('3 m/s²');
  });

  test('rejects a JavaScript expression in a JSON field rather than guessing its meaning', () => {
    expect(() => llmService.parseAndValidateResponse('{"questionText": + "3 m/s²"}', 'multiple-choice'))
      .toThrow(expect.objectContaining({ code: 'QUESTION_INVALID_RESPONSE' }));
  });

  test('preserves escaped backslashes at the end of answer strings in formatted JSON', () => {
    const question = { questionText: 'Which path is the root of the C drive?',
      options: [{ text: 'C:\\', isCorrect: true }, { text: 'D:\\', isCorrect: false }],
      correctAnswer: 'C:\\', explanation: 'The drive letter identifies the volume.' };
    const result = llmService.parseAndValidateResponse(JSON.stringify(question, null, 2), 'multiple-choice');
    expect(result.content.options[0].text).toBe('C:\\');
    expect(result.correctAnswer).toBe('C:\\');
  });
});
