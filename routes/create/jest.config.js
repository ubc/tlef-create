export default {
  collectCoverageFrom: [
    '**/*.js',
    '!**/*.test.js',
    '!**/node_modules/**',
    '!server.js',
    '!test-server.js'
  ],
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: {},
      testMatch: ['<rootDir>/__tests__/unit/**/*.test.js'],
      testPathIgnorePatterns: [
        '<rootDir>/__tests__/unit/helpInteraction.test.js',
        '<rootDir>/__tests__/unit/quizPlanItemValidation.test.js'
      ]
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      transform: {},
      testMatch: [
        '<rootDir>/__tests__/integration/**/*.test.js',
        '<rootDir>/__tests__/unit/helpInteraction.test.js',
        '<rootDir>/__tests__/unit/quizPlanItemValidation.test.js'
      ],
      testPathIgnorePatterns: [
        '<rootDir>/__tests__/integration/questionGenerationIndexMigration.test.js',
        '<rootDir>/__tests__/integration/questionGenerationRecovery.test.js',
        '<rootDir>/__tests__/integration/studioAssistantService.test.js',
        '<rootDir>/__tests__/integration/studioJobRecovery.test.js'
      ],
      setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js']
    },
    {
      displayName: 'isolated',
      testEnvironment: 'node',
      transform: {},
      testMatch: [
        '<rootDir>/__tests__/integration/questionGenerationIndexMigration.test.js',
        '<rootDir>/__tests__/integration/questionGenerationRecovery.test.js',
        '<rootDir>/__tests__/integration/studioAssistantService.test.js',
        '<rootDir>/__tests__/integration/studioJobRecovery.test.js'
      ]
    }
  ],
  verbose: true
};
