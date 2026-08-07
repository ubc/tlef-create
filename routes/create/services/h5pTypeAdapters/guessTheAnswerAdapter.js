import crypto from 'crypto';
import { escapeHtml } from '../exportUtils.js';

/**
 * Convert CREATE's compact self-check shape into the official
 * H5P.GuessTheAnswer semantics. New phase-three types should follow this
 * isolated adapter pattern instead of adding another branch to the legacy
 * exporter.
 */
export function convertGuessTheAnswerToH5P(question) {
  const solutionText = question.content?.solutionText || question.correctAnswer || '';

  return {
    params: {
      taskDescription: `<p>${escapeHtml(question.questionText || '')}</p>`,
      solutionLabel: escapeHtml(question.content?.solutionLabel || 'Click to reveal the answer'),
      solutionText: escapeHtml(solutionText)
    },
    library: 'H5P.GuessTheAnswer 1.5',
    subContentId: crypto.randomBytes(16).toString('hex'),
    metadata: {
      contentType: 'Guess the Answer',
      license: 'U',
      title: 'Guess the Answer'
    }
  };
}
