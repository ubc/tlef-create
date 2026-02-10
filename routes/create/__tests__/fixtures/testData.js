// Test data fixtures for consistent testing
export const testUsers = {
  instructor1: {
    cwlId: 'instructor1',
    password: 'TestPass123'
  },
  instructor2: {
    cwlId: 'instructor2', 
    password: 'TestPass456'
  },
  student: {
    cwlId: 'student1',
    password: 'StudentPass123'
  }
};

export const testFolders = {
  folder1: {
    name: 'Computer Science 101'
  },
  folder2: {
    name: 'Advanced Algorithms'
  },
  emptyFolder: {
    name: 'Empty Test Folder'
  }
};

export const testMaterials = {
  textMaterial: {
    name: 'Introduction to Programming',
    type: 'TEXT',
    content: 'Programming is the process of creating a set of instructions that tell a computer how to perform a task. Programming can be done using a variety of computer programming languages.'
  },
  urlMaterial: {
    name: 'Python Documentation',
    type: 'URL',
    url: 'https://docs.python.org/3/'
  },
  duplicateContent: {
    name: 'Duplicate Test Material',
    type: 'TEXT',
    content: 'This content will be duplicated to test duplicate detection.'
  }
};

export const testQuizzes = {
  draftQuiz: {
    name: 'Basic Programming Quiz',
    status: 'DRAFT'
  },
  publishedQuiz: {
    name: 'Algorithms Assessment',
    status: 'PUBLISHED'
  },
  configuredQuiz: {
    name: 'Advanced Quiz',
    status: 'DRAFT',
    settings: {
      pedagogicalApproach: 'CONSTRUCTIVIST',
      questionsPerObjective: 5
    }
  }
};

export const testLearningObjectives = {
  objective1: {
    text: 'Students will understand basic programming concepts',
    order: 0
  },
  objective2: {
    text: 'Students will be able to write simple Python functions',
    order: 1
  },
  objective3: {
    text: 'Students will demonstrate knowledge of data structures',
    order: 2
  }
};

export const testQuestions = {
  multipleChoice: {
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    questionText: 'What is the output of print("Hello, World!")?',
    options: [
      { text: 'Hello, World!', isCorrect: true },
      { text: '"Hello, World!"', isCorrect: false },
      { text: 'Error', isCorrect: false },
      { text: 'Nothing', isCorrect: false }
    ]
  },
  trueFalse: {
    type: 'TRUE_FALSE',
    difficulty: 'EASY',
    questionText: 'Python is a compiled programming language.',
    options: [
      { text: 'True', isCorrect: false },
      { text: 'False', isCorrect: true }
    ]
  },
  shortAnswer: {
    type: 'SHORT_ANSWER',
    difficulty: 'HARD',
    questionText: 'Explain the difference between a list and a tuple in Python.',
    correctAnswer: 'Lists are mutable while tuples are immutable. Lists use square brackets [] while tuples use parentheses ().'
  }
};

export const testGenerationPlans = {
  basicPlan: {
    approach: 'BLOOM_TAXONOMY',
    questionsPerLO: 3,
    distribution: {
      easy: 30,
      medium: 50,
      hard: 20
    }
  },
  constructivistPlan: {
    approach: 'CONSTRUCTIVIST',
    questionsPerLO: 5,
    distribution: {
      easy: 20,
      medium: 60,
      hard: 20
    }
  }
};

// Helper functions for test data creation
export const createTestUserData = (userType = 'instructor1') => {
  return { ...testUsers[userType] };
};

export const createTestFolderData = (folderType = 'folder1') => {
  return { ...testFolders[folderType] };
};

export const createTestMaterialData = (materialType = 'textMaterial') => {
  return { ...testMaterials[materialType] };
};

export const createTestQuizData = (quizType = 'draftQuiz') => {
  return { ...testQuizzes[quizType] };
};

// Generate unique names for testing
export const generateUniqueName = (baseName) => {
  return `${baseName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Export test fixtures — matches Question model schema (lowercase types, content field)
export const testExportQuestions = {
  multipleChoice: {
    type: 'multiple-choice',
    difficulty: 'moderate',
    questionText: 'What is 2 + 2?',
    content: {
      options: [
        { text: '3', isCorrect: false },
        { text: '4', isCorrect: true },
        { text: '5', isCorrect: false },
        { text: '6', isCorrect: false }
      ]
    },
    correctAnswer: '4',
    reviewStatus: 'approved',
    order: 0
  },
  trueFalse: {
    type: 'true-false',
    difficulty: 'easy',
    questionText: 'The Earth orbits the Sun.',
    correctAnswer: 'true',
    reviewStatus: 'approved',
    order: 1
  },
  flashcard: {
    type: 'flashcard',
    difficulty: 'easy',
    questionText: 'What is DNA?',
    content: {
      front: 'What is DNA?',
      back: 'Deoxyribonucleic acid, the molecule that carries genetic information.'
    },
    correctAnswer: 'Deoxyribonucleic acid',
    reviewStatus: 'approved',
    order: 2
  },
  matching: {
    type: 'matching',
    difficulty: 'moderate',
    questionText: 'Match each country to its capital city.',
    content: {
      leftItems: ['France', 'Germany', 'Japan'],
      rightItems: ['Paris', 'Berlin', 'Tokyo'],
      matchingPairs: [['France', 'Paris'], ['Germany', 'Berlin'], ['Japan', 'Tokyo']]
    },
    reviewStatus: 'approved',
    order: 3
  },
  ordering: {
    type: 'ordering',
    difficulty: 'hard',
    questionText: 'Order these animals from smallest to largest.',
    content: {
      items: ['Ant', 'Dog', 'Elephant'],
      correctOrder: ['Ant', 'Dog', 'Elephant']
    },
    reviewStatus: 'approved',
    order: 4
  },
  cloze: {
    type: 'cloze',
    difficulty: 'moderate',
    questionText: 'The capital of France is Paris.',
    content: {
      textWithBlanks: 'The capital of $$ is $$.',
      blankOptions: [['France', 'Germany', 'Spain'], ['Paris', 'Berlin', 'Madrid']],
      correctAnswers: ['France', 'Paris']
    },
    reviewStatus: 'approved',
    order: 5
  },
  discussion: {
    type: 'discussion',
    difficulty: 'hard',
    questionText: 'Discuss the impact of artificial intelligence on modern education.',
    reviewStatus: 'approved',
    order: 6
  },
  summary: {
    type: 'summary',
    difficulty: 'easy',
    questionText: 'Key concepts review',
    content: {
      keyPoints: [
        { title: 'Concept A', explanation: 'Explanation of concept A in detail.' },
        { title: 'Concept B', explanation: 'Explanation of concept B in detail.' }
      ]
    },
    reviewStatus: 'approved',
    order: 7
  }
};

// Common test scenarios
export const testScenarios = {
  // Authentication scenarios
  validCredentials: testUsers.instructor1,
  invalidPassword: { ...testUsers.instructor1, password: 'wrongpassword' },
  nonExistentUser: { cwlId: 'nonexistent', password: 'TestPass123' },
  
  // Validation scenarios
  emptyName: { name: '' },
  longName: { name: 'a'.repeat(300) },
  invalidEmail: { email: 'invalid-email' },
  weakPassword: { password: '123' },
  
  // Permission scenarios
  // Note: This API uses SAML session-based authentication, not JWT tokens
  // These test constants are kept for potential future JWT implementation
  unauthorizedAccess: 'no-session',
  invalidSession: 'invalid-session-data',
  expiredSession: 'expired-session-data'
};