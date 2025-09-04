/**
 * Test H5P New Question Types Export
 * Tests matching, cloze, and single-choice-set question types
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data for different question types
const mockQuestions = [
  // Matching Question
  {
    _id: '674a1234567890abcdef0001',
    type: 'matching',
    questionText: 'Match each planet with its characteristics:',
    content: {
      leftItems: ['Mars', 'Venus', 'Jupiter'],
      rightItems: ['Red planet', 'Hottest planet', 'Largest planet', 'Has rings'],
      matchingPairs: [
        ['Mars', 'Red planet'],
        ['Venus', 'Hottest planet'], 
        ['Jupiter', 'Largest planet']
      ]
    },
    difficulty: 'moderate',
    reviewStatus: 'approved',
    order: 1
  },
  // Cloze Question
  {
    _id: '674a1234567890abcdef0002',
    type: 'cloze',
    questionText: 'Fill in the blanks about photosynthesis:',
    content: {
      textWithBlanks: 'Photosynthesis is the process by which plants convert [blank] into energy using [blank] from the sun.',
      correctAnswers: ['sunlight', 'energy'],
      blankOptions: [
        ['sunlight', 'water', 'oxygen'],
        ['energy', 'glucose', 'carbon dioxide']
      ]
    },
    difficulty: 'easy',
    reviewStatus: 'approved',
    order: 2
  },
  // Single Choice Set Question
  {
    _id: '674a1234567890abcdef0003',
    type: 'single-choice-set',
    questionText: 'What is the capital of France?',
    content: {
      options: [
        { text: 'Paris', isCorrect: true },
        { text: 'London', isCorrect: false },
        { text: 'Berlin', isCorrect: false },
        { text: 'Madrid', isCorrect: false }
      ]
    },
    difficulty: 'easy',
    reviewStatus: 'approved',
    order: 3
  }
];

const mockQuiz = {
  _id: '674a1234567890abcdef0100',
  name: 'Mixed Question Types Quiz',
  questions: mockQuestions,
  learningObjectives: [{
    _id: '674a1234567890abcdef0200',
    text: 'Understand various question formats',
    order: 1
  }],
  createdBy: '674a1234567890abcdef0300'
};

async function testAllNewQuestionTypes() {
  console.log('🧪 Testing All New H5P Question Types...');
  
  try {
    const testH5PContent = generateTestH5PContent(mockQuiz);
    
    console.log('✅ H5P content generated successfully!');
    console.log('📊 Total questions generated:', testH5PContent.questions.length);
    
    // Test each question type
    testH5PContent.questions.forEach((question, index) => {
      const mockQuestion = mockQuestions[index];
      console.log(`\\n📝 Question ${index + 1} (${mockQuestion.type}):`);
      console.log('   Library:', question.library);
      console.log('   Content Type:', question.metadata.contentType);
      
      switch (mockQuestion.type) {
        case 'matching':
          console.log('   Text Field:', question.params.textField.substring(0, 100) + '...');
          console.log('   Distractors:', question.params.distractors);
          break;
        case 'cloze':
          console.log('   Questions:', question.params.questions.length);
          console.log('   Sample text:', question.params.questions[0].substring(0, 100) + '...');
          break;
        case 'single-choice-set':
          console.log('   Choices:', question.params.choices.length);
          console.log('   Answers per choice:', question.params.choices[0].answers.length);
          break;
      }
    });
    
    // Verify libraries
    const libraries = testH5PContent.questions.map(q => q.library);
    const expectedLibraries = [
      'H5P.DragText 1.10',
      'H5P.Blanks 1.14',
      'H5P.SingleChoiceSet 1.11'
    ];
    
    console.log('\\n🔍 Library Verification:');
    expectedLibraries.forEach((expected, index) => {
      if (libraries[index] === expected) {
        console.log(`   ✅ ${expected}`);
      } else {
        console.log(`   ❌ Expected ${expected}, got ${libraries[index]}`);
      }
    });
    
    // Write test outputs
    const outputPath = path.join(__dirname, 'h5p-all-types-test-output.json');
    await fs.writeFile(outputPath, JSON.stringify(testH5PContent, null, 2));
    console.log('\\n📁 Test output written to:', outputPath);
    
    // Generate h5p.json for dependencies verification
    const h5pJson = generateH5PManifest(mockQuiz);
    const h5pPath = path.join(__dirname, 'h5p-dependencies-test.json');
    await fs.writeFile(h5pPath, JSON.stringify(h5pJson, null, 2));
    console.log('📁 H5P manifest written to:', h5pPath);
    console.log('🔗 Dependencies:', h5pJson.preloadedDependencies.map(d => d.machineName).join(', '));
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    console.log('📊 Error details:', error.stack);
  }
}

function generateTestH5PContent(quiz) {
  const content = {
    "introPage": {
      "showIntroPage": true,
      "title": quiz.name || "Quiz",
      "introduction": `This quiz contains ${quiz.questions.length} questions of different types.`,
      "startButtonText": "Start Quiz"
    },
    "progressType": "dots",
    "passPercentage": 50,
    "questions": [],
    "disableBackwardsNavigation": false,
    "randomQuestions": false
  };

  for (const question of quiz.questions) {
    let h5pQuestion;

    if (question.type === 'matching') {
      const leftItems = question.content?.leftItems || [];
      const rightItems = question.content?.rightItems || [];
      const matchingPairs = question.content?.matchingPairs || [];
      
      let textField = question.questionText + "\\n\\n";
      leftItems.forEach((leftItem, index) => {
        const correctMatch = matchingPairs[index] ? matchingPairs[index][1] : rightItems[index];
        textField += `${leftItem}: *${correctMatch}*\\n`;
      });
      
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
          "overallFeedback": [{"from": 0, "to": 100, "feedback": "Score: @score of @total."}],
          "distractors": distractors.length > 0 ? distractors.map(d => `*${d}*`).join(" ") : ""
        },
        "subContentId": "matching-test-" + Math.random().toString(16).substr(2, 8),
        "metadata": {
          "contentType": "Drag Text",
          "license": "U",
          "title": "Matching Question"
        }
      };
    } else if (question.type === 'cloze') {
      const textWithBlanks = question.content?.textWithBlanks || question.questionText;
      const correctAnswers = question.content?.correctAnswers || [];
      
      let h5pText = textWithBlanks;
      correctAnswers.forEach((answer) => {
        h5pText = h5pText.replace(/\\[blank\\]|\_{3,}/, `*${answer}*`);
      });

      h5pQuestion = {
        "library": "H5P.Blanks 1.14",
        "params": {
          "questions": [`<p>${escapeHtml(h5pText)}</p>\\n`],
          "showSolutions": "Show solutions",
          "tryAgain": "Try again",
          "text": `<p>${escapeHtml(question.questionText)}</p>\\n`,
          "checkAnswer": "Check",
          "behaviour": {
            "enableSolutionsButton": true,
            "autoCheck": true,
            "caseSensitive": false,
            "enableRetry": true,
            "enableCheckButton": true
          },
          "overallFeedback": [{"from": 0, "to": 100, "feedback": "You got @score of @total blanks correct."}]
        },
        "subContentId": "cloze-test-" + Math.random().toString(16).substr(2, 8),
        "metadata": {
          "contentType": "Fill in the Blanks",
          "license": "U",
          "title": "Cloze Question"
        }
      };
    } else if (question.type === 'single-choice-set') {
      const options = question.content?.options || [];
      
      h5pQuestion = {
        "library": "H5P.SingleChoiceSet 1.11",
        "params": {
          "choices": [
            {
              "answers": options.map(opt => opt.text),
              "question": question.questionText,
              "subContentId": Math.random().toString(16).substr(2, 8)
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
            "incorrectText": "Incorrect!"
          },
          "overallFeedback": [{"from": 0, "to": 100, "feedback": "You got :numcorrect of :maxscore correct"}]
        },
        "subContentId": "single-choice-test-" + Math.random().toString(16).substr(2, 8),
        "metadata": {
          "contentType": "Single Choice Set",
          "license": "U",
          "title": "Single Choice Question"
        }
      };
    }
    
    if (h5pQuestion) {
      content.questions.push(h5pQuestion);
    }
  }
  
  return content;
}

function generateH5PManifest(quiz) {
  return {
    "title": quiz.name || "Quiz Export",
    "language": "en",
    "mainLibrary": "H5P.QuestionSet",
    "embedTypes": ["iframe"],
    "license": "U",
    "preloadedDependencies": [
      { "machineName": "H5P.QuestionSet", "majorVersion": "1", "minorVersion": "20" },
      { "machineName": "H5P.MultiChoice", "majorVersion": "1", "minorVersion": "16" },
      { "machineName": "H5P.TrueFalse", "majorVersion": "1", "minorVersion": "8" },
      { "machineName": "H5P.SortParagraphs", "majorVersion": "0", "minorVersion": "11" },
      { "machineName": "H5P.DragText", "majorVersion": "1", "minorVersion": "10" },
      { "machineName": "H5P.Blanks", "majorVersion": "1", "minorVersion": "14" },
      { "machineName": "H5P.SingleChoiceSet", "majorVersion": "1", "minorVersion": "11" }
    ]
  };
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"']/g, (match) => {
    const escape = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return escape[match];
  });
}

// Run the test
testAllNewQuestionTypes();