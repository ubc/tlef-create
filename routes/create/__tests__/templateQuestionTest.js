/**
 * Test Template Question Generator
 * Verifies that all question types can be generated with proper content structures
 */

import dotenv from 'dotenv';
dotenv.config();

import { generateTemplateQuestion } from '../services/templateQuestionGenerator.js';

// Mock learning objective
const mockLearningObjective = {
  text: "Students will demonstrate understanding of how to properly handle errors and exceptions when working with promises by creating code snippets that use the catch method"
};

const questionTypes = [
  'multiple-choice',
  'true-false', 
  'matching',
  'ordering',
  'cloze',
  'flashcard',
  'summary',
  'discussion',
  'single-choice-set'
];

async function testAllTemplateTypes() {
  console.log('🧪 Testing Template Question Generation...');
  console.log('📚 Learning Objective:', mockLearningObjective.text.substring(0, 80) + '...');
  
  const results = {
    successful: [],
    failed: [],
    totalTested: questionTypes.length
  };
  
  for (const questionType of questionTypes) {
    console.log(`\\n📝 Testing ${questionType} template generation...`);
    
    try {
      const templateQuestion = generateTemplateQuestion(
        mockLearningObjective,
        questionType,
        'moderate'
      );
      
      // Validate the generated question structure
      const validation = validateQuestionStructure(templateQuestion, questionType);
      
      if (validation.isValid) {
        console.log(`   ✅ ${questionType} template generated successfully`);
        console.log(`   📊 Question text: ${templateQuestion.questionText.substring(0, 60)}...`);
        console.log(`   🔧 Content structure: ${Object.keys(templateQuestion.content || {}).join(', ')}`);
        
        results.successful.push({
          type: questionType,
          question: templateQuestion,
          validation: validation
        });
      } else {
        console.log(`   ❌ ${questionType} template validation failed: ${validation.errors.join(', ')}`);
        results.failed.push({
          type: questionType,
          errors: validation.errors
        });
      }
      
    } catch (error) {
      console.log(`   ❌ ${questionType} template generation failed: ${error.message}`);
      results.failed.push({
        type: questionType,
        error: error.message
      });
    }
  }
  
  // Summary
  console.log('\\n📊 Template Generation Test Results:');
  console.log(`   ✅ Successful: ${results.successful.length}/${results.totalTested}`);
  console.log(`   ❌ Failed: ${results.failed.length}/${results.totalTested}`);
  
  if (results.failed.length > 0) {
    console.log('\\n❌ Failed Question Types:');
    results.failed.forEach(failure => {
      console.log(`   - ${failure.type}: ${failure.error || failure.errors.join(', ')}`);
    });
  }
  
  // Test H5P export compatibility
  console.log('\\n🎯 Testing H5P Export Compatibility...');
  testH5PCompatibility(results.successful);
  
  return results;
}

function validateQuestionStructure(question, expectedType) {
  const errors = [];
  
  // Basic structure validation
  if (!question.questionText || question.questionText.length < 10) {
    errors.push('Missing or too short questionText');
  }
  
  if (question.type !== expectedType) {
    errors.push(`Type mismatch: expected ${expectedType}, got ${question.type}`);
  }
  
  if (!question.difficulty) {
    errors.push('Missing difficulty');
  }
  
  // Type-specific validation
  switch (expectedType) {
    case 'multiple-choice':
      if (!question.content?.options || !Array.isArray(question.content.options)) {
        errors.push('Missing options array');
      } else if (question.content.options.length < 2) {
        errors.push('Insufficient options');
      } else if (!question.content.options.some(opt => opt.isCorrect)) {
        errors.push('No correct option marked');
      }
      break;
      
    case 'true-false':
      if (typeof question.correctAnswer !== 'boolean') {
        errors.push('Missing boolean correctAnswer');
      }
      break;
      
    case 'matching':
      if (!question.content?.leftItems || !Array.isArray(question.content.leftItems)) {
        errors.push('Missing leftItems array');
      }
      if (!question.content?.rightItems || !Array.isArray(question.content.rightItems)) {
        errors.push('Missing rightItems array');  
      }
      if (!question.content?.matchingPairs || !Array.isArray(question.content.matchingPairs)) {
        errors.push('Missing matchingPairs array');
      }
      break;
      
    case 'ordering':
      if (!question.content?.items || !Array.isArray(question.content.items)) {
        errors.push('Missing items array');
      }
      if (!question.content?.correctOrder || !Array.isArray(question.content.correctOrder)) {
        errors.push('Missing correctOrder array');
      }
      break;
      
    case 'cloze':
      if (!question.content?.textWithBlanks) {
        errors.push('Missing textWithBlanks');
      }
      if (!question.content?.correctAnswers || !Array.isArray(question.content.correctAnswers)) {
        errors.push('Missing correctAnswers array');
      }
      break;
      
    case 'flashcard':
      if (!question.content?.front) {
        errors.push('Missing front content');
      }
      if (!question.content?.back) {
        errors.push('Missing back content');
      }
      break;
      
    case 'summary':
      if (!question.content?.panels || !Array.isArray(question.content.panels)) {
        errors.push('Missing panels array');
      } else if (question.content.panels.some(panel => !panel.title || !panel.content)) {
        errors.push('Invalid panel structure');
      }
      break;
      
    case 'discussion':
      // Discussion questions just need questionText, no special content
      break;
      
    case 'single-choice-set':
      if (!question.content?.options || !Array.isArray(question.content.options)) {
        errors.push('Missing options array');
      }
      break;
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

function testH5PCompatibility(successfulQuestions) {
  console.log('\\n🔍 H5P Export Structure Compatibility:');
  
  successfulQuestions.forEach(({ type, question }) => {
    let compatible = true;
    let issues = [];
    
    switch (type) {
      case 'multiple-choice':
        if (!question.content?.options?.every(opt => opt.text && typeof opt.isCorrect === 'boolean')) {
          compatible = false;
          issues.push('Options need text and isCorrect properties');
        }
        break;
        
      case 'matching':
        if (question.content.leftItems.length !== question.content.matchingPairs.length) {
          compatible = false;
          issues.push('LeftItems and matchingPairs length mismatch');
        }
        break;
        
      case 'cloze':
        if (!question.content.textWithBlanks.includes('$$')) {
          compatible = false;
          issues.push('TextWithBlanks should contain $$ placeholders');
        }
        break;
    }
    
    if (compatible) {
      console.log(`   ✅ ${type}: Compatible with H5P export`);
    } else {
      console.log(`   ⚠️  ${type}: Issues - ${issues.join(', ')}`);
    }
  });
}

// Run the test
testAllTemplateTypes().then(results => {
  if (results.successful.length === results.totalTested) {
    console.log('\\n🎉 All template question types generated successfully!');
    console.log('🚀 Ready for H5P export testing');
  } else {
    console.log('\\n⚠️  Some question types failed - check the errors above');
  }
  
  process.exit(0);
}).catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});