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
    const containerMode = quiz.containerMode || 'column';
    const flashcardQuestions = quiz.questions.filter(q => q.type === 'flashcard');
    const nonFlashcardQuestions = quiz.questions.filter(q => q.type !== 'flashcard');
    const hasMixedContent = flashcardQuestions.length > 0 && nonFlashcardQuestions.length > 0;
    const isFlashcardOnly = flashcardQuestions.length > 0 && nonFlashcardQuestions.length === 0;

    // Determine needed libraries
    const questionTypes = new Set(quiz.questions.map(q => q.type));
    const neededLibNames = getNeededLibraries(questionTypes, { hasMixedContent, isFlashcardOnly });

    // Add container-specific libs to the seed set
    if (containerMode === 'question-set') {
      neededLibNames.add('H5P.QuestionSet');
      neededLibNames.add('H5P.Column');
    } else if (containerMode === 'interactive-book') {
      neededLibNames.add('H5P.InteractiveBook');
      neededLibNames.add('H5P.QuestionSet');
      neededLibNames.add('H5P.Column');
    }

    // Recursively resolve ALL transitive dependencies by reading library.json files
    const libraryPath = options.libraryPath || path.join('./routes/create/h5p-libs/');
    const allLibs = new Map(); // key: "machineName-major.minor" → { machineName, majorVersion, minorVersion, dirName }
    const queue = [];

    // Seed with first-level libs
    for (const libName of neededLibNames) {
      const lib = LIBRARY_REGISTRY[libName];
      if (lib) {
        queue.push({ machineName: libName, majorVersion: lib.majorVersion, minorVersion: lib.minorVersion, dirName: lib.dirName });
      }
    }

    // BFS to discover all transitive dependencies
    while (queue.length > 0) {
      const dep = queue.shift();
      const key = `${dep.machineName}-${dep.majorVersion}.${dep.minorVersion}`;
      if (allLibs.has(key)) continue;

      // Find dirName — use dep.dirName if provided, otherwise construct from key.
      // Don't use LIBRARY_REGISTRY here because it may have a different version
      // (e.g., registry has Question 1.5 but this dep is Question 1.4).
      const dirName = dep.dirName || key;
      allLibs.set(key, { machineName: dep.machineName, majorVersion: dep.majorVersion, minorVersion: dep.minorVersion, dirName });

      // Read library.json for sub-dependencies (both runtime and editor)
      const libJsonPath = path.join(libraryPath, dirName, 'library.json');
      try {
        const libJson = JSON.parse(await fs.readFile(libJsonPath, 'utf-8'));
        const allDeps = [
          ...(libJson.preloadedDependencies || []),
          ...(libJson.editorDependencies || [])
        ];
        for (const subDep of allDeps) {
          const subKey = `${subDep.machineName}-${subDep.majorVersion}.${subDep.minorVersion}`;
          if (!allLibs.has(subKey)) {
            queue.push({ machineName: subDep.machineName, majorVersion: subDep.majorVersion, minorVersion: subDep.minorVersion });
          }
        }
      } catch {
        // library.json not found, skip sub-deps
      }
    }

    // Build preloadedDependencies from first-level needed libs only.
    // Transitive dependencies (discovered by BFS) are packaged as directories
    // but NOT listed in preloadedDependencies — this matches official H5P behavior.
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
    // Also add any sub-version deps found by BFS (e.g. H5P.Question 1.4 when we already have 1.5)
    for (const [key, lib] of allLibs) {
      const alreadyListed = preloadedDependencies.some(d =>
        d.machineName === lib.machineName && d.majorVersion === lib.majorVersion && d.minorVersion === lib.minorVersion
      );
      // Add editor deps to preloadedDependencies (they appear in real H5P files)
      if (!alreadyListed && lib.machineName.startsWith('H5PEditor')) {
        preloadedDependencies.push({
          machineName: lib.machineName,
          majorVersion: lib.majorVersion,
          minorVersion: lib.minorVersion
        });
      }
      // Add alternate versions of already-listed libs (e.g. Question 1.4 when 1.5 is listed)
      if (!alreadyListed && !lib.machineName.startsWith('H5PEditor')) {
        const hasOtherVersion = preloadedDependencies.some(d => d.machineName === lib.machineName);
        if (hasOtherVersion) {
          preloadedDependencies.push({
            machineName: lib.machineName,
            majorVersion: lib.majorVersion,
            minorVersion: lib.minorVersion
          });
        }
      }
    }

    // Determine if we can export as a single standalone content type (no Column wrapper).
    // This produces files identical to official H5P exports, maximizing compatibility.
    const uniqueNonFlashcardTypes = new Set(nonFlashcardQuestions.map(q => q.type));
    // Types that should be exported standalone (without Column wrapper)
    const standaloneTypes = new Set(['sort-paragraphs', 'mark-the-words', 'essay', 'arithmetic-quiz', 'crossword', 'branching-scenario', 'documentation-tool']);
    const singleType = uniqueNonFlashcardTypes.size === 1 ? [...uniqueNonFlashcardTypes][0] : null;
    const isSingleType = !hasMixedContent && singleType && standaloneTypes.has(singleType) && flashcardQuestions.length === 0;

    let h5pJson;
    let contentJson;

    if (containerMode === 'question-set') {
      // ── Question Set export ──────────────────────────────────────────────────
      const embeddableQuestions = quiz.questions.filter(q => !STANDALONE_TYPES.has(q.type));
      const standaloneQuestions = quiz.questions.filter(q => STANDALONE_TYPES.has(q.type));
      if (standaloneQuestions.length > 0) {
        console.warn(`[QS export] Skipping ${standaloneQuestions.length} standalone question(s) (branching-scenario, documentation-tool)`);
      }
      contentJson = generateH5PQuestionSet(embeddableQuestions);
      h5pJson = {
        title: quiz.name || 'Quiz Export',
        language: 'en',
        mainLibrary: 'H5P.QuestionSet',
        embedTypes: ['iframe'],
        license: 'U',
        defaultLanguage: 'en',
        preloadedDependencies
      };

    } else if (containerMode === 'interactive-book') {
      // ── Interactive Book export ──────────────────────────────────────────────
      const standaloneInIB = quiz.questions.filter(q => STANDALONE_TYPES.has(q.type));
      if (standaloneInIB.length > 0) {
        console.warn(`[IB export] ${standaloneInIB.length} standalone question(s) cannot be embedded in Interactive Book and will be skipped.`);
      }

      // Use saved chapter structure, or auto-generate one chapter with all embeddable questions
      let chapters = quiz.chapters && quiz.chapters.length > 0 ? quiz.chapters : [];
      if (chapters.length === 0) {
        const allEmbeddable = quiz.questions.filter(q => !STANDALONE_TYPES.has(q.type));
        chapters = [{ title: 'Chapter 1', questionIds: allEmbeddable.map(q => q._id), containerType: 'column', passPercentage: 50 }];
      }

      contentJson = buildInteractiveBookContent(chapters, quiz.questions, quiz);
      h5pJson = {
        title: quiz.name || 'Interactive Book',
        language: 'en',
        mainLibrary: 'H5P.InteractiveBook',
        embedTypes: ['div'],
        license: 'U',
        defaultLanguage: 'en',
        preloadedDependencies
      };

    } else if (isSingleType) {
      // Single content type — export directly without Column wrapper
      const singleQuestion = nonFlashcardQuestions[0];
      const h5pContent = convertQuestionToH5P(singleQuestion, quiz);

      if (h5pContent) {
        const libString = h5pContent.library || '';
        const libParts = libString.split(' ');
        const mainLibName = libParts[0] || 'H5P.Column';

        // For standalone export, build preloadedDependencies from ALL BFS-discovered libs
        // (including transitive deps like Drop, Tether, AdvancedText, Question 1.4)
        // but exclude platform libs (Column, jQuery.ui), editor libs, and duplicate Question versions
        const skipMachineNames = new Set(['H5P.Column', 'jQuery.ui']);
        // If multiple Question versions exist, skip the primary (registry) version
        const qVersions = [...allLibs.keys()].filter(k => k.startsWith('H5P.Question-'));
        if (qVersions.length > 1) {
          const primaryQKey = `H5P.Question-${LIBRARY_REGISTRY['H5P.Question']?.majorVersion}.${LIBRARY_REGISTRY['H5P.Question']?.minorVersion}`;
          skipMachineNames.add(primaryQKey);
        }
        const filteredDeps = [];
        const seen = new Set();
        for (const [key, lib] of allLibs) {
          if (skipMachineNames.has(lib.machineName)) continue;
          if (skipMachineNames.has(key)) continue;
          if (lib.machineName.startsWith('H5PEditor')) continue;
          const dedupKey = `${lib.machineName}-${lib.majorVersion}.${lib.minorVersion}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          filteredDeps.push({
            machineName: lib.machineName,
            majorVersion: String(lib.majorVersion),
            minorVersion: String(lib.minorVersion)
          });
        }

        h5pJson = {
          title: quiz.name || "Quiz Export",
          language: "en",
          mainLibrary: mainLibName,
          embedTypes: ["div"],
          license: "U",
          defaultLanguage: "en",
          preloadedDependencies: filteredDeps
        };

        // Content is the params directly (not wrapped in Column)
        contentJson = h5pContent.params || {};
      } else {
        // Fallback to Column
        h5pJson = {
          title: quiz.name || "Quiz Export",
          language: "en",
          mainLibrary: "H5P.Column",
          embedTypes: ["div"],
          license: "U",
          defaultLanguage: "en",
          preloadedDependencies
        };
        contentJson = generateH5PColumn(quiz, flashcardQuestions, nonFlashcardQuestions);
      }
    } else if (isFlashcardOnly) {
      h5pJson = {
        title: quiz.name || "Quiz Export",
        language: "en",
        mainLibrary: "H5P.Dialogcards",
        embedTypes: ["iframe"],
        license: "U",
        preloadedDependencies
      };
      contentJson = generateH5PColumn(quiz, flashcardQuestions, nonFlashcardQuestions);
    } else {
      // Multiple types or mixed — use Column wrapper
      h5pJson = {
        title: quiz.name || "Quiz Export",
        language: "en",
        mainLibrary: "H5P.Column",
        embedTypes: ["div"],
        license: "U",
        defaultLanguage: "en",
        preloadedDependencies
      };
      contentJson = generateH5PColumn(quiz, flashcardQuestions, nonFlashcardQuestions);
    }

    // Add files to archive
    archive.append(JSON.stringify(h5pJson), { name: 'h5p.json' });
    archive.append(JSON.stringify(contentJson), { name: 'content/content.json' });

    // Add library directories to archive.
    // Standard H5P platform libraries (Column, jQuery.ui) are expected to already
    // exist on the target platform, so we don't package their directories.
    // Libraries listed in preloadedDependencies where the platform should already
    // have that exact version are also skipped.
    // In IB/QS mode, Column must be bundled since it's content-level, not platform-level
    const skipDirLibs = new Set(containerMode === 'column' ? ['H5P.Column', 'jQuery.ui'] : ['jQuery.ui']);
    // Also skip packaging the "primary" version of Question if a secondary version exists
    // (e.g., skip Question 1.5 dir if Question 1.4 is also in allLibs as transitive dep)
    const questionVersions = [...allLibs.keys()].filter(k => k.startsWith('H5P.Question-'));
    if (questionVersions.length > 1) {
      // Find the version that's in neededLibNames (primary) — skip its dir
      const primaryKey = `H5P.Question-${LIBRARY_REGISTRY['H5P.Question']?.majorVersion}.${LIBRARY_REGISTRY['H5P.Question']?.minorVersion}`;
      if (primaryKey) skipDirLibs.add(primaryKey);
    }

    try {
      await fs.access(libraryPath);
      for (const [key, lib] of allLibs) {
        if (skipDirLibs.has(lib.machineName) || skipDirLibs.has(key)) continue;
        const libDir = path.join(libraryPath, lib.dirName);
        try {
          await fs.access(libDir);
          // Use glob to add only files (no directory entries) — matches official H5P format
          archive.glob('**/*', { cwd: libDir, nodir: true }, { prefix: lib.dirName });
        } catch {
          // Library directory not found, skip
        }
      }
      // Also package directory-only dependencies that aren't in allLibs
      // but are needed by certain content types (e.g., AdvancedText for Crossword extraClue)
      if (questionTypes.has('crossword')) {
        const advTextDir = path.join(libraryPath, 'H5P.AdvancedText-1.1');
        try {
          await fs.access(advTextDir);
          archive.glob('**/*', { cwd: advTextDir, nodir: true }, { prefix: 'H5P.AdvancedText-1.1' });
        } catch { /* skip */ }
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

      const distractorNumbers = Array.from({length: items.length}, (_, i) => i + 1);

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
  } else if (question.type === 'flashcard') {
    const front = question.content?.front || question.questionText || "Front of card";
    const back = question.content?.back || question.correctAnswer || "Back of card";
    const escapedFront = front.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedBack = back.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return {
      "params": {
        "mode": "normal",
        "dialogs": [
          {
            "text": `<p style="text-align:center;">${escapedFront}</p>`,
            "answer": `<p style="text-align:center;">${escapedBack}</p>`,
            "tips": {},
            "imageAltText": ""
          }
        ],
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
        "summaryAllDone": "Well done! You have mastered all @cards cards!",
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
        "title": "",
        "description": ""
      },
      "library": "H5P.Dialogcards 1.9",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Dialog Cards",
        "license": "U",
        "title": "Flashcard"
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
  } else if (question.type === 'mark-the-words') {
    const text = question.content?.text || question.questionText || '';
    return {
      "params": {
        "taskDescription": `<p>${escapeHtml(question.questionText)}</p>`,
        "textField": text,
        "overallFeedback": [{ "from": 0, "to": 100 }],
        "behaviour": {
          "enableRetry": true,
          "enableSolutionsButton": true,
          "enableCheckButton": true,
          "showScorePoints": true
        },
        "checkAnswerButton": "Check",
        "submitAnswerButton": "Submit",
        "tryAgainButton": "Retry",
        "showSolutionButton": "Show solution",
        "correctAnswer": "Correct!",
        "incorrectAnswer": "Incorrect!",
        "missedAnswer": "Missed!",
        "displaySolutionDescription": "Task is updated to contain the solution.",
        "scoreBarLabel": "You got :num out of :total points",
        "a11yCheck": "Check the answers. The responses will be marked as correct, incorrect, or unanswered.",
        "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
        "a11yRetry": "Retry the task. Reset all responses and start the task over again."
      },
      "library": "H5P.MarkTheWords 1.11",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Mark the Words",
        "license": "U",
        "title": "Mark the Words"
      }
    };
  } else if (question.type === 'single-choice-set') {
    const questions = question.content?.questions || [];
    const choices = questions.map(q => ({
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "question": escapeHtml(q.question || ''),
      "answers": (q.answers || []).map(a => escapeHtml(typeof a === 'string' ? a : a.text || ''))
    }));
    return {
      "params": {
        "choices": choices,
        "overallFeedback": [{ "from": 0, "to": 100 }],
        "behaviour": {
          "autoContinue": true,
          "timeoutCorrect": 2000,
          "timeoutWrong": 3000,
          "soundEffectsEnabled": true,
          "enableRetry": true,
          "enableSolutionsButton": true,
          "passPercentage": 100
        },
        "l10n": {
          "nextButtonLabel": "Next question",
          "showSolutionButtonLabel": "Show solution",
          "retryButtonLabel": "Retry",
          "solutionViewTitle": "Solution list",
          "correctText": "Correct!",
          "incorrectText": "Incorrect!",
          "shouldSelect": "Should have been selected",
          "shouldNotSelect": "Should not have been selected",
          "muteButtonLabel": "Mute feedback sound",
          "closeButtonLabel": "Close",
          "slideOfTotal": "Slide :num of :total",
          "scoreBarLabel": "You got :num out of :total points",
          "solutionListQuestionNumber": "Question :num",
          "a11yShowSolution": "Show the solution. The task will be marked with its correct solution.",
          "a11yRetry": "Retry the task. Reset all responses and start the task over again."
        }
      },
      "library": "H5P.SingleChoiceSet 1.11",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Single Choice Set",
        "license": "U",
        "title": "Single Choice Set"
      }
    };
  } else if (question.type === 'essay') {
    const keywords = (question.content?.keywords || []).map(kw => ({
      "keyword": kw.keyword || '',
      "alternatives": kw.alternatives || [],
      "options": {
        "points": kw.points || 1,
        "occurrences": 1,
        "caseSensitive": false,
        "forgiveMistakes": false
      }
    }));
    return {
      "params": {
        "taskDescription": `<p>${escapeHtml(question.content?.taskDescription || question.questionText)}</p>`,
        "overallFeedback": [{ "from": 0, "to": 100 }],
        "solution": {
          "introduction": "Sample answer:",
          "sample": question.content?.sampleAnswer || ''
        },
        "keywords": keywords,
        "behaviour": {
          "minimumLength": 0,
          "maximumLength": 10000,
          "inputFieldSize": 10,
          "enableRetry": true,
          "enableSolutionsButton": true,
          "ignoreScoring": false,
          "pointsHost": 1
        },
        "placeholderText": "Enter your essay here...",
        "submitButtonLabel": "Submit",
        "tryAgainButtonLabel": "Retry",
        "showSolutionButtonLabel": "Show solution",
        "feedbackHeader": "Feedback",
        "notEnoughChars": "You must enter at least :min characters!",
        "tooManyChars": "You have entered more than :max characters!",
        "scoreBarLabel": "You got :num out of :total points",
        "a11yCheck": "Check the answers.",
        "a11yShowSolution": "Show the solution.",
        "a11yRetry": "Retry the task."
      },
      "library": "H5P.Essay 1.5",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Essay",
        "license": "U",
        "title": "Essay"
      }
    };
  } else if (question.type === 'free-text') {
    const ftQuestion = typeof question.content?.question === 'string' ? question.content.question : question.questionText;
    return {
      "params": {
        "question": `<p>${escapeHtml(ftQuestion)}</p>`,
        "placeholder": (typeof question.content?.placeholder === 'string' ? question.content.placeholder : '') || 'Enter your answer here...'
      },
      "library": "H5P.FreeTextQuestion 1.0",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Free Text Question",
        "license": "U",
        "title": "Free Text Question"
      }
    };
  } else if (question.type === 'open-ended') {
    const oeQuestion = typeof question.content?.question === 'string' ? question.content.question : question.questionText;
    return {
      "params": {
        "question": `<p>${escapeHtml(oeQuestion)}</p>`,
        "placeholderText": (typeof question.content?.placeholderText === 'string' ? question.content.placeholderText : '') || 'Enter your response here...',
        "inputRows": 5
      },
      "library": "H5P.OpenEndedQuestion 1.0",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Open Ended Question",
        "license": "U",
        "title": "Open Ended Question"
      }
    };
  } else if (question.type === 'simple-multi-choice') {
    const alternatives = (question.content?.alternatives || []).map((alt, idx) => ({
      "text": `<p>${escapeHtml(alt.text || alt)}</p>`,
      "correct": alt.correct !== undefined ? alt.correct : idx === 0
    }));
    return {
      "params": {
        "question": `<p>${escapeHtml(question.content?.question || question.questionText)}</p>`,
        "inputType": "checkbox",
        "alternatives": alternatives,
        "behaviour": {
          "enableRetry": true,
          "enableSolutionsButton": true
        },
        "l10n": {
          "checkAnswer": "Check",
          "showSolution": "Show solution",
          "retry": "Retry",
          "resultMessage": "You got :correct out of :total correct"
        }
      },
      "library": "H5P.SimpleMultiChoice 1.1",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Simple Multiple Choice",
        "license": "U",
        "title": "Simple Multiple Choice"
      }
    };
  } else if (question.type === 'sort-paragraphs') {
    const paragraphs = question.content?.paragraphs || [];
    return {
      "params": {
        "taskDescription": `<p>${escapeHtml(question.content?.taskDescription || question.questionText)}</p>`,
        "paragraphs": paragraphs.map(p => `<p>${escapeHtml(typeof p === 'string' ? p : p.text || '')}</p>\n`),
        "media": { "disableImageZooming": false },
        "overallFeedback": [{ "from": 0, "to": 100 }],
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
          "disabled": "Disabled",
          "submitAnswer": "Submit"
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
      "library": "H5P.SortParagraphs 0.11",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Sort the Paragraphs",
        "license": "U",
        "title": "Sort the Paragraphs"
      }
    };
  } else if (question.type === 'crossword') {
    const words = (question.content?.words || []).map(w => ({
      "answer": w.answer || w.word || '',
      "clue": w.clue || w.hint || '',
      "fixWord": false
    }));
    return {
      "params": {
        "words": words,
        "overallFeedback": [{ "from": 0, "to": 100 }],
        "theme": {
          "backgroundColor": "#173354",
          "gridColor": "#000000",
          "cellBackgroundColor": "#ffffff",
          "cellColor": "#000000",
          "clueIdColor": "#606060",
          "cellBackgroundColorHighlight": "#3e8de8",
          "cellColorHighlight": "#ffffff",
          "clueIdColorHighlight": "#e0e0e0"
        },
        "taskDescription": `<p>${escapeHtml(question.content?.taskDescription || question.questionText)}</p>\n`,
        "behaviour": {
          "enableRetry": false,
          "enableSolutionsButton": true,
          "scoreWords": true,
          "applyPenalties": false,
          "enableInstantFeedback": false
        },
        "l10n": {
          "across": "Across",
          "down": "Down",
          "checkAnswer": "Check",
          "submitAnswer": "Submit",
          "couldNotGenerateCrossword": "Could not generate a crossword with the given words. Please try again with fewer words or words that have more characters in common.",
          "couldNotGenerateCrosswordTooFewWords": "Could not generate a crossword. You need at least two words.",
          "problematicWords": "Some words could not be placed. If you are using fixed words, make sure that their position is correct.",
          "showSolution": "Show solution",
          "tryAgain": "Retry",
          "extraClue": "Extra clue",
          "closeWindow": "Close",
          "submitYourAnswers": "Submit your answers to get a score.",
          "scoreBarLabel": "You got :num out of :total points",
          "a11yCheck": "Check the answers.",
          "a11yShowSolution": "Show the solution.",
          "a11yRetry": "Retry the task."
        },
        "a11y": {
          "crosswordGrid": "Crossword grid. Use arrow keys to navigate and keyboard to enter characters.",
          "column": "Column",
          "row": "Row",
          "across": "Across",
          "down": "Down",
          "empty": "Empty",
          "resultFor": "Result for: @clue",
          "correct": "Correct",
          "wrong": "Wrong",
          "point": "point",
          "solutionFor": "For @clue the solution is: @solution",
          "extraClueFor": "Open extra clue for @clue",
          "letterSevenOfNine": "Letter @position of @length"
        }
      },
      "library": "H5P.Crossword 0.5",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Crossword",
        "license": "U",
        "title": "Crossword"
      }
    };
  } else if (question.type === 'dictation') {
    const sentences = (question.content?.sentences || []).map(s => ({
      "text": typeof s === 'string' ? s : s.text || '',
      "sample": typeof s === 'string' ? undefined : s.sample || undefined
    }));
    return {
      "params": {
        "taskDescription": `<p>${escapeHtml(question.content?.taskDescription || question.questionText)}</p>`,
        "sentences": sentences,
        "overallFeedback": [{ "from": 0, "to": 100 }],
        "behaviour": {
          "tries": 3,
          "triesAlternative": 3,
          "showSolution": "Show solution",
          "customTypoDisplay": false,
          "enableRetry": true,
          "enableSolutionsButton": true,
          "ignorePunctuation": true,
          "zeroMistakeMode": false,
          "alternateSolution": "first"
        },
        "l10n": {
          "checkAnswer": "Check",
          "submitAnswer": "Submit",
          "tryAgain": "Retry",
          "showSolution": "Show solution",
          "audioNotSupported": "Your browser does not support this audio.",
          "correctAnswer": "Correct answer",
          "wrongAnswer": "Wrong answer",
          "scoreBarLabel": "You got :num out of :total points",
          "a11yCheck": "Check the answers.",
          "a11yShowSolution": "Show the solution.",
          "a11yRetry": "Retry the task.",
          "typoMessage": "Typo! You meant :correct, not :wrong",
          "added": "Added :added",
          "missing": "Missing :missing",
          "wrong": "Wrong :wrong",
          "period": "period",
          "exclamationPoint": "exclamation point",
          "questionMark": "question mark",
          "comma": "comma",
          "singleQuote": "single quote",
          "doubleQuote": "double quote",
          "colon": "colon",
          "semicolon": "semicolon",
          "plus": "plus",
          "minus": "minus",
          "asterisk": "asterisk",
          "forwardSlash": "forward slash"
        }
      },
      "library": "H5P.Dictation 1.4",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Dictation",
        "license": "U",
        "title": "Dictation"
      }
    };
  } else if (question.type === 'arithmetic-quiz') {
    const arithmeticType = question.content?.quizType || 'addition';
    return {
      "params": {
        "quizType": "arithmetic",
        "arithmeticType": arithmeticType,
        "maxQuestions": question.content?.numQuestions || 10,
        "useFractions": false,
        "UI": {
          "score": "Score: @score",
          "time": "Time: @time",
          "resultPageHeader": "Quiz finished!",
          "go": "Go!",
          "startButton": "Start",
          "retryButton": "Retry",
          "correctText": ":num correct",
          "incorrectText": ":num wrong",
          "durationLabel": "Duration:",
          "humanizedLabelForTime": "@minutes minutes, @seconds seconds",
          "scoreBarLabel": "You got :num out of :total points"
        }
      },
      "library": "H5P.ArithmeticQuiz 1.1",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": {
        "contentType": "Arithmetic Quiz",
        "license": "U",
        "title": "Arithmetic Quiz"
      }
    };
  } else if (question.type === 'branching-scenario') {
    const introText = question.content?.introText || 'Introduction';

    // Sort by node.index so h5pContent[i] matches nextContentId references
    const nodes = (question.content?.nodes || [])
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    const h5pContent = nodes.map(node => {
      // Only node at index 0 is the intro text — never trust question===null for others
      if (node.index === 0) {
        const nextId = 1;
        return {
          "type": {
            "library": "H5P.AdvancedText 1.1",
            "params": { "text": `<p>${escapeHtml(introText)}</p>` },
            "subContentId": crypto.randomBytes(16).toString('hex'),
            "metadata": { "contentType": "Text", "license": "U", "title": "Introduction" }
          },
          "showContentTitle": false,
          "proceedButtonText": "Proceed",
          "forceContentFinished": "useBehavioural",
          "feedback": { "title": "", "subtitle": "" },
          "contentBehaviour": "useBehavioural",
          "nextContentId": nextId
        };
      }

      // Branching Question node
      let alternatives = (node.alternatives || []).map(alt => ({
        "text": alt.text || '',
        "nextContentId": alt.nextContentId ?? -1,
        "feedback": {
          "title": alt.feedback ? `<p>${escapeHtml(alt.feedback)}</p>` : '',
          "subtitle": ""
        }
      }));

      // If the LLM left alternatives empty, add a fallback "End" option so the user isn't stuck
      if (alternatives.length === 0) {
        alternatives = [{ "text": "Continue", "nextContentId": -1, "feedback": { "title": "", "subtitle": "" } }];
      }

      const questionText = node.question || 'What would you do next?';

      return {
        "type": {
          "library": "H5P.BranchingQuestion 1.0",
          "params": {
            "branchingQuestion": {
              "question": `<p>${escapeHtml(questionText)}</p>`,
              "alternatives": alternatives
            }
          },
          "subContentId": crypto.randomBytes(16).toString('hex'),
          "metadata": { "contentType": "Branching Question", "license": "U", "title": "Branching Question" }
        },
        "showContentTitle": false,
        "proceedButtonText": "Proceed",
        "forceContentFinished": "useBehavioural",
        "feedback": { "title": "", "subtitle": "" },
        "contentBehaviour": "useBehavioural"
      };
    });

    return {
      "params": {
        "branchingScenario": {
          "content": h5pContent,
          "endScreens": [{ "endScreenTitle": "", "endScreenSubtitle": "", "contentId": -1, "endScreenScore": 0 }],
          "scoringOptionGroup": { "scoringOption": "no-score", "includeInteractionsScores": true },
          "startScreen": { "startScreenTitle": "", "startScreenSubtitle": "" },
          "behaviour": { "enableBackwardsNavigation": false, "forceContentFinished": false, "randomizeBranchingQuestions": false },
          "l10n": {
            "startScreenButtonText": "Start the course",
            "endScreenButtonText": "Restart the course",
            "backButtonText": "Back",
            "disableProceedButtonText": "Require to complete the current module",
            "replayButtonText": "Replay the video",
            "scoreText": "Your score:"
          }
        }
      },
      "library": "H5P.BranchingScenario 1.10",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": { "contentType": "Branching Scenario", "license": "U", "title": "Branching Scenario" }
    };
  } else if (question.type === 'documentation-tool') {
    const title = question.content?.title || 'Documentation Tool';
    const pages = question.content?.pages || [];

    const pagesList = pages.map(page => {
      const id = () => crypto.randomBytes(16).toString('hex');

      if (page.type === 'goals') {
        return {
          "params": { "description": "<p>Add goals for your project work by pressing the button below. You should describe each goal in your own words.</p>\n", "defineGoalText": "Add goal", "definedGoalLabel": "Goal", "defineGoalPlaceholder": "Write here...", "goalsAddedText": "Goals added:", "specifyGoalText": "Specify", "removeGoalText": "Remove", "helpTextLabel": "Read more", "helpText": "<p>Define the goals for your project work.</p>\n", "goalDeletionConfirmation": { "header": "Confirm deletion", "message": "Are you sure you want to delete this goal?", "cancelLabel": "Cancel", "confirmLabel": "Confirm" } },
          "library": "H5P.GoalsPage 1.5",
          "subContentId": id(),
          "metadata": { "contentType": "Goals Page", "license": "U", "title": "Goals" }
        };
      }

      if (page.type === 'assessment') {
        return {
          "params": { "description": "<p>Assess how well you achieved the goals you defined for the project.</p>\n", "lowRating": "Did not achieve", "midRating": "Achieved partially", "highRating": "Achieved completely", "noGoalsText": "You have not chosen any goals yet.", "helpTextLabel": "Read more", "helpText": "<p>Rate each goal you defined.</p>\n", "legendHeader": "Possible ratings:", "goalHeader": "Goals", "ratingHeader": "Rating" },
          "library": "H5P.GoalsAssessmentPage 1.4",
          "subContentId": id(),
          "metadata": { "contentType": "Goals Assessment Page", "license": "U", "title": "Assessment" }
        };
      }

      if (page.type === 'export') {
        return {
          "params": { "description": "<p>Export all your submitted text, goals, and goal assessments as a Word document.</p>\n", "createDocumentLabel": "Create document", "selectAllTextLabel": "Select all text", "exportTextLabel": "Export text", "helpTextLabel": "Read more", "requiresInputErrorMessage": "One or more required input fields need to be filled.", "helpText": "<p>Press the Create document button to download a Word document of your work.</p>\n", "submitTextLabel": "Submit", "submitSuccessTextLabel": "Your report was submitted successfully!" },
          "library": "H5P.DocumentExportPage 1.5",
          "subContentId": id(),
          "metadata": { "contentType": "Document Export Page", "license": "U", "title": "Export" }
        };
      }

      // intro or task — both use H5P.StandardPage with TextInputFields
      const elementList = [];
      if (page.introText) {
        elementList.push({
          "params": { "text": `<p>${escapeHtml(page.introText)}</p>` },
          "library": "H5P.Text 1.1",
          "subContentId": id(),
          "metadata": { "contentType": "Text", "license": "U", "title": "Introduction" }
        });
      }
      (page.fields || []).forEach(field => {
        elementList.push({
          "params": { "taskDescription": escapeHtml(field.label || ''), "placeholderText": "Write here...", "requiredField": false, "inputFieldSize": 3 },
          "library": "H5P.TextInputField 1.2",
          "subContentId": id(),
          "metadata": { "contentType": "Text Input Field", "license": "U", "title": escapeHtml(field.label || 'Field') }
        });
      });

      return {
        "params": { "elementList": elementList, "helpTextLabel": "Read more", "helpText": "" },
        "library": "H5P.StandardPage 1.5",
        "subContentId": id(),
        "metadata": { "contentType": "Standard Page", "license": "U", "title": escapeHtml(page.title || title) }
      };
    });

    return {
      "params": {
        "pagesList": pagesList,
        "taskDescription": escapeHtml(title),
        "i10n": {
          "previousLabel": "Previous",
          "nextLabel": "Next",
          "closeLabel": "Close"
        }
      },
      "library": "H5P.DocumentationTool 1.8",
      "subContentId": crypto.randomBytes(16).toString('hex'),
      "metadata": { "contentType": "Documentation Tool", "license": "U", "title": escapeHtml(title) }
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

// Question types that cannot be embedded inside Column/QuestionSet containers
export const STANDALONE_TYPES = new Set(['branching-scenario', 'documentation-tool']);

/**
 * Build a single Interactive Book chapter node.
 * @param {Object} chapter - { title, questionIds, containerType, passPercentage, disableBackwardsNavigation, randomizeQuestions }
 * @param {Object[]} questions - All question documents (will be filtered by questionIds)
 * @param {Object} quiz - Quiz document (passed to convertQuestionToH5P)
 * @returns {Object} IB chapter node
 */
export function buildIBChapter(chapter, questions, quiz) {
  const idSet = new Set((chapter.questionIds || []).map(id => String(id)));
  const chapterQuestions = questions.filter(q => idSet.has(String(q._id)));
  const embeddable = chapterQuestions.filter(q => !STANDALONE_TYPES.has(q.type));

  let columnContent;

  if (chapter.containerType === 'question-set') {
    const qsParams = generateH5PQuestionSet(embeddable);
    qsParams.passPercentage = chapter.passPercentage ?? 50;
    qsParams.disableBackwardsNavigation = chapter.disableBackwardsNavigation ?? false;
    qsParams.randomQuestions = chapter.randomizeQuestions ?? false;

    columnContent = [{
      content: {
        library: 'H5P.QuestionSet 1.21',
        params: qsParams,
        subContentId: crypto.randomBytes(16).toString('hex'),
        metadata: { contentType: 'Question Set', license: 'U', title: chapter.title || 'Quiz' }
      },
      useSeparator: 'auto'
    }];
  } else {
    // column mode — each question is its own item
    columnContent = embeddable
      .map(q => convertQuestionToH5P(q, quiz))
      .filter(Boolean)
      .map(h5pObj => ({ content: h5pObj, useSeparator: 'auto' }));
  }

  return {
    library: 'H5P.Column 1.20',
    params: { content: columnContent },
    subContentId: crypto.randomBytes(16).toString('hex'),
    metadata: { title: chapter.title || 'Chapter', license: 'U' }
  };
}

/**
 * Build Interactive Book content.json from chapter structure.
 * @param {Object[]} chapters - Chapter definitions from quiz.chapters
 * @param {Object[]} questions - All question documents
 * @param {Object} quiz - Quiz document
 * @returns {Object} IB content.json object
 */
export function buildInteractiveBookContent(chapters, questions, quiz) {
  const chapterNodes = chapters.map(ch => buildIBChapter(ch, questions, quiz));

  return {
    showCoverPage: false,
    bookCover: { coverDescription: '' },
    chapters: chapterNodes,
    behaviour: { defaultTableOfContents: true },
    read: 'Read',
    displayTOC: 'Display table of contents',
    hideTOC: 'Hide table of contents',
    page: 'Page',
    next: 'Next page',
    nextPage: 'Next page',
    previous: 'Previous page',
    previousPage: 'Previous page',
    chapterCompleted: 'Page @page is complete!',
    partCompleted: '@page is now complete',
    incompleteChapter: 'Incomplete page',
    navigateToTop: 'Navigate to the top',
    markAsFinished: 'I am done',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    bookProgressSubtext: '@count of @total pages',
    interactionsProgressSubtext: '@count of @total interactions',
    submitReport: 'Submit Report',
    restartLabel: 'Restart',
    summaryHeader: 'Summary',
    allInteractions: 'All interactions',
    unansweredInteractions: 'Unanswered interactions',
    scoreText: '@score / @maxscore',
    leftOutOfTotalCompleted: '@left of @max interactins completed',
    noInteractions: 'No interactions',
    score: 'Score',
    summaryAndSubmit: 'Summary & submit',
    noChapterInteractionBoldText: 'You have not interacted with any pages.',
    noChapterInteractionText: 'Please interact with all pages before submitting.',
    yourAnswersAreSubmittedForReview: 'Your answers are submitted for review.',
    bookProgress: 'Book progress',
    interactionsProgress: 'Interactions progress',
    totalScoreLabel: 'Total score',
    a11y: { progress: 'Page @page of @total' }
  };
}
