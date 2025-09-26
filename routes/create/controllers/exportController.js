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
    // === DEBUG LOGGING: Database Questions ===
    console.log('\n=== DATABASE QUESTIONS DEBUG ===');
    console.log(`Quiz ID: ${quiz._id}`);
    console.log(`Quiz Name: ${quiz.name}`);
    console.log(`Total Questions in DB: ${quiz.questions.length}`);
    
    quiz.questions.forEach((question, index) => {
      console.log(`\n--- Question ${index + 1} (DB) ---`);
      console.log(`ID: ${question._id}`);
      console.log(`Type: ${question.type}`);
      console.log(`Question Text: ${question.questionText}`);
      console.log(`Content:`, JSON.stringify(question.content, null, 2));
      console.log(`Correct Answer: ${question.correctAnswer}`);
      console.log(`Order: ${question.order}`);
      console.log(`Review Status: ${question.reviewStatus}`);
    });
    
    // Create export file path
    const exportId = crypto.randomBytes(16).toString('hex');
    const filename = `${quiz.name.replace(/[^a-zA-Z0-9]/g, '_')}_${exportId}.h5p`;
    const uploadsDir = path.join('./routes/create/uploads/');
    const filePath = path.join(uploadsDir, filename);
    
    // Ensure uploads directory exists
    await fs.mkdir(uploadsDir, { recursive: true });

    // Create H5P ZIP package
    await createH5PPackage(quiz, filePath);

    // Save export record (add to quiz exports if schema supports it)
    if (quiz.addExport) {
      await quiz.addExport(filePath);
    } else {
      // Alternative: just log the export for now
      console.log(`Export created for quiz ${quiz._id}: ${filePath}`);
    }

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

    // Determine if we need Column or can use simpler format
    const flashcardQuestions = quiz.questions.filter(q => q.type === 'flashcard');
    const nonFlashcardQuestions = quiz.questions.filter(q => q.type !== 'flashcard');
    const hasMixedContent = flashcardQuestions.length > 0 && nonFlashcardQuestions.length > 0;
    const isFlashcardOnly = flashcardQuestions.length > 0 && nonFlashcardQuestions.length === 0;
    
    // Create h5p.json content - use Column for all page-only exports (per user request)
    let h5pJson;
    if (hasMixedContent || !isFlashcardOnly) {
      // Use Column for mixed content types with complete website dependencies
      h5pJson = {
        title: quiz.name || "Quiz Export",
        language: "en",
        mainLibrary: "H5P.Column",
        embedTypes: ["div"],
        license: "U",
        defaultLanguage: "en",
        preloadedDependencies: [
          {
            machineName: "FontAwesome",
            majorVersion: 4,
            minorVersion: 5
          },
          {
            machineName: "H5P.FontIcons",
            majorVersion: 1,
            minorVersion: 0
          },
          {
            machineName: "H5P.Transition",
            majorVersion: 1,
            minorVersion: 0
          },
          {
            machineName: "H5P.JoubelUI",
            majorVersion: 1,
            minorVersion: 3
          },
          {
            machineName: "H5P.Audio",
            majorVersion: 1,
            minorVersion: 5
          },
          {
            machineName: "H5P.Dialogcards",
            majorVersion: 1,
            minorVersion: 9
          },
          {
            machineName: "H5P.RowColumn",
            majorVersion: 1,
            minorVersion: 0
          },
          {
            machineName: "H5P.Row",
            majorVersion: 1,
            minorVersion: 0
          },
          {
            machineName: "H5P.Question",
            majorVersion: 1,
            minorVersion: 5
          },
          {
            machineName: "H5P.MultiChoice",
            majorVersion: 1,
            minorVersion: 16
          },
          {
            machineName: "H5P.TrueFalse",
            majorVersion: 1,
            minorVersion: 8
          },
          {
            machineName: "H5P.SortParagraphs",
            majorVersion: 0,
            minorVersion: 11
          },
          {
            machineName: "jQuery.ui",
            majorVersion: 1,
            minorVersion: 10
          },
          {
            machineName: "H5P.DragText",
            majorVersion: 1,
            minorVersion: 10
          },
          {
            machineName: "H5P.Blanks",
            majorVersion: 1,
            minorVersion: 14
          },
          {
            machineName: "H5P.SingleChoiceSet",
            majorVersion: 1,
            minorVersion: 11
          },
          {
            machineName: "H5P.Accordion",
            majorVersion: 1,
            minorVersion: 0
          },
          {
            machineName: "H5P.AdvancedText",
            majorVersion: 1,
            minorVersion: 1
          },
          {
            machineName: "H5P.Video",
            majorVersion: 1,
            minorVersion: 6
          },
          {
            machineName: "H5P.QuestionSet",
            majorVersion: 1,
            minorVersion: 20
          },
          {
            machineName: "H5P.Column",
            majorVersion: 1,
            minorVersion: 18
          }
        ]
      };
    } else if (isFlashcardOnly) {
      // Use Dialog Cards for flashcard-only quizzes
      h5pJson = {
        title: quiz.name || "Quiz Export",
        language: "en",
        mainLibrary: "H5P.Dialogcards",
        embedTypes: ["iframe"],
        license: "U",
        preloadedDependencies: [
          {
            machineName: "H5P.Dialogcards",
            majorVersion: "1",
            minorVersion: "9"
          }
        ]
      };
    } else {
      // Use QuestionSet for non-flashcard quizzes
      h5pJson = {
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
    }

    // Create content.json using page structure for all question types (no QuestionSet)
    const contentJson = generateH5PColumn(quiz, flashcardQuestions, nonFlashcardQuestions);

    // === DEBUG LOGGING: H5P Export Content ===
    console.log('\n=== H5P EXPORT CONTENT DEBUG ===');
    console.log(`Flashcard Questions: ${flashcardQuestions.length}`);
    console.log(`Non-Flashcard Questions: ${nonFlashcardQuestions.length}`);
    console.log(`Total Content Sections: ${contentJson.content?.length || 0}`);
    
    if (contentJson.content) {
      contentJson.content.forEach((section, index) => {
        console.log(`\n--- H5P Section ${index + 1} ---`);
        console.log(`Library: ${section.content?.library || 'Unknown'}`);
        
        // If it's a Row with RowColumn content
        if (section.content?.library === 'H5P.Row 1.0') {
          const rowColumn = section.content.params?.columns?.[0]?.content;
          if (rowColumn?.library === 'H5P.RowColumn 1.0') {
            const content = rowColumn.params?.content?.[0];
            if (content) {
              console.log(`Question Type: ${content.library || 'Unknown'}`);
              console.log(`Question Text: ${content.params?.question || content.params?.taskDescription || 'No text'}`);
              
              // Log specific content based on type
              if (content.library?.includes('MultiChoice')) {
                console.log(`Options: ${content.params?.answers?.length || 0}`);
              } else if (content.library?.includes('TrueFalse')) {
                console.log(`Correct Answer: ${content.params?.correct}`);
              } else if (content.library?.includes('DragText')) {
                console.log(`Text Field: ${content.params?.textField?.substring(0, 100)}...`);
              } else if (content.library?.includes('Blanks')) {
                console.log(`Questions: ${content.params?.questions?.length || 0}`);
              }
            }
          }
        }
        
        // If it's Dialogcards
        if (section.content?.library === 'H5P.Row 1.0') {
          const dialogCards = section.content.params?.columns?.[0]?.content?.params?.content?.[0];
          if (dialogCards?.library?.includes('Dialogcards')) {
            console.log(`Dialog Cards: ${dialogCards.params?.dialogs?.length || 0}`);
          }
        }
      });
    }
    
    console.log('\n=== H5P JSON STRUCTURE ===');
    console.log(JSON.stringify(contentJson, null, 2));

    // Add files to the archive
    archive.append(JSON.stringify(h5pJson), { name: 'h5p.json' });
    archive.append(JSON.stringify(contentJson), { name: 'content/content.json' });

    // Add H5P library files from our cached library directory
    const libraryPath = path.join('./routes/create/h5p-libs/');
    try {
      // Check if libraries exist
      await fs.access(libraryPath);
      
      // Add all library directories and files
      archive.directory(libraryPath, false, (entry) => {
        // Skip the content directory and h5p.json from the library cache
        if (entry.name === 'content' || entry.name === 'h5p.json') {
          return false;
        }
        return entry;
      });
      
      console.log('Added H5P library files from cache');
    } catch (error) {
      console.warn('H5P library files not found, creating minimal export:', error.message);
    }

    // Finalize the archive
    archive.finalize();
  });
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

// Generate H5P Column content using hybrid approach: Dialogcards + QuestionSet + Individual questions
function generateH5PColumn(quiz, flashcardQuestions, nonFlashcardQuestions) {
  const columnContent = [];
  
  // Treat ALL non-flashcard questions as individual rows (no QuestionSet)
  const individualQuestions = nonFlashcardQuestions;
  
  // Add flashcards as Dialog Cards wrapped in Row/RowColumn (First Row)
  if (flashcardQuestions.length > 0) {
    const flashcardDialogs = flashcardQuestions.map(question => {
      const front = question.content?.front || question.questionText || "Front of card";
      const back = question.content?.back || question.correctAnswer || "Back of card";
      
      // Use simple text escaping, avoid HTML entities
      const escapedFront = front.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const escapedBack = back.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      return {
        "text": `<p style="text-align:center;">${escapedFront}</p>`,
        "answer": `<p style="text-align:center;">${escapedBack}</p>`,
        "tips": {},
        "imageAltText": ""
      };
    });
    
    // Wrap Dialog Cards in Row/RowColumn structure
    columnContent.push({
      "content": {
        "params": {
          "columns": [
            {
              "width": 100,
              "content": {
                "params": {
                  "content": [
                    {
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
                    }
                  ]
                },
                "library": "H5P.RowColumn 1.0",
                "subContentId": crypto.randomBytes(16).toString('hex'),
                "metadata": {
                  "contentType": "Column",
                  "license": "U",
                  "title": "Untitled Column"
                }
              }
            }
          ]
        },
        "library": "H5P.Row 1.0",
        "subContentId": crypto.randomBytes(16).toString('hex'),
        "metadata": {
          "contentType": "Row",
          "license": "U",
          "title": "Untitled Row"
        }
      }
    });
  }
  
  // Add all other questions as individual rows
  individualQuestions.forEach(question => {
    const h5pQuestion = convertQuestionToH5PRowColumn(question, quiz);
    if (h5pQuestion) {
      columnContent.push(h5pQuestion);
    }
  });
  
  return {
    "content": columnContent
  };
}

// Generate H5P QuestionSet content for supported question types
function generateH5PQuestionSet(questions) {
  const questionSetQuestions = questions.map(question => {
    let h5pQuestion;
    
    if (question.type === 'multiple-choice') {
      h5pQuestion = {
        "params": {
          "media": {
            "disableImageZooming": false
          },
          "answers": question.content?.options?.map(option => ({
            "correct": option.isCorrect || false,
            "text": `<div>${escapeHtml(option.text)}</div>`,
            "tipsAndFeedback": {}
          })) || [],
          "overallFeedback": [
            {
              "from": 0,
              "to": 100
            }
          ],
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
          "media": {
            "disableImageZooming": false
          },
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
      
      let h5pText = textWithBlanks;
      correctAnswers.forEach((answer, index) => {
        h5pText = h5pText.replace(/\_{3,}/, `*${escapeHtml(answer)}*`);
      });

      h5pQuestion = {
        "params": {
          "media": {
            "disableImageZooming": false
          },
          "taskDescription": `<p>${escapeHtml(question.questionText.split('\\n')[0])}</p>`,
          "overallFeedback": [
            {
              "from": 0,
              "to": 100
            }
          ],
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
          "questions": [`<p>${escapeHtml(h5pText)}</p>`]
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
      // Convert ordering to H5P DragText format
      const items = question.content?.items || ['Item 1', 'Item 2', 'Item 3'];
      const correctOrder = question.content?.correctOrder || items;
      
      // Create text field with numbered blanks for ordering
      let textField = "";
      correctOrder.forEach((item, index) => {
        textField += `*${index + 1}*. ${escapeHtml(item)}\\n`;
      });
      
      const distractorNumbers = Array.from({length: items.length}, (_, i) => i + 1).map(String);

      h5pQuestion = {
        "params": {
          "media": {
            "disableImageZooming": false
          },
          "taskDescription": `<p>${escapeHtml(question.questionText)}</p>`,
          "textField": textField.replace(/\\n/g, '\n'),
          "overallFeedback": [
            {
              "from": 0,
              "to": 100
            }
          ],
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
      "overallFeedback": [
        {
          "from": 0,
          "to": 100
        }
      ],
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

// Generate H5P Dialog Cards content for flashcard-only quizzes
function generateH5PDialogCards(flashcardQuestions) {
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

// Convert individual question to H5P format wrapped in Row/RowColumn 
function convertQuestionToH5PRowColumn(question, quiz) {
  const baseQuestion = convertQuestionToH5P(question, quiz);
  if (!baseQuestion) return null;
  
  // Wrap in Row/RowColumn structure like website
  return {
    "content": {
      "params": {
        "columns": [
          {
            "width": 100,
            "content": {
              "params": {
                "content": [baseQuestion]
              },
              "library": "H5P.RowColumn 1.0",
              "subContentId": crypto.randomBytes(16).toString('hex'),
              "metadata": {
                "contentType": "Column",
                "license": "U", 
                "title": "Untitled Column"
              }
            }
          }
        ]
      },
      "library": "H5P.Row 1.0",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Row",
        "license": "U",
        "title": "Untitled Row"
      }
    }
  };
}

// Convert individual question to H5P format
function convertQuestionToH5P(question, quiz) {
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
        "media": {
          "disableImageZooming": false
        },
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
    // Use H5P.DragText for matching questions
    const leftItems = question.content?.leftItems || [];
    const rightItems = question.content?.rightItems || [];
    const matchingPairs = question.content?.matchingPairs || [];
    
    // Create text field with drag markers - simpler format like working example
    let textField = "";
    leftItems.forEach((leftItem, index) => {
      const correctMatch = matchingPairs.find(pair => pair[0] === leftItem)?.[1] || rightItems[index] || rightItems[0];
      textField += `${index + 1}. ${escapeHtml(correctMatch)} = *${escapeHtml(leftItem)}*\n`;
    });
    
    // Add distractors - should be unused leftItems (terms that can be dragged)
    const usedLeftItems = matchingPairs.map(pair => pair[0]);
    const distractors = leftItems.filter(item => !usedLeftItems.includes(item));
    const distractorText = distractors.length > 0 ? distractors.map(d => escapeHtml(d)).join(" ") : "";
    
    return {
      "params": {
        "media": {
          "disableImageZooming": false
        },
        "taskDescription": `<p>${escapeHtml(question.questionText || 'Drag the words into the correct boxes')}</p>`,
        "overallFeedback": [
          {
            "from": 0,
            "to": 100
          }
        ],
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
    // Convert ordering to H5P DragText format
    const items = question.content?.items || ['Item 1', 'Item 2', 'Item 3'];
    const correctOrder = question.content?.correctOrder || items;
    
    // Create text field with numbered blanks for ordering
    let textField = "";
    correctOrder.forEach((item, index) => {
      textField += `*${index + 1}*. ${escapeHtml(item)}\\n`;
    });
    
    const distractorNumbers = Array.from({length: items.length}, (_, i) => i + 1).map(String);

    return {
      "params": {
        "media": {
          "disableImageZooming": false
        },
        "taskDescription": `<p>${escapeHtml(question.questionText)}</p>`,
        "textField": textField.replace(/\\n/g, '\n'),
        "overallFeedback": [
          {
            "from": 0,
            "to": 100
          }
        ],
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
    
    let h5pText = textWithBlanks;
    correctAnswers.forEach((answer, index) => {
      h5pText = h5pText.replace(/\_{3,}/, `*${escapeHtml(answer)}*`);
    });

    return {
      "params": {
        "media": {
          "disableImageZooming": false
        },
        "taskDescription": `<p>${escapeHtml(question.questionText.split('\\n')[0])}</p>`,
        "overallFeedback": [
          {
            "from": 0,
            "to": 100
          }
        ],
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
        "questions": [`<p>${escapeHtml(h5pText)}</p>`]
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
    // Use H5P.AdvancedText for discussion questions - display only, no interaction needed
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
    // Use H5P.Accordion for summary questions with AI-generated key points
    const panels = [];

    // Check if we have AI-generated keyPoints, otherwise fallback to learning objectives
    if (question.content?.keyPoints && question.content.keyPoints.length > 0) {
      // Use the new keyPoints structure generated by LLM
      question.content.keyPoints.forEach((keyPoint, index) => {
        const bulletContent = `
          <div style="padding: 10px;">
            <h4 style="color: #2563eb; margin-bottom: 8px;">${escapeHtml(keyPoint.title)}</h4>
            <p style="line-height: 1.5; margin: 0;">${escapeHtml(keyPoint.explanation)}</p>
          </div>
        `;

        panels.push({
          "content": {
            "params": {
              "text": bulletContent
            },
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
      // Fallback to learning objectives if keyPoints not available
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
              "params": {
                "text": bulletContent
              },
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
        // Fallback if no learning objectives are available
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
  
  // Add other question types as needed
  return null;
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