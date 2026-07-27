export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['<rootDir>/__tests__/unit/**/*.test.js'],
  testPathIgnorePatterns: [
    '<rootDir>/__tests__/unit/helpInteraction.test.js',
    '<rootDir>/__tests__/unit/quizPlanItemValidation.test.js'
  ],
  verbose: true
};
