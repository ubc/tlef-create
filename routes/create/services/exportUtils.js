/**
 * Pure utility functions for export operations.
 * No side effects, no I/O — easy to unit test.
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Get breakdown of question types in a question set
 * @param {Array} questions - Array of question documents
 * @returns {Object} Map of type -> count
 */
export function getQuestionTypeBreakdown(questions) {
  const breakdown = {};
  questions.forEach(q => {
    breakdown[q.type] = (breakdown[q.type] || 0) + 1;
  });
  return breakdown;
}

/**
 * Get distribution of difficulty levels in a question set
 * @param {Array} questions - Array of question documents
 * @returns {Object} Map of difficulty -> count
 */
export function getDifficultyDistribution(questions) {
  const distribution = {};
  questions.forEach(q => {
    distribution[q.difficulty] = (distribution[q.difficulty] || 0) + 1;
  });
  return distribution;
}

/**
 * Estimate the export file size for a quiz
 * @param {Object} quiz - Quiz document with questions array
 * @returns {string} Human-readable size estimate
 */
export function estimateExportSize(quiz) {
  const baseSize = 1024; // Base H5P structure
  const questionSize = 512; // Average per question
  const estimated = baseSize + (quiz.questions.length * questionSize);

  if (estimated < 1024) return `${estimated} bytes`;
  if (estimated < 1024 * 1024) return `${Math.round(estimated / 1024)} KB`;
  return `${Math.round(estimated / (1024 * 1024))} MB`;
}

/**
 * Generate available options text for Cloze questions
 * @param {Array<Array<string>>} blankOptions - Array of option arrays for each blank
 * @returns {string} Formatted HTML text showing available options
 */
export function generateAvailableOptionsText(blankOptions) {
  if (!blankOptions || blankOptions.length === 0) {
    return '';
  }

  let optionsText = '<strong>Available options:</strong><br>';

  blankOptions.forEach((options, index) => {
    if (options && options.length > 0) {
      const optionsList = options.map(option => escapeHtml(option)).join(', ');
      optionsText += `Blank ${index + 1}: ${optionsList}<br>`;
    }
  });

  return optionsText;
}
