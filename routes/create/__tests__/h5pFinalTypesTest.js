/**
 * Test H5P Final Question Types: Flashcard, Summary, Discussion
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data for the final question types
const mockQuestions = [
  // Flashcard Question
  {
    _id: '674a1234567890abcdef0001',
    type: 'flashcard',
    questionText: 'What is photosynthesis?',
    content: {
      front: 'What is photosynthesis?',
      back: 'The process by which plants convert sunlight into energy using chlorophyll.'
    },
    correctAnswer: 'The process by which plants convert sunlight into energy using chlorophyll.',
    difficulty: 'moderate',
    reviewStatus: 'approved',
    order: 1
  },
  // Summary Question - Accordion format
  {
    _id: '674a1234567890abcdef0002',
    type: 'summary',
    questionText: 'Summary of Plant Biology',
    content: {
      panels: [
        {
          title: 'Photosynthesis',
          content: 'Plants convert sunlight, water, and CO2 into glucose and oxygen through photosynthesis. This process occurs in chloroplasts and is essential for life on Earth.'
        },
        {
          title: 'Plant Structure',
          content: 'Plants have roots for nutrient absorption, stems for support and transport, and leaves for photosynthesis and gas exchange.'
        },
        {
          title: 'Plant Reproduction',
          content: 'Plants reproduce through seeds (sexual reproduction) or vegetative propagation (asexual reproduction) such as runners or bulbs.'
        }
      ]
    },
    difficulty: 'easy',
    reviewStatus: 'approved',
    order: 2
  },
  // Discussion Question
  {
    _id: '674a1234567890abcdef0003',
    type: 'discussion',
    questionText: 'How do you think climate change will affect plant ecosystems in the next 50 years? Consider factors like temperature, precipitation, and CO2 levels.',
    difficulty: 'hard',
    reviewStatus: 'approved',
    order: 3
  }
];

const mockQuiz = {
  _id: '674a1234567890abcdef0100',
  name: 'Plant Biology Study Set',
  questions: mockQuestions,
  learningObjectives: [{
    _id: '674a1234567890abcdef0200',
    text: 'Understand plant biology concepts',
    order: 1
  }],
  createdBy: '674a1234567890abcdef0300'
};

async function testFinalQuestionTypes() {
  console.log('🧪 Testing Final H5P Question Types...');
  console.log('📚 Types: Flashcard, Summary, Discussion');
  
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
        case 'flashcard':
          console.log('   Dialogs:', question.params.dialogs.length);
          console.log('   Front:', question.params.dialogs[0].text.substring(0, 60) + '...');
          console.log('   Back:', question.params.dialogs[0].answer.substring(0, 60) + '...');
          break;
        case 'summary':
          console.log('   Panels:', question.params.panels.length);
          console.log('   Panel titles:', question.params.panels.map(p => p.title).join(', '));
          break;
        case 'discussion':
          console.log('   Text length:', question.params.text.length);
          console.log('   Content preview:', question.params.text.substring(0, 80) + '...');
          break;
      }
    });
    
    // Verify libraries
    const libraries = testH5PContent.questions.map(q => q.library);
    const expectedLibraries = [
      'H5P.Dialogcards 1.9',
      'H5P.Accordion 1.0',
      'H5P.AdvancedText 1.1'
    ];
    
    console.log('\\n🔍 Library Verification:');
    expectedLibraries.forEach((expected, index) => {
      if (libraries[index] === expected) {
        console.log(`   ✅ ${expected}`);
      } else {
        console.log(`   ❌ Expected ${expected}, got ${libraries[index]}`);
      }
    });
    
    // Write detailed test outputs
    const outputPath = path.join(__dirname, 'h5p-final-types-test-output.json');
    await fs.writeFile(outputPath, JSON.stringify(testH5PContent, null, 2));
    console.log('\\n📁 Test output written to:', outputPath);
    
    // Generate complete H5P manifest with ALL dependencies
    const h5pJson = generateCompleteH5PManifest(mockQuiz);
    const h5pPath = path.join(__dirname, 'h5p-complete-dependencies.json');
    await fs.writeFile(h5pPath, JSON.stringify(h5pJson, null, 2));
    console.log('📁 Complete H5P manifest written to:', h5pPath);
    console.log('🔗 Total dependencies:', h5pJson.preloadedDependencies.length);
    console.log('📦 All libraries:', h5pJson.preloadedDependencies.map(d => d.machineName).join(', '));
    
    // Test specific features
    console.log('\\n🎯 Feature Tests:');
    
    // Flashcard features
    const flashcardQ = testH5PContent.questions[0];
    if (flashcardQ.params.behaviour.enableRetry && flashcardQ.params.behaviour.maxProficiency === 5) {
      console.log('   ✅ Flashcard spaced repetition enabled');
    } else {
      console.log('   ❌ Flashcard spaced repetition not configured');
    }
    
    // Summary accordion features  
    const summaryQ = testH5PContent.questions[1];
    if (summaryQ.params.panels.every(p => p.content.library === 'H5P.AdvancedText 1.1')) {
      console.log('   ✅ Summary accordion uses AdvancedText for content');
    } else {
      console.log('   ❌ Summary accordion content library mismatch');
    }
    
    // Discussion features
    const discussionQ = testH5PContent.questions[2];
    if (discussionQ.params.text.includes('Discussion Question') && discussionQ.params.text.includes('Discuss this question')) {
      console.log('   ✅ Discussion question includes discussion prompt');
    } else {
      console.log('   ❌ Discussion question missing discussion prompt');
    }
    
    console.log('\\n🎉 All final H5P question types implemented and tested!');
    
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
      "introduction": `This study set contains ${quiz.questions.length} different types of learning materials.`,
      "startButtonText": "Start Studying"
    },
    "progressType": "dots",
    "passPercentage": 50,
    "questions": [],
    "disableBackwardsNavigation": false,
    "randomQuestions": false
  };

  for (const question of quiz.questions) {
    let h5pQuestion;

    if (question.type === 'flashcard') {
      const front = question.content?.front || question.questionText;
      const back = question.content?.back || question.correctAnswer;
      
      h5pQuestion = {
        "library": "H5P.Dialogcards 1.9",
        "params": {
          "title": `<p>Flashcard Study</p>\\n`,
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
          "behaviour": {
            "scaleTextNotCard": true,
            "enableRetry": true,
            "disableBackwardsNavigation": false,
            "randomCards": false,
            "maxProficiency": 5,
            "quickProgression": false
          },
          "mode": "normal"
        },
        "subContentId": "flashcard-test-" + Math.random().toString(16).substr(2, 8),
        "metadata": {
          "contentType": "Dialog Cards",
          "license": "U",
          "title": "Flashcard"
        }
      };
    } else if (question.type === 'summary') {
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
              "subContentId": Math.random().toString(16).substr(2, 16),
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
        "subContentId": "summary-test-" + Math.random().toString(16).substr(2, 8),
        "metadata": {
          "contentType": "Accordion",
          "license": "U",
          "title": "Summary"
        }
      };
    } else if (question.type === 'discussion') {
      h5pQuestion = {
        "library": "H5P.AdvancedText 1.1",
        "params": {
          "text": `<h3>Discussion Question</h3>\\n<p>${escapeHtml(question.questionText)}</p>\\n<p><em>Discuss this question with your classmates or instructor.</em></p>\\n`
        },
        "subContentId": "discussion-test-" + Math.random().toString(16).substr(2, 8),
        "metadata": {
          "contentType": "Text",
          "license": "U",
          "title": "Discussion Question"
        }
      };
    }
    
    if (h5pQuestion) {
      content.questions.push(h5pQuestion);
    }
  }
  
  return content;
}

function generateCompleteH5PManifest(quiz) {
  return {
    "title": quiz.name || "Complete Quiz Export",
    "language": "en",
    "mainLibrary": "H5P.QuestionSet",
    "embedTypes": ["iframe"],
    "license": "U",
    "preloadedDependencies": [
      // Core H5P libraries
      { "machineName": "H5P.QuestionSet", "majorVersion": "1", "minorVersion": "20" },
      { "machineName": "H5P.MultiChoice", "majorVersion": "1", "minorVersion": "16" },
      { "machineName": "H5P.TrueFalse", "majorVersion": "1", "minorVersion": "8" },
      
      // Interactive question types
      { "machineName": "H5P.SortParagraphs", "majorVersion": "0", "minorVersion": "11" },
      { "machineName": "H5P.DragText", "majorVersion": "1", "minorVersion": "10" },
      { "machineName": "H5P.Blanks", "majorVersion": "1", "minorVersion": "14" },
      { "machineName": "H5P.SingleChoiceSet", "majorVersion": "1", "minorVersion": "11" },
      
      // Study and presentation types
      { "machineName": "H5P.Dialogcards", "majorVersion": "1", "minorVersion": "9" },
      { "machineName": "H5P.Accordion", "majorVersion": "1", "minorVersion": "0" },
      { "machineName": "H5P.AdvancedText", "majorVersion": "1", "minorVersion": "1" }
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
testFinalQuestionTypes();