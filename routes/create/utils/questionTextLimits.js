export const QUESTION_TEXT_LIMITS = Object.freeze({
  questionText: 2000,
  explanation: 5000
});

function limitGeneratedText(value, maxLength) {
  if (typeof value !== 'string') return value;

  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;

  return normalized.slice(0, maxLength).trimEnd();
}

export function normalizeGeneratedQuestionText(questionData = {}) {
  return {
    ...questionData,
    questionText: limitGeneratedText(
      questionData.questionText,
      QUESTION_TEXT_LIMITS.questionText
    ),
    explanation: limitGeneratedText(
      questionData.explanation,
      QUESTION_TEXT_LIMITS.explanation
    )
  };
}
