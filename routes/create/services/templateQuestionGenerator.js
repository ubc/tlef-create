/**
 * Template Question Generator
 * Generates questions with proper content structures for all H5P question types
 * when LLM generation fails or is not available
 */

/**
 * Generate a template question based on learning objective and question type
 */
export function generateTemplateQuestion(learningObjective, questionType, difficulty = 'moderate') {
  const objectiveText = learningObjective.text || learningObjective;
  const sanitizedText = objectiveText.replace(/[^a-zA-Z0-9\s]/g, ' ').substring(0, 100);
  
  switch (questionType) {
    case 'multiple-choice':
      return generateMultipleChoiceTemplate(sanitizedText, difficulty);
    case 'true-false':
      return generateTrueFalseTemplate(sanitizedText, difficulty);
    case 'matching':
      return generateMatchingTemplate(sanitizedText, difficulty);
    case 'ordering':
      return generateOrderingTemplate(sanitizedText, difficulty);
    case 'cloze':
      return generateClozeTemplate(sanitizedText, difficulty);
    case 'flashcard':
      return generateFlashcardTemplate(sanitizedText, difficulty);
    case 'summary':
      return generateSummaryTemplate(sanitizedText, difficulty);
    case 'discussion':
      return generateDiscussionTemplate(sanitizedText, difficulty);
    case 'single-choice-set':
      return generateSingleChoiceSetTemplate(sanitizedText, difficulty);
    default:
      return generateMultipleChoiceTemplate(sanitizedText, difficulty);
  }
}

function generateMultipleChoiceTemplate(objective, difficulty) {
  return {
    questionText: `Which of the following best describes ${objective}?`,
    content: {
      options: [
        { text: "Option A: Primary concept related to the objective", isCorrect: true },
        { text: "Option B: Related but incorrect concept", isCorrect: false },
        { text: "Option C: Common misconception", isCorrect: false },
        { text: "Option D: Unrelated concept", isCorrect: false }
      ]
    },
    correctAnswer: "Option A: Primary concept related to the objective",
    explanation: `This option correctly represents the key concept in ${objective}.`,
    difficulty: difficulty,
    type: 'multiple-choice'
  };
}

function generateTrueFalseTemplate(objective, difficulty) {
  return {
    questionText: `True or False: ${objective} is essential for understanding this concept.`,
    content: {
      statement: `${objective} is essential for understanding this concept.`,
      correct: true
    },
    correctAnswer: true,
    explanation: `This statement is true because ${objective} forms the foundation of the concept.`,
    difficulty: difficulty,
    type: 'true-false'
  };
}

function generateMatchingTemplate(objective, difficulty) {
  const concepts = extractConcepts(objective);
  
  return {
    questionText: `Match the following concepts related to ${objective}:`,
    content: {
      leftItems: [
        concepts.primary || "Primary Concept",
        concepts.secondary || "Secondary Concept", 
        concepts.application || "Application",
        concepts.example || "Example"
      ],
      rightItems: [
        "Definition of primary concept",
        "Definition of secondary concept",
        "Practical use case",
        "Real-world example",
        "Distractor item"
      ],
      matchingPairs: [
        [concepts.primary || "Primary Concept", "Definition of primary concept"],
        [concepts.secondary || "Secondary Concept", "Definition of secondary concept"],
        [concepts.application || "Application", "Practical use case"],
        [concepts.example || "Example", "Real-world example"]
      ]
    },
    difficulty: difficulty,
    type: 'matching'
  };
}

function generateOrderingTemplate(objective, difficulty) {
  return {
    questionText: `Arrange the following steps related to ${objective} in the correct order:`,
    content: {
      items: [
        "Step 1: Initial understanding",
        "Step 2: Analysis and evaluation", 
        "Step 3: Application of concepts",
        "Step 4: Synthesis and conclusion"
      ],
      correctOrder: [
        "Step 1: Initial understanding",
        "Step 2: Analysis and evaluation",
        "Step 3: Application of concepts", 
        "Step 4: Synthesis and conclusion"
      ]
    },
    difficulty: difficulty,
    type: 'ordering'
  };
}

function generateClozeTemplate(objective, difficulty) {
  const keyTerms = extractKeyTerms(objective);
  
  return {
    questionText: `Fill in the blanks about ${objective}:`,
    content: {
      textWithBlanks: `Understanding [blank] involves recognizing its [blank] and applying it to [blank] situations.`,
      correctAnswers: [
        keyTerms.primary || "the concept",
        keyTerms.characteristic || "key principles", 
        keyTerms.context || "practical"
      ],
      blankOptions: [
        [keyTerms.primary || "the concept", "misconception", "unrelated term"],
        [keyTerms.characteristic || "key principles", "wrong principles", "irrelevant facts"],
        [keyTerms.context || "practical", "theoretical", "abstract"]
      ]
    },
    difficulty: difficulty,
    type: 'cloze'
  };
}

function generateFlashcardTemplate(objective, difficulty) {
  return {
    questionText: `Flashcard: ${objective}`,
    content: {
      front: `What is ${objective}?`,
      back: `${objective} refers to the key concepts and principles that students need to understand and apply in practical situations.`
    },
    correctAnswer: `${objective} refers to the key concepts and principles that students need to understand and apply in practical situations.`,
    difficulty: difficulty,
    type: 'flashcard'
  };
}

function generateSummaryTemplate(objective, difficulty) {
  return {
    questionText: `Summary of ${objective}`,
    content: {
      panels: [
        {
          title: "Key Concepts",
          content: `The main concepts related to ${objective} include fundamental principles and their applications.`
        },
        {
          title: "Important Details", 
          content: `Critical details that support understanding of ${objective} and its implementation.`
        },
        {
          title: "Applications",
          content: `Practical applications and real-world uses of ${objective} in various contexts.`
        }
      ]
    },
    difficulty: difficulty,
    type: 'summary'
  };
}

function generateDiscussionTemplate(objective, difficulty) {
  return {
    questionText: `Discuss the implications of ${objective}. Consider how this concept affects real-world applications and what challenges might arise in its implementation. Share your thoughts and engage with your classmates' perspectives.`,
    content: {
      prompt: `Discuss the implications of ${objective}`,
      guidelines: "Consider real-world applications and implementation challenges"
    },
    difficulty: difficulty,
    type: 'discussion'
  };
}

function generateSingleChoiceSetTemplate(objective, difficulty) {
  return {
    questionText: `Quick question about ${objective}:`,
    content: {
      options: [
        { text: "Correct answer related to objective", isCorrect: true },
        { text: "Plausible but incorrect option", isCorrect: false },
        { text: "Common misconception", isCorrect: false },
        { text: "Unrelated distractor", isCorrect: false }
      ]
    },
    correctAnswer: "Correct answer related to objective",
    explanation: `This is correct because it accurately represents ${objective}.`,
    difficulty: difficulty,
    type: 'single-choice-set'
  };
}

// Helper functions to extract concepts and terms from objectives
function extractConcepts(objective) {
  const words = objective.toLowerCase().split(' ').filter(word => word.length > 3);
  
  return {
    primary: words[0] || "concept",
    secondary: words[1] || "principle", 
    application: words[2] || "application",
    example: words[3] || "example"
  };
}

function extractKeyTerms(objective) {
  const words = objective.toLowerCase().split(' ').filter(word => word.length > 3);
  
  return {
    primary: words[0] || "concept",
    characteristic: words[1] || "principle",
    context: words[2] || "context"
  };
}