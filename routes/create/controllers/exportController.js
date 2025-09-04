import express from 'express';
import Quiz from '../models/Quiz.js';
import Question from '../models/Question.js';
import LearningObjective from '../models/LearningObjective.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateMongoId, validateQuizId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

const router = express.Router();

/**
 * POST /api/export/h5p/:quizId
 * Generate H5P export
 */
router.post('/h5p/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate({
      path: 'questions',
      populate: {
        path: 'learningObjective',
        select: 'text order'
      },
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives', 'text order');

  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  if (!quiz.questions || quiz.questions.length === 0) {
    return errorResponse(res, 'Quiz must have questions before exporting', 'NO_QUESTIONS', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    // Create export file path
    const exportId = crypto.randomBytes(16).toString('hex');
    const filename = `${quiz.name.replace(/[^a-zA-Z0-9]/g, '_')}_${exportId}.h5p`;
    const filePath = path.join('./routes/create/uploads/', filename);

    // Create H5P ZIP package
    await createH5PPackage(quiz, filePath);

    // Save export record
    await quiz.addExport(filePath);

    // Get file size
    const stats = await fs.stat(filePath);
    
    return successResponse(res, {
      exportId,
      filename,
      downloadUrl: `/api/export/${exportId}/download`,
      previewUrl: `/api/export/${quizId}/preview`,
      metadata: {
        questionCount: quiz.questions.length,
        objectiveCount: quiz.learningObjectives.length,
        exportFormat: 'h5p',
        fileSize: stats.size
      }
    }, 'H5P export generated successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('H5P export error:', error);
    return errorResponse(res, 'Failed to generate H5P export', 'EXPORT_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * GET /api/export/:exportId/download
 * Download exported file
 */
router.get('/:exportId/download', authenticateToken, asyncHandler(async (req, res) => {
  const exportId = req.params.exportId;
  const userId = req.user.id;

  // Find quiz with this export
  const quiz = await Quiz.findOne({ 
    'exports.filePath': { $regex: exportId },
    createdBy: userId 
  });

  if (!quiz) {
    return notFoundResponse(res, 'Export');
  }

  const exportRecord = quiz.exports.find(exp => exp.filePath.includes(exportId));
  if (!exportRecord) {
    return notFoundResponse(res, 'Export');
  }

  try {
    // Check if file exists
    await fs.access(exportRecord.filePath);

    // Increment download count
    exportRecord.downloadCount += 1;
    await quiz.save();

    // Send file
    const filename = path.basename(exportRecord.filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/zip');
    
    // In a real implementation, you would stream the file
    const fileContent = await fs.readFile(exportRecord.filePath);
    res.send(fileContent);

  } catch (error) {
    console.error('Download error:', error);
    return notFoundResponse(res, 'Export file');
  }
}));

/**
 * GET /api/export/:quizId/preview
 * Preview quiz structure
 */
router.get('/:quizId/preview', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate({
      path: 'questions',
      populate: {
        path: 'learningObjective',
        select: 'text order'
      },
      options: { sort: { order: 1 } }
    })
    .populate('learningObjectives', 'text order')
    .populate('activePlan', 'approach distribution');

  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const preview = {
    quiz: {
      name: quiz.name,
      status: quiz.status,
      progress: quiz.progress,
      createdAt: quiz.createdAt
    },
    structure: {
      objectiveCount: quiz.learningObjectives.length,
      questionCount: quiz.questions.length,
      questionTypes: getQuestionTypeBreakdown(quiz.questions),
      difficultyDistribution: getDifficultyDistribution(quiz.questions)
    },
    objectives: quiz.learningObjectives.map(obj => ({
      text: obj.text,
      order: obj.order,
      questionCount: quiz.questions.filter(q => q.learningObjective._id.equals(obj._id)).length
    })),
    questions: quiz.questions.map(q => ({
      id: q._id,
      type: q.type,
      difficulty: q.difficulty,
      questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
      learningObjective: q.learningObjective.text,
      reviewStatus: q.reviewStatus,
      order: q.order
    })),
    exportInfo: {
      readyForExport: quiz.questions.length > 0,
      h5pCompatible: true,
      estimatedFileSize: estimateExportSize(quiz)
    }
  };

  if (quiz.activePlan) {
    preview.generationPlan = {
      approach: quiz.activePlan.approach,
      distribution: quiz.activePlan.distribution
    };
  }

  return successResponse(res, { preview }, 'Quiz preview generated successfully');
}));

/**
 * GET /api/export/:quizId/formats
 * Get available export formats
 */
router.get('/:quizId/formats', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const formats = [
    {
      name: 'H5P',
      id: 'h5p',
      description: 'Interactive content for LMS platforms like Canvas',
      supported: true,
      fileExtension: '.h5p',
      features: ['Interactive questions', 'Immediate feedback', 'Progress tracking', 'Mobile responsive']
    },
    {
      name: 'QTI',
      id: 'qti',
      description: 'Question and Test Interoperability format',
      supported: false,
      fileExtension: '.zip',
      features: ['LMS compatibility', 'Question bank import', 'Standards compliant']
    },
    {
      name: 'JSON',
      id: 'json',
      description: 'Raw quiz data in JSON format',
      supported: true,
      fileExtension: '.json',
      features: ['Developer friendly', 'Easy parsing', 'Custom integration']
    }
  ];

  return successResponse(res, { formats }, 'Export formats retrieved successfully');
}));

/**
 * DELETE /api/export/:exportId
 * Delete export file
 */
router.delete('/:exportId', authenticateToken, asyncHandler(async (req, res) => {
  const exportId = req.params.exportId;
  const userId = req.user.id;

  // Find quiz with this export
  const quiz = await Quiz.findOne({ 
    'exports.filePath': { $regex: exportId },
    createdBy: userId 
  });

  if (!quiz) {
    return notFoundResponse(res, 'Export');
  }

  const exportIndex = quiz.exports.findIndex(exp => exp.filePath.includes(exportId));
  if (exportIndex === -1) {
    return notFoundResponse(res, 'Export');
  }

  const exportRecord = quiz.exports[exportIndex];

  try {
    // Delete file
    await fs.unlink(exportRecord.filePath);
  } catch (error) {
    console.error('Error deleting export file:', error);
    // Continue to remove from database even if file deletion fails
  }

  // Remove from quiz exports
  quiz.exports.splice(exportIndex, 1);
  await quiz.save();

  return successResponse(res, null, 'Export deleted successfully');
}));

// Helper functions
async function createH5PPackage(quiz, outputPath) {
  // Ensure uploads directory exists
  const uploadsDir = path.dirname(outputPath);
  await fs.mkdir(uploadsDir, { recursive: true });

  // Create a promise to handle the zip creation
  return new Promise(async (resolve, reject) => {
    // Create output stream
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    // Handle stream events
    output.on('close', () => {
      console.log(`H5P package created: ${archive.pointer()} bytes`);
      resolve();
    });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      reject(err);
    });

    // Pipe archive data to the file
    archive.pipe(output);

    // Create h5p.json content - using QuestionSet library for quiz
    const h5pJson = {
      title: quiz.name || "Quiz Export",
      language: "en",
      mainLibrary: "H5P.QuestionSet",
      embedTypes: ["iframe"],
      license: "U",
      preloadedDependencies: [
        {
          machineName: "H5P.QuestionSet",
          majorVersion: "1",
          minorVersion: "20"
        },
        {
          machineName: "H5P.MultiChoice",
          majorVersion: "1",
          minorVersion: "16"
        },
        {
          machineName: "H5P.TrueFalse",
          majorVersion: "1",
          minorVersion: "8"
        },
        {
          machineName: "H5P.SortParagraphs",
          majorVersion: "0",
          minorVersion: "11"
        },
        {
          machineName: "H5P.DragText",
          majorVersion: "1",
          minorVersion: "10"
        },
        {
          machineName: "H5P.Blanks",
          majorVersion: "1",
          minorVersion: "14"
        },
        {
          machineName: "H5P.SingleChoiceSet",
          majorVersion: "1",
          minorVersion: "11"
        },
        {
          machineName: "H5P.Dialogcards",
          majorVersion: "1",
          minorVersion: "9"
        },
        {
          machineName: "H5P.Accordion",
          majorVersion: "1",
          minorVersion: "0"
        },
        {
          machineName: "H5P.AdvancedText",
          majorVersion: "1",
          minorVersion: "1"
        }
      ]
    };

    // Create content.json - H5P QuestionSet format
    const contentJson = generateH5PQuestionSet(quiz);

    // Add files to the archive (NO HTML files!)
    archive.append(JSON.stringify(h5pJson), { name: 'h5p.json' });
    archive.append(JSON.stringify(contentJson), { name: 'content/content.json' });

    // Finalize the archive
    archive.finalize();
  });
}

function generateH5PQuestionSet(quiz) {
  // H5P QuestionSet JSON structure
  const questionSet = {
    "introPage": {
      "showIntroPage": true,
      "title": quiz.name || "Quiz",
      "introduction": `This quiz contains ${quiz.questions.length} questions.`,
      "startButtonText": "Start Quiz"
    },
    "progressType": "dots",
    "passPercentage": 50,
    "questions": [],
    "disableBackwardsNavigation": false,
    "randomQuestions": false,
    "endGame": {
      "showResultPage": true,
      "showSolutionButton": true,
      "showRetryButton": true,
      "noResultMessage": "Finished",
      "message": "Your result:",
      "overallFeedback": [
        {
          "from": 0,
          "to": 49,
          "feedback": "You need more practice. Try again!"
        },
        {
          "from": 50,
          "to": 79,
          "feedback": "Good job! You passed the quiz."
        },
        {
          "from": 80,
          "to": 100,
          "feedback": "Excellent work! You've mastered this material."
        }
      ],
      "solutionButtonText": "Show solution",
      "retryButtonText": "Retry",
      "finishButtonText": "Finish",
      "submitButtonText": "Submit",
      "showAnimations": false,
      "successVideo": {},
      "failVideo": {}
    },
    "override": {
      "checkButton": true,
      "showSolutionButton": "on",
      "retryButton": "on"
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
      "navigationLabel": "Questions"
    }
  };

  // Convert each question to H5P format
  for (const question of quiz.questions) {
    let h5pQuestion;

    if (question.type === 'multiple-choice') {
      h5pQuestion = {
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
      h5pQuestion = {
        "library": "H5P.TrueFalse 1.8",
        "params": {
          "question": `<p>${escapeHtml(question.questionText)}</p>`,
          "correct": question.correctAnswer === 'True' || question.correctAnswer === true,
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
            "showSolutionButton": "Show solution",
            "tryAgain": "Retry",
            "wrongAnswerMessage": "Wrong answer",
            "correctAnswerMessage": "Correct answer",
            "scoreBarLabel": "You got :num out of :total points",
            "submitAnswer": "Submit"
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
          }
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "True/False Question",
          "license": "U",
          "title": "Question"
        }
      };
    } else if (question.type === 'matching') {
      // H5P DragText for matching questions
      // Convert matching pairs to drag-and-drop format
      const leftItems = question.content?.leftItems || [];
      const rightItems = question.content?.rightItems || [];
      const matchingPairs = question.content?.matchingPairs || [];
      
      // Create text with drag zones - format: "Item1 matches *correct_answer*"
      let textField = question.questionText + "\\n\\n";
      leftItems.forEach((leftItem, index) => {
        const correctMatch = matchingPairs[index] ? matchingPairs[index][1] : rightItems[index];
        textField += `${leftItem}: *${correctMatch}*\\n`;
      });
      
      // Create distractors from unused right items
      const usedRightItems = matchingPairs.map(pair => pair[1]);
      const distractors = rightItems.filter(item => !usedRightItems.includes(item));

      h5pQuestion = {
        "library": "H5P.DragText 1.10",
        "params": {
          "taskDescription": `<p>${escapeHtml(question.questionText)}</p>\\n`,
          "textField": textField,
          "checkAnswer": "Check",
          "tryAgain": "Retry", 
          "showSolution": "Show Solution",
          "behaviour": {
            "enableRetry": true,
            "enableSolutionsButton": true,
            "instantFeedback": false,
            "enableCheckButton": true
          },
          "overallFeedback": [
            {
              "from": 0,
              "to": 100,
              "feedback": "Score: @score of @total."
            }
          ],
          "media": {
            "disableImageZooming": false
          },
          "dropZoneIndex": "Drop Zone @index.",
          "empty": "Drop Zone @index is empty.",
          "contains": "Drop Zone @index contains draggable @draggable.",
          "tipLabel": "Show tip",
          "correctText": "Correct!",
          "incorrectText": "Incorrect!",
          "resetDropTitle": "Reset drop",
          "resetDropDescription": "Are you sure you want to reset this drop zone?",
          "grabbed": "Draggable is grabbed.",
          "cancelledDragging": "Cancelled dragging.",
          "correctAnswer": "Correct answer:",
          "feedbackHeader": "Feedback",
          "scoreBarLabel": "You got :num out of :total points",
          "submitAnswer": "Submit",
          "ariaDraggableIndex": "@index of @count draggables.",
          "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
          "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
          "a11yRetry": "Retry the task. Reset all responses and start the task over again.",
          "distractors": distractors.length > 0 ? distractors.map(d => `*${d}*`).join(" ") : ""
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Drag Text",
          "license": "U",
          "title": "Matching Question"
        }
      };
    } else if (question.type === 'cloze') {
      // H5P Blanks for cloze/fill-in-the-blank questions
      const textWithBlanks = question.content?.textWithBlanks || question.questionText;
      const correctAnswers = question.content?.correctAnswers || [];
      
      // Convert textWithBlanks format to H5P format
      // Replace [blank] or ____ with *answer* format
      let h5pText = textWithBlanks;
      correctAnswers.forEach((answer, index) => {
        h5pText = h5pText.replace(/\[blank\]|\_{3,}/, `*${answer}*`);
      });

      h5pQuestion = {
        "library": "H5P.Blanks 1.14",
        "params": {
          "questions": [`<p>${escapeHtml(h5pText)}</p>\\n`],
          "showSolutions": "Show solutions",
          "tryAgain": "Try again",
          "text": `<p>${escapeHtml(question.questionText.split('\\n')[0])}</p>\\n`,
          "checkAnswer": "Check",
          "notFilledOut": "Please fill in all blanks",
          "behaviour": {
            "enableSolutionsButton": true,
            "autoCheck": true,
            "caseSensitive": false,
            "showSolutionsRequiresInput": true,
            "separateLines": false,
            "enableRetry": true,
            "confirmCheckDialog": false,
            "confirmRetryDialog": false,
            "acceptSpellingErrors": false,
            "enableCheckButton": true
          },
          "answerIsCorrect": "'':ans'' is correct",
          "answerIsWrong": "'':ans'' is wrong",
          "answeredCorrectly": "Answered correctly",
          "answeredIncorrectly": "Answered incorrectly",
          "solutionLabel": "Correct answer:",
          "inputLabel": "Blank input @num of @total",
          "inputHasTipLabel": "Tip available",
          "tipLabel": "Tip",
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
          "media": {
            "disableImageZooming": true
          },
          "overallFeedback": [
            {
              "from": 0,
              "to": 100,
              "feedback": "You got @score of @total blanks correct."
            }
          ],
          "scoreBarLabel": "You got :num out of :total points",
          "submitAnswer": "Submit",
          "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
          "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
          "a11yRetry": "Retry the task. Reset all responses and start the task over again.",
          "a11yCheckingModeHeader": "Checking mode"
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Fill in the Blanks",
          "license": "U",
          "title": "Cloze Question"
        }
      };
    } else if (question.type === 'flashcard') {
      // H5P Dialog Cards for flashcard questions
      const front = question.content?.front || question.questionText;
      const back = question.content?.back || question.correctAnswer;
      
      h5pQuestion = {
        "library": "H5P.Dialogcards 1.9",
        "params": {
          "title": `<p>Flashcard</p>\\n`,
          "description": `<p>Study these cards to learn the material.</p>\\n`,
          "dialogs": [
            {
              "text": `<p style="text-align: center;">${escapeHtml(front)}</p>`,
              "answer": `<p style="text-align: center;">${escapeHtml(back)}</p>`,
              "tips": {},
              "audio": [],
              "image": null,
              "imageAltText": ""
            }
          ],
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
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Dialog Cards",
          "license": "U",
          "title": "Flashcard"
        }
      };
    } else if (question.type === 'summary') {
      // H5P Accordion for summary questions - expandable content sections
      const summaryPanels = question.content?.panels || [
        {
          title: "Summary",
          content: question.questionText
        }
      ];

      h5pQuestion = {
        "library": "H5P.Accordion 1.0",
        "params": {
          "panels": summaryPanels.map(panel => ({
            "content": {
              "params": {
                "text": `<p>${escapeHtml(panel.content)}</p>\\n`
              },
              "library": "H5P.AdvancedText 1.1",
              "subContentId": crypto.randomBytes(16).toString('hex'),
              "metadata": {
                "contentType": "Text",
                "license": "U",
                "title": "Summary Content"
              }
            },
            "title": panel.title || "Summary"
          })),
          "hTag": "h2"
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Accordion",
          "license": "U",
          "title": "Summary"
        }
      };
    } else if (question.type === 'discussion') {
      // H5P Advanced Text for discussion questions - display only
      h5pQuestion = {
        "library": "H5P.AdvancedText 1.1",
        "params": {
          "text": `<h3>Discussion Question</h3>\\n<p>${escapeHtml(question.questionText)}</p>\\n<p><em>Discuss this question with your classmates or instructor.</em></p>\\n`
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Text",
          "license": "U",
          "title": "Discussion Question"
        }
      };
    } else if (question.type === 'single-choice-set') {
      // H5P SingleChoiceSet for rapid-fire single choice questions
      const options = question.content?.options || [];
      const correctOption = options.find(opt => opt.isCorrect);
      
      h5pQuestion = {
        "library": "H5P.SingleChoiceSet 1.11",
        "params": {
          "choices": [
            {
              "answers": options.map(opt => opt.text),
              "question": question.questionText,
              "subContentId": crypto.randomBytes(8).toString('hex')
            }
          ],
          "behaviour": {
            "timeoutCorrect": 1000,
            "timeoutWrong": 1000,
            "soundEffectsEnabled": true,
            "enableRetry": true,
            "enableSolutionsButton": true,
            "passPercentage": 100,
            "autoContinue": true
          },
          "l10n": {
            "showSolutionButtonLabel": "Show solution",
            "retryButtonLabel": "Retry",
            "solutionViewTitle": "Solution",
            "correctText": "Correct!",
            "incorrectText": "Incorrect!",
            "muteButtonLabel": "Mute feedback sound",
            "closeButtonLabel": "Close",
            "slideOfTotal": "Slide :num of :total",
            "nextButtonLabel": "Next question",
            "scoreBarLabel": "You got :num out of :total points",
            "solutionListQuestionNumber": "Question :num",
            "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
            "a11yRetry": "Retry the task. Reset all responses and start the task over again.",
            "shouldSelect": "Should have been selected",
            "shouldNotSelect": "Should not have been selected"
          },
          "overallFeedback": [
            {
              "from": 0,
              "to": 100,
              "feedback": "You got :numcorrect of :maxscore correct"
            }
          ]
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Single Choice Set",
          "license": "U",
          "title": "Single Choice Question"
        }
      };
    } else if (question.type === 'ordering') {
      // H5P Sort Paragraphs for ordering questions
      h5pQuestion = {
        "library": "H5P.SortParagraphs 0.11",
        "params": {
          "taskDescription": `<p>${escapeHtml(question.questionText)}</p>\n`,
          "paragraphs": question.content?.items?.map(item => `<p>${escapeHtml(item)}</p>\n`) || [],
          "overallFeedback": [
            {
              "from": 0,
              "to": 100
            }
          ],
          "behaviour": {
            "scoringMode": "transitions",
            "applyPenalties": true,
            "duplicatesInterchangeable": true,
            "enableRetry": true,
            "enableSolutionsButton": true,
            "addButtonsForMovement": true
          },
          "l10n": {
            "checkAnswer": "Check",
            "tryAgain": "Retry",
            "showSolution": "Show solution",
            "up": "Up",
            "down": "Down",
            "disabled": "Disabled"
          },
          "a11y": {
            "check": "Check the answers. The responses will be marked as correct or incorrect.",
            "showSolution": "Show the solution. The correct solution will be displayed.",
            "retry": "Retry the task. Reset all elements and start the task over again.",
            "yourResult": "You got @score out of @total points",
            "paragraph": "Paragraph",
            "correct": "correct",
            "wrong": "wrong",
            "point": "@score point",
            "sevenOfNine": "@current of @total",
            "currentPosition": "Current position in list",
            "instructionsSelected": "Press spacebar to reorder",
            "instructionsGrabbed": "Press up and down arrow keys to change position, spacebar to drop, escape to cancel",
            "grabbed": "Grabbed",
            "moved": "Moved",
            "dropped": "Dropped",
            "reorderCancelled": "Reorder cancelled",
            "finalPosition": "Final position",
            "nextParagraph": "Next paragraph",
            "correctParagraph": "Correct paragraph at position",
            "listDescription": "Sortable list of paragraphs.",
            "listDescriptionCheckAnswer": "List of paragraphs with results.",
            "listDescriptionShowSolution": "List of paragraphs with solutions."
          }
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Sort the Paragraphs",
          "license": "U",
          "title": "Ordering Question"
        }
      };
    } else {
      // Default to multiple choice for other types
      h5pQuestion = {
        "library": "H5P.MultiChoice 1.16",
        "params": {
          "question": `<p>${escapeHtml(question.questionText)}</p>`,
          "answers": [
            {
              "correct": true,
              "text": `<div>${escapeHtml(question.correctAnswer || 'Answer')}</div>\n`,
              "tipsAndFeedback": {
                "tip": "",
                "chosenFeedback": "Correct!",
                "notChosenFeedback": ""
              }
            }
          ],
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
          }
        },
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Multiple Choice",
          "license": "U",
          "title": "Question"
        }
      };
    }

    questionSet.questions.push(h5pQuestion);
  }

  return questionSet;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function generateH5PContent(quiz) {
  const h5pStructure = {
    title: quiz.name,
    language: 'en',
    introduction: `Quiz: ${quiz.name}`,
    questions: [],
    settings: {
      enableRetry: true,
      enableSolutionsButton: true,
      enableCheckButton: true,
      showScorePoints: true,
      progressType: 'dots',
      passPercentage: 70
    },
    metadata: {
      generatedBy: 'TLEF-CREATE',
      createdAt: new Date().toISOString(),
      questionCount: quiz.questions.length,
      objectiveCount: quiz.learningObjectives.length
    }
  };

  for (const question of quiz.questions) {
    const h5pQuestion = convertQuestionToH5P(question);
    h5pStructure.questions.push(h5pQuestion);
  }

  return h5pStructure;
}

function convertQuestionToH5P(question) {
  const baseQuestion = {
    type: question.type,
    text: question.questionText,
    feedback: question.explanation || 'Good job!'
  };

  switch (question.type) {
    case 'multiple-choice':
      return {
        ...baseQuestion,
        library: 'H5P.MultiChoice 1.16',
        answers: question.content.options?.map(option => ({
          text: option.text,
          correct: option.isCorrect,
          tipsAndFeedback: {
            tip: '',
            chosenFeedback: option.isCorrect ? 'Correct!' : 'Try again.',
            notChosenFeedback: ''
          }
        })) || []
      };

    case 'true-false':
      return {
        ...baseQuestion,
        library: 'H5P.TrueFalse 1.8',
        correct: question.correctAnswer === 'True' ? 'true' : 'false'
      };

    default:
      return {
        ...baseQuestion,
        library: 'H5P.Essay 1.5',
        placeholder: 'Enter your answer here...'
      };
  }
}

function getQuestionTypeBreakdown(questions) {
  const breakdown = {};
  questions.forEach(q => {
    breakdown[q.type] = (breakdown[q.type] || 0) + 1;
  });
  return breakdown;
}

function getDifficultyDistribution(questions) {
  const distribution = {};
  questions.forEach(q => {
    distribution[q.difficulty] = (distribution[q.difficulty] || 0) + 1;
  });
  return distribution;
}

function estimateExportSize(quiz) {
  const baseSize = 1024; // Base H5P structure
  const questionSize = 512; // Average per question
  const estimated = baseSize + (quiz.questions.length * questionSize);
  
  if (estimated < 1024) return `${estimated} bytes`;
  if (estimated < 1024 * 1024) return `${Math.round(estimated / 1024)} KB`;
  return `${Math.round(estimated / (1024 * 1024))} MB`;
}

export default router;