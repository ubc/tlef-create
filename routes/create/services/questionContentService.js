/**
 * H5P Mark the Words accepts one marked token per asterisk pair. Models and
 * manual editors sometimes produce a phrase such as `*normal force*`, which
 * H5P renders as two literal, unselectable fragments. Preserve whitespace but
 * mark every token in a multi-word span independently.
 */
export function normalizeMarkTheWordsText(text = '') {
  if (typeof text !== 'string') return '';

  return text.replace(/\*([^*\r\n]+)\*/g, (match, markedText) => {
    const tokens = markedText.match(/\S+/g) || [];
    if (tokens.length <= 1) return match;
    return markedText.replace(/\S+/g, token => `*${token}*`);
  });
}

/**
 * Format LLM-generated question content for database storage.
 * Maps raw generation output to the schema-expected content structure
 * for each question type.
 *
 * Handles both cases:
 * - Data already in generatedQuestion.content (from parseAndValidateResponse)
 * - Data at root level of generatedQuestion (from raw LLM output)
 */
export function formatContentForDatabase(generatedQuestion, questionType) {
  const c = generatedQuestion.content || {};

  switch (questionType) {
    case 'multiple-choice':
    case 'true-false':
      return {
        options: c.options || generatedQuestion.options || [],
        selectionMode: c.selectionMode || generatedQuestion.selectionMode || 'single'
      };

    case 'flashcard':
      return {
        front: c.front || generatedQuestion.front || '',
        back: c.back || generatedQuestion.back || ''
      };

    case 'matching':
      return {
        leftItems: c.leftItems || generatedQuestion.leftItems || [],
        rightItems: c.rightItems || generatedQuestion.rightItems || [],
        matchingPairs: c.matchingPairs || generatedQuestion.matchingPairs || []
      };

    case 'ordering':
      return {
        items: c.items || generatedQuestion.items || [],
        correctOrder: c.correctOrder || generatedQuestion.correctOrder || []
      };

    case 'cloze':
      return {
        textWithBlanks: c.textWithBlanks || generatedQuestion.textWithBlanks || generatedQuestion.questionText || '',
        blankOptions: c.blankOptions || generatedQuestion.blankOptions || [],
        correctAnswers: c.correctAnswers || generatedQuestion.correctAnswers || []
      };

    case 'summary':
      return c.keyPoints ? c : (generatedQuestion.content || {});

    case 'mark-the-words':
      return {
        text: normalizeMarkTheWordsText(c.text || generatedQuestion.text || '')
      };

    case 'single-choice-set':
      return {
        questions: c.questions || generatedQuestion.questions || []
      };

    case 'essay':
      return {
        taskDescription: c.taskDescription || generatedQuestion.taskDescription || '',
        keywords: c.keywords || generatedQuestion.keywords || [],
        sampleAnswer: c.sampleAnswer || generatedQuestion.sampleAnswer || ''
      };

    case 'question-set':
      return generatedQuestion.content || {};

    case 'free-text':
      return {
        question: c.question || generatedQuestion.question || generatedQuestion.questionText || '',
        placeholder: c.placeholder || generatedQuestion.placeholder || ''
      };

    case 'open-ended':
      return {
        question: c.question || generatedQuestion.question || generatedQuestion.questionText || '',
        placeholderText: c.placeholderText || generatedQuestion.placeholderText || ''
      };

    case 'simple-multi-choice':
      return {
        question: c.question || generatedQuestion.question || generatedQuestion.questionText || '',
        alternatives: c.alternatives || generatedQuestion.alternatives || []
      };

    case 'sort-paragraphs':
      return {
        paragraphs: c.paragraphs || generatedQuestion.paragraphs || [],
        taskDescription: c.taskDescription || generatedQuestion.taskDescription || ''
      };

    case 'crossword':
      return {
        words: c.words || generatedQuestion.words || [],
        taskDescription: c.taskDescription || generatedQuestion.taskDescription || ''
      };

    case 'dictation':
      return {
        sentences: c.sentences || generatedQuestion.sentences || [],
        taskDescription: c.taskDescription || generatedQuestion.taskDescription || ''
      };

    case 'arithmetic-quiz':
      return {
        quizType: c.quizType || generatedQuestion.quizType || 'addition',
        maxNumber: c.maxNumber || generatedQuestion.maxNumber || 10,
        numQuestions: c.numQuestions || generatedQuestion.numQuestions || 10
      };

    case 'branching-scenario':
      return generatedQuestion.content || {};

    case 'documentation-tool':
      return generatedQuestion.content || {};

    default:
      return generatedQuestion.content || {};
  }
}
