/**
 * Format LLM-generated question content for database storage.
 * Maps raw generation output to the schema-expected content structure
 * for each question type.
 */
export function formatContentForDatabase(generatedQuestion, questionType) {
  switch (questionType) {
    case 'multiple-choice':
    case 'true-false':
      return {
        options: generatedQuestion.options || []
      };

    case 'flashcard':
      return generatedQuestion.content || {
        front: generatedQuestion.front || '',
        back: generatedQuestion.back || ''
      };

    case 'matching':
      return {
        leftItems: generatedQuestion.leftItems || [],
        rightItems: generatedQuestion.rightItems || [],
        matchingPairs: generatedQuestion.matchingPairs || []
      };

    case 'ordering':
      return {
        items: generatedQuestion.items || [],
        correctOrder: generatedQuestion.correctOrder || []
      };

    case 'cloze':
      return {
        textWithBlanks: generatedQuestion.content?.textWithBlanks || generatedQuestion.textWithBlanks || generatedQuestion.questionText || '',
        blankOptions: generatedQuestion.content?.blankOptions || generatedQuestion.blankOptions || [],
        correctAnswers: generatedQuestion.content?.correctAnswers || generatedQuestion.correctAnswers || []
      };

    case 'summary':
      return generatedQuestion.content || {};

    default:
      return generatedQuestion.content || {};
  }
}
