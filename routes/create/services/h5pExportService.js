/**
 * H5P Export Service
 * Handles all H5P content generation and packaging logic.
 */
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

import LIBRARY_REGISTRY, { getNeededLibraries } from '../config/h5pLibraryRegistry.js';
import { escapeHtml, generateAvailableOptionsText } from './exportUtils.js';

/**
 * Create an H5P ZIP package from a quiz.
 * @param {Object} quiz - Populated quiz document
 * @param {string} outputPath - Destination file path
 * @param {Object} [options] - Optional config
 * @param {string} [options.libraryPath] - Override library directory (useful for tests)
 */
export async function createH5PPackage(quiz, outputPath, options = {}) {
  const uploadsDir = path.dirname(outputPath);
  await fs.mkdir(uploadsDir, { recursive: true });

  return new Promise(async (resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => {
      console.log(`H5P package created: ${archive.pointer()} bytes`);
      resolve();
    });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      reject(err);
    });

    archive.pipe(output);

    // Classify questions
    const flashcardQuestions = quiz.questions.filter(q => q.type === 'flashcard');
    const nonFlashcardQuestions = quiz.questions.filter(q => q.type !== 'flashcard');
    const hasMixedContent = flashcardQuestions.length > 0 && nonFlashcardQuestions.length > 0;
    const isFlashcardOnly = flashcardQuestions.length > 0 && nonFlashcardQuestions.length === 0;

    // Determine needed libraries
    const questionTypes = new Set(quiz.questions.map(q => q.type));
    const neededLibNames = getNeededLibraries(questionTypes, { hasMixedContent, isFlashcardOnly });

    // Build preloadedDependencies
    const preloadedDependencies = [];
    for (const libName of neededLibNames) {
      const lib = LIBRARY_REGISTRY[libName];
      if (lib) {
        preloadedDependencies.push({
          machineName: libName,
          majorVersion: lib.majorVersion,
          minorVersion: lib.minorVersion
        });
      }
    }

    // Create h5p.json
    let h5pJson;
    if (hasMixedContent || !isFlashcardOnly) {
      h5pJson = {
        title: quiz.name || "Quiz Export",
        language: "en",
        mainLibrary: "H5P.Column",
        embedTypes: ["div"],
        license: "U",
        defaultLanguage: "en",
        preloadedDependencies
      };
    } else {
      h5pJson = {
        title: quiz.name || "Quiz Export",
        language: "en",
        mainLibrary: "H5P.Dialogcards",
        embedTypes: ["iframe"],
        license: "U",
        preloadedDependencies
      };
    }

    // Generate content
    const contentJson = generateH5PColumn(quiz, flashcardQuestions, nonFlashcardQuestions);

    // Add files to archive
    archive.append(JSON.stringify(h5pJson), { name: 'h5p.json' });
    archive.append(JSON.stringify(contentJson), { name: 'content/content.json' });

    // Add library directories
    const libraryPath = options.libraryPath || path.join('./routes/create/h5p-libs/');
    try {
      await fs.access(libraryPath);
      for (const libName of neededLibNames) {
        const lib = LIBRARY_REGISTRY[libName];
        if (lib) {
          const libDir = path.join(libraryPath, lib.dirName);
          try {
            await fs.access(libDir);
            archive.directory(libDir, lib.dirName);
          } catch {
            // Library directory not found, skip
          }
        }
      }
    } catch (error) {
      console.warn('H5P library files not found, creating minimal export:', error.message);
    }

    archive.finalize();
  });
}

/**
 * Generate H5P Column content (hybrid: Dialogcards + individual questions).
 */
export function generateH5PColumn(quiz, flashcardQuestions, nonFlashcardQuestions) {
  const columnContent = [];

  // Add flashcards as Dialog Cards
  if (flashcardQuestions.length > 0) {
    const flashcardDialogs = flashcardQuestions.map(question => {
      const front = question.content?.front || question.questionText || "Front of card";
      const back = question.content?.back || question.correctAnswer || "Back of card";
      const escapedFront = front.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const escapedBack = back.replace(/</g, '&lt;').replace(/>/g, '&gt;');

      return {
        "text": `<p style="text-align:center;">${escapedFront}</p>`,
        "answer": `<p style="text-align:center;">${escapedBack}</p>`,
        "tips": {},
        "imageAltText": ""
      };
    });

    columnContent.push({
      "content": {
        "params": {
          "mode": "normal",
          "dialogs": flashcardDialogs,
          "behaviour": {
            "enableRetry": true,
            "disableBackwardsNavigation": false,
            "scaleTextNotCard": false,
            "randomCards": false,
            "maxProficiency": 5,
            "quickProgression": false
          },
          "answer": "Turn",
          "next": "Next",
          "prev": "Previous",
          "retry": "Retry",
          "correctAnswer": "I got it right!",
          "incorrectAnswer": "I got it wrong",
          "round": "Round @round",
          "cardsLeft": "Cards left: @number",
          "nextRound": "Proceed to round @round",
          "startOver": "Start over",
          "showSummary": "Next",
          "summary": "Summary",
          "summaryCardsRight": "Cards you got right:",
          "summaryCardsWrong": "Cards you got wrong:",
          "summaryCardsNotShown": "Cards in pool not shown:",
          "summaryOverallScore": "Overall Score",
          "summaryCardsCompleted": "Cards you have completed learning:",
          "summaryCompletedRounds": "Completed rounds:",
          "summaryAllDone": "Well done! You have mastered all @cards cards by getting them correct @max times!",
          "progressText": "Card @card of @total",
          "cardFrontLabel": "Card front",
          "cardBackLabel": "Card back",
          "tipButtonLabel": "Show tip",
          "audioNotSupported": "Your browser does not support this audio",
          "confirmStartingOver": {
            "header": "Start over?",
            "body": "All progress will be lost. Are you sure you want to start over?",
            "cancelLabel": "Cancel",
            "confirmLabel": "Start over"
          },
          "title": `<p>${escapeHtml(quiz.name || 'Study Cards')}</p>`,
          "description": ""
        },
        "library": "H5P.Dialogcards 1.9",
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Dialog Cards",
          "license": "U",
          "title": "Flashcards"
        }
      },
      "useSeparator": "auto"
    });
  }

  // Add non-flashcard questions individually
  nonFlashcardQuestions.forEach(question => {
    const h5pQuestion = convertQuestionToH5P(question, quiz);
    if (h5pQuestion) {
      columnContent.push({
        "content": h5pQuestion,
        "useSeparator": "auto"
      });
    }
  });

  return { "content": columnContent };
}

/**
 * Generate H5P QuestionSet content for supported question types.
 */
export function generateH5PQuestionSet(questions) {
  const questionSetQuestions = questions.map(question => {
    let h5pQuestion;

    if (question.type === 'multiple-choice') {
      h5pQuestion = {
        "params": {
          "media": { "disableImageZooming": false },
          "answers": question.content?.options?.map(option => ({
            "correct": option.isCorrect || false,
            "text": `<div>${escapeHtml(option.text)}</div>`,
            "tipsAndFeedback": {}
          })) || [],
          "overallFeedback": [{ "from": 0, "to": 100 }],
          "behaviour": {
            "enableRetry": true,
            "enableSolutionsButton": true,
            "enableCheckButton": true,
            "type": "auto",
            "singlePoint": false,
            "randomAnswers": true,
            "showSolutionsRequiresInput": true,
            "confirmCheckDialog": false,
            "confirmRetryDialog": false,
            "autoCheck": false,
            "passPercentage": 100,
            "showScorePoints": true
          },
          "UI": {
            "checkAnswerButton": "Check",
            "submitAnswerButton": "Submit",
            "showSolutionButton": "Show solution",
            "tryAgainButton": "Retry",
            "tipsLabel": "Show tip",
            "scoreBarLabel": "You got :num out of :total points",
            "tipAvailable": "Tip available",
            "feedbackAvailable": "Feedback available",
            "readFeedback": "Read feedback",
            "wrongAnswer": "Wrong answer",
            "correctAnswer": "Correct answer",
            "shouldCheck": "Should have been checked",
            "shouldNotCheck": "Should not have been checked",
            "noInput": "Please answer before viewing the solution",
            "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
            "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
            "a11yRetry": "Retry the task. Reset all responses and start the task over again."
          },
          "confirmCheck": {
            "header": "Finish ?",
            "body": "Are you sure you wish to finish ?",
            "cancelLabel": "Cancel",
            "confirmLabel": "Finish"
          },
          "confirmRetry": {
            "header": "Retry ?",
            "body": "Are you sure you wish to retry ?",
            "cancelLabel": "Cancel",
            "confirmLabel": "Confirm"
          },
          "question": `<p>${escapeHtml(question.questionText)}</p>`
        },
        "library": "H5P.MultiChoice 1.16",
        "metadata": {
          "contentType": "Multiple Choice",
          "license": "U",
          "title": "Untitled Multiple Choice"
        },
        "subContentId": crypto.randomBytes(16).toString('hex')
      };
    } else if (question.type === 'true-false') {
      h5pQuestion = {
        "params": {
          "media": { "disableImageZooming": false },
          "correct": String(question.correctAnswer).toLowerCase() === "true" ? "true" : "false",
          "behaviour": {
            "enableRetry": true,
            "enableSolutionsButton": true,
            "enableCheckButton": true,
            "confirmCheckDialog": false,
            "confirmRetryDialog": false,
            "autoCheck": false
          },
          "l10n": {
            "trueText": "True",
            "falseText": "False",
            "score": "You got @score of @total points",
            "checkAnswer": "Check",
            "submitAnswer": "Submit",
            "showSolutionButton": "Show solution",
            "tryAgain": "Retry",
            "wrongAnswerMessage": "Wrong answer",
            "correctAnswerMessage": "Correct answer",
            "scoreBarLabel": "You got :num out of :total points",
            "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
            "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
            "a11yRetry": "Retry the task. Reset all responses and start the task over again."
          },
          "confirmCheck": {
            "header": "Finish ?",
            "body": "Are you sure you wish to finish ?",
            "cancelLabel": "Cancel",
            "confirmLabel": "Finish"
          },
          "confirmRetry": {
            "header": "Retry ?",
            "body": "Are you sure you wish to retry ?",
            "cancelLabel": "Cancel",
            "confirmLabel": "Confirm"
          },
          "question": `<p>${escapeHtml(question.questionText)}</p>`
        },
        "library": "H5P.TrueFalse 1.8",
        "metadata": {
          "contentType": "True/False Question",
          "license": "U",
          "title": "Untitled True/False Question"
        },
        "subContentId": crypto.randomBytes(16).toString('hex')
      };
    } else if (question.type === 'cloze') {
      const textWithBlanks = question.content?.textWithBlanks || question.questionText;
      const correctAnswers = question.content?.correctAnswers || [];
      const blankOptions = question.content?.blankOptions || [];

      let h5pText = textWithBlanks;
      correctAnswers.forEach((answer, index) => {
        h5pText = h5pText.replace(/\$\$/, `*${escapeHtml(answer)}*`);
      });

      const optionsText = generateAvailableOptionsText(blankOptions);

      h5pQuestion = {
        "params": {
          "media": { "disableImageZooming": false },
          "taskDescription": `<p>${escapeHtml(question.questionText.split('\\n')[0])}</p>`,
          "overallFeedback": [{ "from": 0, "to": 100 }],
          "showSolutions": "Show solution",
          "tryAgain": "Retry",
          "checkAnswer": "Check",
          "submitAnswer": "Submit",
          "notFilledOut": "Please fill in all blanks to view solution",
          "answerIsCorrect": "':ans' is correct",
          "answerIsWrong": "':ans' is wrong",
          "answeredCorrectly": "Answered correctly",
          "answeredIncorrectly": "Answered incorrectly",
          "solutionLabel": "Correct answer:",
          "inputLabel": "Blank input @num of @total",
          "inputHasTipLabel": "Tip available",
          "tipLabel": "Tip",
          "behaviour": {
            "enableRetry": true,
            "enableSolutionsButton": true,
            "enableCheckButton": true,
            "autoCheck": false,
            "caseSensitive": true,
            "showSolutionsRequiresInput": true,
            "separateLines": false,
            "confirmCheckDialog": false,
            "confirmRetryDialog": false,
            "acceptSpellingErrors": false
          },
          "scoreBarLabel": "You got :num out of :total points",
          "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
          "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
          "a11yRetry": "Retry the task. Reset all responses and start the task over again.",
          "a11yCheckingModeHeader": "Checking mode",
          "confirmCheck": {
            "header": "Finish ?",
            "body": "Are you sure you wish to finish ?",
            "cancelLabel": "Cancel",
            "confirmLabel": "Finish"
          },
          "confirmRetry": {
            "header": "Retry ?",
            "body": "Are you sure you wish to retry ?",
            "cancelLabel": "Cancel",
            "confirmLabel": "Confirm"
          },
          "questions": [`<p>${escapeHtml(h5pText)}${optionsText ? '<br><br>' + optionsText : ''}</p>`]
        },
        "library": "H5P.Blanks 1.14",
        "metadata": {
          "contentType": "Fill in the Blanks",
          "license": "U",
          "title": "Untitled Fill in the Blanks"
        },
        "subContentId": crypto.randomBytes(16).toString('hex')
      };
    } else if (question.type === 'ordering') {
      const items = question.content?.items || ['Item 1', 'Item 2', 'Item 3'];
      const correctOrder = question.content?.correctOrder || items;

      const shuffledItems = [...items];
      for (let i = shuffledItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledItems[i], shuffledItems[j]] = [shuffledItems[j], shuffledItems[i]];
      }

      let textField = "";
      shuffledItems.forEach((item, index) => {
        const correctPosition = correctOrder.indexOf(item) + 1;
        textField += `*${correctPosition}*. ${escapeHtml(item)}\\n`;
      });

      const distractorNumbers = Array.from({length: items.length}, (_, i) => i + 1).join(" ");

      h5pQuestion = {
        "params": {
          "media": { "disableImageZooming": false },
          "taskDescription": `<p>${escapeHtml(question.questionText)}</p>`,
          "textField": textField.replace(/\\n/g, '\n'),
          "overallFeedback": [{ "from": 0, "to": 100 }],
          "checkAnswer": "Check",
          "submitAnswer": "Submit",
          "tryAgain": "Retry",
          "showSolution": "Show solution",
          "dropZoneIndex": "Drop Zone @index.",
          "empty": "Drop Zone @index is empty.",
          "contains": "Drop Zone @index contains draggable @draggable.",
          "ariaDraggableIndex": "@index of @count draggables.",
          "tipLabel": "Show tip",
          "correctText": "Correct!",
          "incorrectText": "Incorrect!",
          "resetDropTitle": "Reset drop",
          "resetDropDescription": "Are you sure you want to reset this drop zone?",
          "grabbed": "Draggable is grabbed.",
          "cancelledDragging": "Cancelled dragging.",
          "correctAnswer": "Correct answer:",
          "feedbackHeader": "Feedback",
          "behaviour": {
            "enableRetry": true,
            "enableSolutionsButton": true,
            "enableCheckButton": true,
            "instantFeedback": false,
            "disableDraggablesRandomization": true
          },
          "scoreBarLabel": "You got :num out of :total points",
          "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
          "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
          "a11yRetry": "Retry the task. Reset all responses and start the task over again.",
          "distractors": distractorNumbers.join(" ")
        },
        "library": "H5P.DragText 1.10",
        "metadata": {
          "contentType": "Drag the Words",
          "license": "U",
          "title": "Untitled Drag the Words"
        },
        "subContentId": crypto.randomBytes(16).toString('hex')
      };
    }

    return h5pQuestion;
  }).filter(Boolean);

  return {
    "introPage": {
      "showIntroPage": false,
      "startButtonText": "Start Quiz"
    },
    "progressType": "dots",
    "passPercentage": 50,
    "questions": questionSetQuestions,
    "disableBackwardsNavigation": false,
    "randomQuestions": false,
    "endGame": {
      "showResultPage": true,
      "showSolutionButton": true,
      "showRetryButton": true,
      "noResultMessage": "Finished",
      "message": "Your result:",
      "scoreBarLabel": "You got @finals out of @totals points",
      "overallFeedback": [{ "from": 0, "to": 100 }],
      "solutionButtonText": "Show solution",
      "retryButtonText": "Retry",
      "finishButtonText": "Finish",
      "submitButtonText": "Submit",
      "showAnimations": false,
      "skippable": false,
      "skipButtonText": "Skip video"
    },
    "texts": {
      "prevButton": "Previous question",
      "nextButton": "Next question",
      "finishButton": "Finish",
      "submitButton": "Submit",
      "textualProgress": "Question: @current of @total questions",
      "jumpToQuestion": "Question %d of %total",
      "questionLabel": "Question",
      "readSpeakerProgress": "Question @current of @total",
      "unansweredText": "Unanswered",
      "answeredText": "Answered",
      "currentQuestionText": "Current question",
      "navigationLabel": "Questions",
      "questionSetInstruction": "Choose question to display"
    },
    "override": {
      "checkButton": true
    }
  };
}

/**
 * Generate H5P Dialog Cards content for flashcard-only quizzes.
 */
export function generateH5PDialogCards(flashcardQuestions) {
  const flashcardDialogs = flashcardQuestions.map(question => {
    const front = question.content?.front || question.questionText || "Front of card";
    const back = question.content?.back || question.correctAnswer || "Back of card";
    const escapedFront = front.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedBack = back.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return {
      "text": `<p style="text-align: center;">${escapedFront}</p>`,
      "answer": `<p style="text-align: center;">${escapedBack}</p>`,
      "tips": {},
      "audio": [],
      "image": {},
      "imageAltText": ""
    };
  });

  return {
    "title": "<p>Study Cards</p>\n",
    "description": "<p>Review these flashcards to learn the material.</p>\n",
    "dialogs": flashcardDialogs,
    "next": "Next",
    "answer": "Turn",
    "prev": "Previous",
    "retry": "Try again",
    "progressText": "Card @card of @total",
    "behaviour": {
      "scaleTextNotCard": true,
      "enableRetry": true,
      "disableBackwardsNavigation": false,
      "randomCards": false,
      "maxProficiency": 5,
      "quickProgression": false
    },
    "cardFrontLabel": "Card front",
    "cardBackLabel": "Card back",
    "tipButtonLabel": "Show tip",
    "audioNotSupported": "Your browser does not support this audio",
    "mode": "normal",
    "correctAnswer": "I got it right!",
    "incorrectAnswer": "I got it wrong",
    "round": "Round @round",
    "cardsLeft": "Cards left: @number",
    "nextRound": "Proceed to round @round",
    "startOver": "Start over",
    "showSummary": "Next",
    "summary": "Summary",
    "summaryCardsRight": "Cards you got right:",
    "summaryCardsWrong": "Cards you got wrong:",
    "summaryCardsNotShown": "Cards in pool not shown:",
    "summaryOverallScore": "Overall Score",
    "summaryCardsCompleted": "Cards you have completed learning:",
    "summaryCompletedRounds": "Completed rounds:",
    "summaryAllDone": "Well done! You got all @cards cards correct @max times in a row!",
    "confirmStartingOver": {
      "header": "Start over?",
      "body": "All progress will be lost. Are you sure you want to start over?",
      "cancelLabel": "Cancel",
      "confirmLabel": "Start over"
    }
  };
}

/**
 * Convert a single question to H5P format for Column content.
 * @param {Object} question - Question document
 * @param {Object} quiz - Quiz document (used for summary fallback)
 * @returns {Object|null} H5P content object, or null for unsupported types
 */
export function convertQuestionToH5P(question, quiz) {
  if (question.type === 'multiple-choice') {
    return {
      "library": "H5P.MultiChoice 1.16",
      "params": {
        "question": `<p>${escapeHtml(question.questionText)}</p>`,
        "answers": question.content?.options?.map(option => ({
          "correct": option.isCorrect || false,
          "text": `<div>${escapeHtml(option.text)}</div>\n`,
          "tipsAndFeedback": {
            "tip": "",
            "chosenFeedback": option.isCorrect ? "Correct!" : "Try again",
            "notChosenFeedback": ""
          }
        })) || [],
        "behaviour": {
          "enableRetry": true,
          "enableSolutionsButton": true,
          "enableCheckButton": true,
          "type": "auto",
          "singlePoint": true,
          "randomAnswers": false,
          "showSolutionsRequiresInput": true,
          "confirmCheckDialog": false,
          "confirmRetryDialog": false,
          "autoCheck": false,
          "passPercentage": 100,
          "showScorePoints": true
        },
        "UI": {
          "checkAnswerButton": "Check",
          "submitAnswerButton": "Submit",
          "showSolutionButton": "Show solution",
          "tryAgainButton": "Try again",
          "tipsLabel": "Show tip",
          "scoreBarLabel": "You got :num out of :total points",
          "tipAvailable": "Tip available",
          "feedbackAvailable": "Feedback available",
          "readFeedback": "Read feedback",
          "wrongAnswer": "Wrong answer",
          "correctAnswer": "Correct answer",
          "shouldCheck": "Should have been checked",
          "shouldNotCheck": "Should not have been checked",
          "noInput": "Please answer before viewing the solution"
        },
        "confirmCheck": {
          "header": "Finish ?",
          "body": "Are you sure you wish to finish ?",
          "cancelLabel": "Cancel",
          "confirmLabel": "Finish"
        },
        "confirmRetry": {
          "header": "Retry ?",
          "body": "Are you sure you wish to retry ?",
          "cancelLabel": "Cancel",
          "confirmLabel": "Confirm"
        },
        "overallFeedback": []
      },
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Multiple Choice",
        "license": "U",
        "title": "Question"
      }
    };
  } else if (question.type === 'true-false') {
    return {
      "params": {
        "media": { "disableImageZooming": false },
        "correct": String(question.correctAnswer).toLowerCase() === "true" ? "true" : "false",
        "behaviour": {
          "enableRetry": true,
          "enableSolutionsButton": true,
          "enableCheckButton": true,
          "confirmCheckDialog": false,
          "confirmRetryDialog": false,
          "autoCheck": false
        },
        "l10n": {
          "trueText": "True",
          "falseText": "False",
          "score": "You got @score of @total points",
          "checkAnswer": "Check",
          "submitAnswer": "Submit",
          "showSolutionButton": "Show solution",
          "tryAgain": "Retry",
          "wrongAnswerMessage": "Wrong answer",
          "correctAnswerMessage": "Correct answer",
          "scoreBarLabel": "You got :num out of :total points",
          "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
          "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
          "a11yRetry": "Retry the task. Reset all responses and start the task over again."
        },
        "confirmCheck": {
          "header": "Finish ?",
          "body": "Are you sure you wish to finish ?",
          "cancelLabel": "Cancel",
          "confirmLabel": "Finish"
        },
        "confirmRetry": {
          "header": "Retry ?",
          "body": "Are you sure you wish to retry ?",
          "cancelLabel": "Cancel",
          "confirmLabel": "Confirm"
        },
        "question": `<p>${escapeHtml(question.questionText)}</p>`
      },
      "library": "H5P.TrueFalse 1.8",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "True/False Question",
        "license": "U",
        "title": "True/False Question"
      }
    };
  } else if (question.type === 'matching') {
    const leftItems = question.content?.leftItems || [];
    const rightItems = question.content?.rightItems || [];
    const matchingPairs = question.content?.matchingPairs || [];

    let textField = "";
    leftItems.forEach((leftItem, index) => {
      const correctMatch = matchingPairs.find(pair => pair[0] === leftItem)?.[1] || rightItems[index] || rightItems[0];
      textField += `${index + 1}. ${escapeHtml(leftItem)} = *${escapeHtml(correctMatch)}*\n`;
    });

    const usedRightItems = matchingPairs.map(pair => pair[1]);
    const distractors = rightItems.filter(item => !usedRightItems.includes(item));
    const distractorText = distractors.length > 0 ? distractors.map(d => escapeHtml(d)).join(" ") : "";

    return {
      "params": {
        "media": { "disableImageZooming": false },
        "taskDescription": `<p>${escapeHtml(question.questionText || 'Drag the words into the correct boxes')}</p>`,
        "overallFeedback": [{ "from": 0, "to": 100 }],
        "checkAnswer": "Check",
        "submitAnswer": "Submit",
        "tryAgain": "Retry",
        "showSolution": "Show solution",
        "dropZoneIndex": "Drop Zone @index.",
        "empty": "Drop Zone @index is empty.",
        "contains": "Drop Zone @index contains draggable @draggable.",
        "ariaDraggableIndex": "@index of @count draggables.",
        "tipLabel": "Show tip",
        "correctText": "Correct!",
        "incorrectText": "Incorrect!",
        "resetDropTitle": "Reset drop",
        "resetDropDescription": "Are you sure you want to reset this drop zone?",
        "grabbed": "Draggable is grabbed.",
        "cancelledDragging": "Cancelled dragging.",
        "correctAnswer": "Correct answer:",
        "feedbackHeader": "Feedback",
        "behaviour": {
          "enableRetry": true,
          "enableSolutionsButton": true,
          "enableCheckButton": true,
          "instantFeedback": false
        },
        "scoreBarLabel": "You got :num out of :total points",
        "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
        "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
        "a11yRetry": "Retry the task. Reset all responses and start the task over again.",
        "textField": textField.replace(/\n/g, '\n'),
        "distractors": distractorText
      },
      "library": "H5P.DragText 1.10",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Drag the Words",
        "license": "U",
        "title": "Matching question"
      }
    };
  } else if (question.type === 'ordering') {
    const items = question.content?.items || ['Item 1', 'Item 2', 'Item 3'];
    const correctOrder = question.content?.correctOrder || items;

    const shuffledItems = [...items];
    for (let i = shuffledItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledItems[i], shuffledItems[j]] = [shuffledItems[j], shuffledItems[i]];
    }

    let textField = "";
    shuffledItems.forEach((item, index) => {
      const correctPosition = correctOrder.indexOf(item) + 1;
      textField += `*${correctPosition}*. ${escapeHtml(item)}\\n`;
    });

    const distractorNumbers = Array.from({length: items.length}, (_, i) => i + 1).map(String);

    return {
      "params": {
        "media": { "disableImageZooming": false },
        "taskDescription": `<p>${escapeHtml(question.questionText)}</p>`,
        "textField": textField.replace(/\\n/g, '\n'),
        "overallFeedback": [{ "from": 0, "to": 100 }],
        "checkAnswer": "Check",
        "submitAnswer": "Submit",
        "tryAgain": "Retry",
        "showSolution": "Show solution",
        "dropZoneIndex": "Drop Zone @index.",
        "empty": "Drop Zone @index is empty.",
        "contains": "Drop Zone @index contains draggable @draggable.",
        "ariaDraggableIndex": "@index of @count draggables.",
        "tipLabel": "Show tip",
        "correctText": "Correct!",
        "incorrectText": "Incorrect!",
        "resetDropTitle": "Reset drop",
        "resetDropDescription": "Are you sure you want to reset this drop zone?",
        "grabbed": "Draggable is grabbed.",
        "cancelledDragging": "Cancelled dragging.",
        "correctAnswer": "Correct answer:",
        "feedbackHeader": "Feedback",
        "behaviour": {
          "enableRetry": true,
          "enableSolutionsButton": true,
          "enableCheckButton": true,
          "instantFeedback": false,
          "disableDraggablesRandomization": true
        },
        "scoreBarLabel": "You got :num out of :total points",
        "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
        "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
        "a11yRetry": "Retry the task. Reset all responses and start the task over again.",
        "distractors": distractorNumbers.join(" ")
      },
      "library": "H5P.DragText 1.10",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Drag the Words",
        "license": "U",
        "title": "Ordering question"
      }
    };
  } else if (question.type === 'cloze') {
    const textWithBlanks = question.content?.textWithBlanks || question.questionText;
    const correctAnswers = question.content?.correctAnswers || [];
    const blankOptions = question.content?.blankOptions || [];

    let h5pText = textWithBlanks;
    correctAnswers.forEach((answer, index) => {
      h5pText = h5pText.replace(/\$\$/, `*${escapeHtml(answer)}*`);
    });

    const optionsText = generateAvailableOptionsText(blankOptions);

    return {
      "params": {
        "media": { "disableImageZooming": false },
        "taskDescription": `<p>${escapeHtml(question.questionText.split('\\n')[0])}</p>`,
        "overallFeedback": [{ "from": 0, "to": 100 }],
        "showSolutions": "Show solution",
        "tryAgain": "Retry",
        "checkAnswer": "Check",
        "submitAnswer": "Submit",
        "notFilledOut": "Please fill in all blanks to view solution",
        "answerIsCorrect": "':ans' is correct",
        "answerIsWrong": "':ans' is wrong",
        "answeredCorrectly": "Answered correctly",
        "answeredIncorrectly": "Answered incorrectly",
        "solutionLabel": "Correct answer:",
        "inputLabel": "Blank input @num of @total",
        "inputHasTipLabel": "Tip available",
        "tipLabel": "Tip",
        "behaviour": {
          "enableRetry": true,
          "enableSolutionsButton": true,
          "enableCheckButton": true,
          "autoCheck": false,
          "caseSensitive": true,
          "showSolutionsRequiresInput": true,
          "separateLines": false,
          "confirmCheckDialog": false,
          "confirmRetryDialog": false,
          "acceptSpellingErrors": false
        },
        "scoreBarLabel": "You got :num out of :total points",
        "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
        "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
        "a11yRetry": "Retry the task. Reset all responses and start the task over again.",
        "a11yCheckingModeHeader": "Checking mode",
        "confirmCheck": {
          "header": "Finish ?",
          "body": "Are you sure you wish to finish ?",
          "cancelLabel": "Cancel",
          "confirmLabel": "Finish"
        },
        "confirmRetry": {
          "header": "Retry ?",
          "body": "Are you sure you wish to retry ?",
          "cancelLabel": "Cancel",
          "confirmLabel": "Confirm"
        },
        "questions": [`<p>${escapeHtml(h5pText)}${optionsText ? '<br><br>' + optionsText : ''}</p>`]
      },
      "library": "H5P.Blanks 1.14",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Fill in the Blanks",
        "license": "U",
        "title": "Cloze question"
      }
    };
  } else if (question.type === 'discussion') {
    return {
      "params": {
        "text": `<p>${escapeHtml(question.questionText)}</p>`
      },
      "library": "H5P.AdvancedText 1.1",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Text",
        "license": "U",
        "title": "Discussion question"
      }
    };
  } else if (question.type === 'summary') {
    const panels = [];

    if (question.content?.keyPoints && question.content.keyPoints.length > 0) {
      question.content.keyPoints.forEach((keyPoint, index) => {
        const bulletContent = `
          <div style="padding: 10px;">
            <h4 style="color: #2563eb; margin-bottom: 8px;">${escapeHtml(keyPoint.title)}</h4>
            <p style="line-height: 1.5; margin: 0;">${escapeHtml(keyPoint.explanation)}</p>
          </div>
        `;
        panels.push({
          "content": {
            "params": { "text": bulletContent },
            "library": "H5P.AdvancedText 1.1",
            "subContentId": crypto.randomBytes(16).toString('hex'),
            "metadata": {
              "contentType": "Text",
              "license": "U",
              "title": "Key Learning Point"
            }
          },
          "title": keyPoint.title
        });
      });
    } else {
      const learningObjectives = quiz?.learningObjectives || [];
      if (learningObjectives.length > 0) {
        learningObjectives.forEach((objective, index) => {
          const objectiveText = objective.text || objective.description || objective.content || `Learning Objective ${index + 1}`;
          const bulletContent = `
            <ul>
              <li><strong>Objective:</strong> ${escapeHtml(objectiveText)}</li>
              <li><strong>Key Points:</strong> Understanding and application of this concept</li>
              <li><strong>Assessment Focus:</strong> This objective will be evaluated through various question types</li>
            </ul>
            ${question.content?.additionalNotes ? `<p><em>Additional Notes:</em> ${escapeHtml(question.content.additionalNotes)}</p>` : ''}
          `;
          panels.push({
            "content": {
              "params": { "text": bulletContent },
              "library": "H5P.AdvancedText 1.1",
              "subContentId": crypto.randomBytes(16).toString('hex'),
              "metadata": {
                "contentType": "Text",
                "license": "U",
                "title": "Learning Objective Text"
              }
            },
            "title": `Learning Objective ${index + 1}`
          });
        });
      } else {
        panels.push({
          "content": {
            "params": {
              "text": `<p>${escapeHtml(question.explanation || question.content?.summary || 'Summary content will be based on learning objectives when they are available.')}</p>`
            },
          "library": "H5P.AdvancedText 1.1",
          "subContentId": crypto.randomBytes(16).toString('hex'),
          "metadata": {
              "contentType": "Text",
              "license": "U",
              "title": "Summary Text"
            }
          },
          "title": question.content?.title || "Summary"
        });
      }
    }

    return {
      "params": {
        "panels": panels,
        "hTag": "h2"
      },
      "library": "H5P.Accordion 1.0",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Accordion",
        "license": "U",
        "title": "Summary question"
      }
    };
  }

  return null;
}
