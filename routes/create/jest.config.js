export default {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  transform: {}, // Use Node's native ESM support
  collectCoverageFrom: [
    '**/*.js',
    '!**/*.test.js',
    '!**/node_modules/**',
    '!server.js',
    '!test-server.js',
    '!jest.config.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  verbose: true,
  testTimeout: 10000 // 10 seconds for integration tests
};