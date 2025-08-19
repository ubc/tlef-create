export default {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    '**/*.js',
    '!**/*.test.js',
    '!**/node_modules/**',
    '!server.js',
    '!test-server.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  verbose: true
};