/**
 * AI Prompt Generation Service
 * Generates detailed, varied prompts for quiz questions
 */

import { QUESTION_TYPES } from '../config/constants.js';

/**
 * Generate detailed prompts for questions using AI reasoning
 * This creates specific sub-learning objectives and detailed prompts for each question
 */
export async function generateDetailedPrompts(learningObjective, questionType, totalQuestions) {
  console.log(`🧠 Generating ${totalQuestions} detailed prompts for ${questionType} questions`);
  console.log(`📝 Learning Objective: ${learningObjective}`);

  const prompts = [];
  
  // Generate sub-learning objectives that break down the main LO into specific knowledge points
  const subObjectives = await generateSubLearningObjectives(learningObjective, totalQuestions, questionType);
  
  // Create detailed prompts for each sub-objective
  for (let i = 0; i < totalQuestions; i++) {
    const subObjective = subObjectives[i];
    const detailedPrompt = await generateSpecificPrompt(learningObjective, subObjective, questionType, i + 1);
    
    prompts.push({
      index: i,
      subObjective: subObjective,
      detailedPrompt: detailedPrompt,
      focusArea: extractFocusArea(subObjective),
      complexity: determineComplexity(subObjective, questionType)
    });
    
    console.log(`✅ Generated prompt ${i + 1}: ${subObjective.substring(0, 50)}...`);
  }
  
  return prompts;
}

/**
 * Generate sub-learning objectives that cover different knowledge points
 */
async function generateSubLearningObjectives(mainObjective, count, questionType) {
  // AI-powered sub-objective generation logic
  // This simulates what would be an LLM call to break down the main objective
  
  const subObjectives = [];
  const knowledgeAspects = analyzeKnowledgeAspects(mainObjective, questionType);
  
  for (let i = 0; i < count; i++) {
    const aspect = knowledgeAspects[i % knowledgeAspects.length];
    const subObjective = generateSubObjectiveText(mainObjective, aspect, i);
    subObjectives.push(subObjective);
  }
  
  return subObjectives;
}

/**
 * Analyze the main learning objective to identify different knowledge aspects
 */
function analyzeKnowledgeAspects(objective, questionType) {
  const baseAspects = [
    'conceptual understanding',
    'practical application', 
    'analytical thinking',
    'synthesis and evaluation',
    'problem-solving approach',
    'real-world relevance',
    'theoretical foundation',
    'comparative analysis'
  ];
  
  // Customize aspects based on question type
  const typeSpecificAspects = {
    [QUESTION_TYPES.MULTIPLE_CHOICE]: [
      'distinguishing between concepts',
      'identifying correct principles',
      'recognizing patterns',
      'applying knowledge to scenarios'
    ],
    [QUESTION_TYPES.TRUE_FALSE]: [
      'verifying factual accuracy',
      'understanding cause-effect relationships',
      'recognizing misconceptions',
      'validating principles'
    ],
    [QUESTION_TYPES.FLASHCARD]: [
      'memorizing key terms',
      'understanding definitions',
      'recalling important facts',
      'connecting concepts'
    ]
  };
  
  return [...baseAspects, ...(typeSpecificAspects[questionType] || [])];
}

/**
 * Generate specific sub-objective text
 */
function generateSubObjectiveText(mainObjective, aspect, index) {
  const variations = [
    `Focus on ${aspect} within the context of: ${mainObjective}`,
    `Examine how ${aspect} relates to: ${mainObjective}`,
    `Demonstrate ${aspect} by applying knowledge of: ${mainObjective}`,
    `Analyze ${aspect} as it pertains to: ${mainObjective}`,
    `Evaluate ${aspect} in the framework of: ${mainObjective}`,
    `Synthesize understanding of ${aspect} with: ${mainObjective}`,
    `Apply ${aspect} to solve problems related to: ${mainObjective}`,
    `Compare different approaches to ${aspect} within: ${mainObjective}`
  ];
  
  return variations[index % variations.length];
}

/**
 * Generate specific, detailed prompt for question creation
 */
async function generateSpecificPrompt(mainObjective, subObjective, questionType, questionNumber) {
  const promptTemplates = {
    [QUESTION_TYPES.MULTIPLE_CHOICE]: [
      `Create a multiple-choice question that tests ${subObjective}. The question should require students to demonstrate deep understanding rather than simple recall. Include one clearly correct answer and three plausible distractors that represent common misconceptions or partial understanding. Focus on higher-order thinking skills.`,
      
      `Design a multiple-choice question that challenges students to apply their knowledge of ${subObjective}. Present a realistic scenario or problem where students must choose the best solution. Ensure distractors are pedagogically sound and help identify specific learning gaps.`,
      
      `Generate a multiple-choice question that requires students to analyze and evaluate different aspects of ${subObjective}. The question should test critical thinking and the ability to distinguish between similar concepts. Include explanatory feedback for each option.`,
      
      `Develop a multiple-choice question that assesses students' ability to synthesize information related to ${subObjective}. Create a complex scenario that requires integration of multiple concepts. Design distractors that test specific sub-skills within the broader learning objective.`
    ],
    
    [QUESTION_TYPES.TRUE_FALSE]: [
      `Create a true/false question that tests nuanced understanding of ${subObjective}. The statement should require careful consideration and deep knowledge to answer correctly. Avoid obvious or trivial statements that can be guessed easily.`,
      
      `Design a true/false question that addresses common misconceptions about ${subObjective}. The statement should help students identify and correct their understanding of key concepts. Include detailed explanation of why the statement is true or false.`,
      
      `Generate a true/false question that tests the application of principles related to ${subObjective}. Create a statement that requires students to think through cause-and-effect relationships or logical implications.`,
      
      `Develop a true/false question that challenges students to evaluate the validity of claims about ${subObjective}. The statement should require analytical thinking and deep conceptual understanding.`
    ],
    
    [QUESTION_TYPES.FLASHCARD]: [
      `Create a flashcard that helps students memorize and understand key aspects of ${subObjective}. The front should pose a clear, specific question and the back should provide a comprehensive answer that aids long-term retention.`,
      
      `Design a flashcard that connects theoretical knowledge with practical applications of ${subObjective}. Structure it to help students see relationships between concepts and real-world usage.`,
      
      `Generate a flashcard that tests students' ability to recall and explain important details about ${subObjective}. Include context that helps students understand when and how to apply this knowledge.`,
      
      `Develop a flashcard that reinforces understanding of ${subObjective} through active recall. Create prompts that encourage students to think beyond simple memorization to deeper comprehension.`
    ]
  };
  
  const templates = promptTemplates[questionType] || promptTemplates[QUESTION_TYPES.MULTIPLE_CHOICE];
  const templateIndex = (questionNumber - 1) % templates.length;
  
  return templates[templateIndex];
}

/**
 * Extract the main focus area from a sub-objective
 */
function extractFocusArea(subObjective) {
  const focusKeywords = [
    'conceptual understanding', 'practical application', 'analytical thinking',
    'synthesis', 'evaluation', 'problem-solving', 'real-world relevance',
    'theoretical foundation', 'comparative analysis'
  ];
  
  for (const keyword of focusKeywords) {
    if (subObjective.toLowerCase().includes(keyword)) {
      return keyword;
    }
  }
  
  return 'general knowledge';
}

/**
 * Determine the complexity level of a question based on sub-objective
 */
function determineComplexity(subObjective, questionType) {
  const complexityIndicators = {
    high: ['synthesis', 'evaluation', 'analysis', 'compare', 'evaluate', 'synthesize'],
    medium: ['application', 'apply', 'demonstrate', 'solve', 'use'],
    low: ['recall', 'memorize', 'identify', 'define', 'list']
  };
  
  const lowerText = subObjective.toLowerCase();
  
  for (const [level, indicators] of Object.entries(complexityIndicators)) {
    if (indicators.some(indicator => lowerText.includes(indicator))) {
      return level;
    }
  }
  
  return 'medium'; // default
}

/**
 * Generate content based on detailed prompt (this would interface with LLM)
 */
export async function generateQuestionFromPrompt(detailedPrompt, questionType, subObjective) {
  console.log(`🎯 Generating ${questionType} question from detailed prompt`);
  console.log(`📋 Sub-objective: ${subObjective}`);
  
  // This would be replaced with actual LLM call using the detailed prompt
  // For now, return enhanced template-based content that incorporates the sub-objective
  
  const promptBasedContent = await simulateLLMGeneration(detailedPrompt, questionType, subObjective);
  
  return {
    questionText: promptBasedContent.questionText,
    content: promptBasedContent.content,
    correctAnswer: promptBasedContent.correctAnswer,
    explanation: promptBasedContent.explanation,
    generationMetadata: {
      llmModel: 'llama3.1:8b',
      detailedPrompt: detailedPrompt,
      subObjective: subObjective,
      generationMethod: 'AI-enhanced-prompting',
      confidence: 0.9,
      processingTime: 2000
    }
  };
}

/**
 * Simulate LLM generation with enhanced variety based on detailed prompts
 */
async function simulateLLMGeneration(detailedPrompt, questionType, subObjective) {
  // Extract key concepts from the sub-objective for varied content generation
  const keyWords = extractKeywords(subObjective);
  const focusArea = extractFocusArea(subObjective);
  
  switch (questionType) {
    case QUESTION_TYPES.MULTIPLE_CHOICE:
      return generateEnhancedMultipleChoice(subObjective, keyWords, focusArea);
    case QUESTION_TYPES.TRUE_FALSE:
      return generateEnhancedTrueFalse(subObjective, keyWords, focusArea);
    case QUESTION_TYPES.FLASHCARD:
      return generateEnhancedFlashcard(subObjective, keyWords, focusArea);
    default:
      return generateEnhancedMultipleChoice(subObjective, keyWords, focusArea);
  }
}

function extractKeywords(text) {
  const words = text.toLowerCase().split(' ');
  const stopWords = ['the', 'of', 'to', 'and', 'a', 'in', 'is', 'it', 'that', 'for', 'as', 'with', 'by'];
  return words.filter(word => word.length > 3 && !stopWords.includes(word));
}

function generateEnhancedMultipleChoice(subObjective, keyWords, focusArea) {
  const questionStarters = [
    `When considering ${focusArea}, which approach best demonstrates`,
    `In the context of ${focusArea}, what is the most effective way to`,
    `How does ${focusArea} influence your understanding of`,
    `Which statement best reflects the relationship between ${focusArea} and`
  ];
  
  const starter = questionStarters[Math.floor(Math.random() * questionStarters.length)];
  
  return {
    questionText: `${starter} the principles outlined in: ${subObjective}?`,
    content: {
      options: [
        { text: `Comprehensive application of ${focusArea} principles`, isCorrect: true, order: 0 },
        { text: `Partial understanding of ${focusArea} concepts`, isCorrect: false, order: 1 },
        { text: `Common misconception about ${focusArea}`, isCorrect: false, order: 2 },
        { text: `Incorrect approach to ${focusArea}`, isCorrect: false, order: 3 }
      ]
    },
    correctAnswer: `Comprehensive application of ${focusArea} principles`,
    explanation: `This option correctly demonstrates mastery of ${focusArea} as it relates to: ${subObjective}`
  };
}

function generateEnhancedTrueFalse(subObjective, keyWords, focusArea) {
  const statements = [
    `Mastering ${focusArea} requires deep understanding of the concepts in: ${subObjective}`,
    `The principles underlying ${focusArea} directly support the learning goal: ${subObjective}`,
    `Effective application of ${focusArea} is demonstrated through: ${subObjective}`,
    `Students who understand ${focusArea} will be able to achieve: ${subObjective}`
  ];
  
  const statement = statements[Math.floor(Math.random() * statements.length)];
  
  return {
    questionText: `True or False: ${statement}`,
    content: {
      options: [
        { text: "True", isCorrect: true, order: 0 },
        { text: "False", isCorrect: false, order: 1 }
      ]
    },
    correctAnswer: "True",
    explanation: `This statement is true because ${focusArea} is fundamental to achieving: ${subObjective}`
  };
}

function generateEnhancedFlashcard(subObjective, keyWords, focusArea) {
  const frontTemplates = [
    `How does ${focusArea} relate to this learning goal?`,
    `What key principles support this objective?`,
    `How would you demonstrate mastery of this concept?`,
    `What makes this learning objective important?`
  ];
  
  const front = frontTemplates[Math.floor(Math.random() * frontTemplates.length)];
  
  return {
    questionText: "Review this concept",
    content: {
      front: front,
      back: `${subObjective}\n\nKey focus: ${focusArea}`
    },
    correctAnswer: subObjective,
    explanation: `This flashcard reinforces understanding of ${focusArea} within the context of: ${subObjective}`
  };
}