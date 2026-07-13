/**
 * Markdown Export Service
 * Handles Markdown generation for quiz exports.
 */
import { writeFile } from 'fs/promises';

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function escapeMarkdown(value) {
  return normalizeText(value).replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1');
}

function renderTypeLabel(type) {
  return String(type || 'unknown')
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getQuestionLearningObjective(question) {
  if (typeof question.learningObjective === 'string') {
    return question.learningObjective;
  }

  return question.learningObjective?.text || '';
}

function getMultipleChoiceMode(question) {
  if (question.content?.selectionMode === 'multiple') {
    return 'multiple';
  }

  const correctCount = (question.content?.options || []).filter(option => option.isCorrect).length;
  return correctCount > 1 ? 'multiple' : 'single';
}

export function renderMarkdownQuestion(question, index, exportType) {
  const lines = [];
  const questionNumber = index + 1;
  const questionText = normalizeText(question.questionText) || 'Untitled question';
  const learningObjective = getQuestionLearningObjective(question);

  lines.push(`## Question ${questionNumber}`);
  lines.push('');
  lines.push(questionText);
  lines.push('');
  lines.push(`- Type: ${renderTypeLabel(question.type)}`);

  if (question.difficulty) {
    lines.push(`- Difficulty: ${escapeMarkdown(question.difficulty)}`);
  }

  if (learningObjective) {
    lines.push(`- Learning Objective: ${escapeMarkdown(learningObjective)}`);
  }

  if (exportType === 'questions' || exportType === 'combined') {
    const questionContent = renderMarkdownQuestionContent(question);
    if (questionContent.length > 0) {
      lines.push('');
      lines.push(...questionContent);
    }
  }

  if (exportType === 'answers' || exportType === 'combined') {
    const answerContent = renderMarkdownAnswerContent(question);
    if (answerContent.length > 0) {
      lines.push('');
      lines.push('### Answer');
      lines.push('');
      lines.push(...answerContent);
    }
  }

  return lines.join('\n');
}

export function renderMarkdownQuestionContent(question) {
  const lines = [];

  if (question.type === 'multiple-choice') {
    const options = question.content?.options || [];
    if (options.length > 0) {
      lines.push('### Options');
      lines.push('');
      options.forEach((option, index) => {
        const letter = String.fromCharCode(65 + index);
        lines.push(`- ${letter}. ${escapeMarkdown(option.text)}`);
      });

      const tips = options
        .map((option, index) => option.tip ? `- Tip for ${String.fromCharCode(65 + index)}: ${escapeMarkdown(option.tip)}` : null)
        .filter(Boolean);

      if (tips.length > 0) {
        lines.push('');
        lines.push('### Tips');
        lines.push('');
        lines.push(...tips);
      }
    }
  } else if (question.type === 'true-false') {
    lines.push('### Options');
    lines.push('');
    lines.push('- A. True');
    lines.push('- B. False');
  } else if (question.type === 'cloze') {
    lines.push('### Prompt');
    lines.push('');
    lines.push(normalizeText(question.content?.textWithBlanks || question.questionText));

    const blankOptions = question.content?.blankOptions || [];
    if (blankOptions.length > 0) {
      lines.push('');
      lines.push('### Blank Options');
      lines.push('');
      blankOptions.forEach((options, index) => {
        if (Array.isArray(options) && options.length > 0) {
          lines.push(`- Blank ${index + 1}: ${options.map(option => escapeMarkdown(option)).join(', ')}`);
        }
      });
    }
  } else if (question.type === 'ordering') {
    const items = question.content?.items || [];
    if (items.length > 0) {
      lines.push('### Items to Order');
      lines.push('');
      items.forEach((item, index) => {
        lines.push(`${index + 1}. ${escapeMarkdown(item)}`);
      });
    }
  } else if (question.type === 'matching') {
    const leftItems = question.content?.leftItems || [];
    const rightItems = question.content?.rightItems || [];
    lines.push('### Matching Pairs');
    lines.push('');
    if (leftItems.length > 0) {
      lines.push('Column A:');
      leftItems.forEach((item, index) => {
        lines.push(`- ${index + 1}. ${escapeMarkdown(item)}`);
      });
      lines.push('');
    }
    if (rightItems.length > 0) {
      lines.push('Column B:');
      rightItems.forEach((item, index) => {
        const letter = String.fromCharCode(65 + index);
        lines.push(`- ${letter}. ${escapeMarkdown(item)}`);
      });
    }
  } else if (question.type === 'flashcard') {
    lines.push('### Front');
    lines.push('');
    lines.push(normalizeText(question.content?.front || question.questionText));
  }

  return lines;
}

export function renderMarkdownAnswerContent(question) {
  const lines = [];

  if (question.type === 'multiple-choice') {
    const options = question.content?.options || [];
    const correctOptions = options.filter(option => option.isCorrect);
    if (correctOptions.length > 0) {
      if (getMultipleChoiceMode(question) === 'multiple') {
        lines.push('- Correct Answers:');
        correctOptions.forEach((correctOption) => {
          const letter = String.fromCharCode(65 + options.indexOf(correctOption));
          lines.push(`  - ${letter}. ${escapeMarkdown(correctOption.text)}`);
        });
      } else {
        const correctOption = correctOptions[0];
        const letter = String.fromCharCode(65 + options.indexOf(correctOption));
        lines.push(`- Correct Answer: ${letter}. ${escapeMarkdown(correctOption.text)}`);
      }
    } else if (question.correctAnswer) {
      lines.push(`- Correct Answer: ${escapeMarkdown(question.correctAnswer)}`);
    }

    const feedbackLines = options.flatMap((option, index) => {
      const letter = String.fromCharCode(65 + index);
      return [
        option.chosenFeedback ? `  - ${letter}. If selected: ${escapeMarkdown(option.chosenFeedback)}` : null,
        option.notChosenFeedback ? `  - ${letter}. If not selected: ${escapeMarkdown(option.notChosenFeedback)}` : null
      ].filter(Boolean);
    });

    if (feedbackLines.length > 0) {
      lines.push('- Option Feedback:');
      lines.push(...feedbackLines);
    }
  } else if (question.type === 'true-false') {
    const answer = String(question.correctAnswer).toLowerCase() === 'true' ? 'True' : 'False';
    lines.push(`- Correct Answer: ${answer}`);
  } else if (question.type === 'cloze') {
    const correctAnswers = question.content?.correctAnswers || [];
    if (correctAnswers.length > 0) {
      correctAnswers.forEach((answer, index) => {
        lines.push(`- Blank ${index + 1}: ${escapeMarkdown(answer)}`);
      });
    } else if (question.correctAnswer) {
      lines.push(`- Correct Answer: ${escapeMarkdown(question.correctAnswer)}`);
    }
  } else if (question.type === 'ordering') {
    const correctOrder = question.content?.correctOrder || [];
    if (correctOrder.length > 0) {
      lines.push('- Correct Order:');
      correctOrder.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${escapeMarkdown(item)}`);
      });
    }
  } else if (question.type === 'matching') {
    const matchingPairs = question.content?.matchingPairs || [];
    if (matchingPairs.length > 0) {
      lines.push('- Correct Matches:');
      matchingPairs.forEach(([left, right]) => {
        lines.push(`  - ${escapeMarkdown(left)} -> ${escapeMarkdown(right)}`);
      });
    }
  } else if (question.type === 'flashcard') {
    lines.push(`- Back: ${escapeMarkdown(question.content?.back || question.correctAnswer || '')}`);
  } else if (question.correctAnswer) {
    lines.push(`- Correct Answer: ${escapeMarkdown(question.correctAnswer)}`);
  }

  if (question.explanation) {
    lines.push('- Explanation:');
    lines.push('');
    lines.push(normalizeText(question.explanation));
  }

  return lines.filter(line => line !== '');
}

/**
 * Create a Markdown export of quiz questions.
 * @param {Object} quiz - Quiz document with populated questions
 * @param {string} outputPath - File path to save Markdown
 * @param {string} type - Export type: 'questions', 'answers', or 'combined'
 */
export async function createMarkdownExport(quiz, outputPath, type) {
  const typeLabels = {
    questions: 'Questions Only',
    answers: 'Answer Key',
    combined: 'Questions and Answers'
  };

  const lines = [
    `# ${quiz.name}`,
    '',
    `Export Type: ${typeLabels[type]}`,
    `Question Count: ${quiz.questions.length}`,
    ''
  ];

  quiz.questions.forEach((question, index) => {
    lines.push(renderMarkdownQuestion(question, index, type));
    lines.push('');
  });

  await writeFile(outputPath, `${lines.join('\n').trim()}\n`, 'utf8');
}
