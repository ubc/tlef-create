# TLEF-CREATE API Tests

This directory contains comprehensive test suites for the TLEF-CREATE backend API.

## 🚨 Important Authentication Note

**This API uses SAML session-based authentication, NOT JWT tokens.**

Current test status:
- ✅ `auth.test.js` - Updated for SAML endpoints
- ⚠️  Other integration tests - Use JWT patterns (may fail with current auth)

The integration tests currently use JWT Bearer token patterns like `.set('Authorization', \`Bearer \${authToken}\`)` which won't work with SAML session authentication. Consider updating tests to use session-based auth or mocking SAML sessions.

## Test Structure

```
__tests__/
├── setup.js                 # Global test configuration and database setup
├── fixtures/                # Test data and helper functions
│   └── testData.js          # Common test data fixtures
├── unit/                    # Unit tests for individual functions/utilities
│   ├── responseFormatter.test.js
│   └── asyncHandler.test.js
└── integration/             # Integration tests for API endpoints
    ├── auth.test.js         # Authentication API tests
    ├── folders.test.js      # Folder management API tests
    ├── materials.test.js    # Material management API tests
    └── quizzes.test.js      # Quiz management API tests
```

## Running Tests

### Prerequisites

1. Ensure MongoDB is running (either via Docker or local installation)
2. Install test dependencies: `npm install`

### Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm test -- __tests__/integration/auth.test.js

# Run tests matching a pattern
npm test -- --testNamePattern="should create"
```

### Environment Setup

Tests use a separate test database to avoid affecting development data:

- Default test database: `mongodb://localhost:27017/tlef_test`
- Override with environment variable: `MONGODB_TEST_URI`

## Test Categories

### Unit Tests

Test individual utility functions and helpers:

- **responseFormatter.test.js**: Tests response formatting utilities
- **asyncHandler.test.js**: Tests async error handling wrapper

### Integration Tests

Test complete API workflows:

- **auth.test.js**: Authentication endpoints (register, login, logout, etc.)
- **folders.test.js**: Folder CRUD operations and permissions
- **materials.test.js**: Material upload, management, and processing
- **quizzes.test.js**: Quiz creation, configuration, and publishing

## Test Data Management

### Database Cleanup

- Database is automatically cleaned before each test
- In-memory collections are cleared after each test case
- Test isolation is maintained between test suites

### Test Fixtures

Common test data is available in `fixtures/testData.js`:

```javascript
import { testUsers, createTestUserData } from '../fixtures/testData.js';

// Use predefined test user
const userData = testUsers.instructor1;

// Create test data with unique names
const userData = createTestUserData('instructor1');
```

## Test Patterns

### Authentication Pattern

```javascript
let authToken;
let userId;

beforeEach(async () => {
  const registerResponse = await request(app)
    .post('/api/auth/register')
    .send(testUsers.instructor1);
  
  authToken = registerResponse.body.data.accessToken;
  userId = registerResponse.body.data.user.id;
});
```

### API Testing Pattern

```javascript
test('should perform action successfully', async () => {
  const response = await request(app)
    .post('/api/endpoint')
    .set('Authorization', `Bearer ${authToken}`)
    .send(testData)
    .expect(200);

  expect(response.body.success).toBe(true);
  expect(response.body.data).toMatchObject(expectedData);
});
```

### Error Testing Pattern

```javascript
test('should reject invalid input', async () => {
  const response = await request(app)
    .post('/api/endpoint')
    .set('Authorization', `Bearer ${authToken}`)
    .send(invalidData)
    .expect(400);

  expect(response.body.success).toBe(false);
  expect(response.body.error.message).toContain('expected error');
});
```

## Coverage Goals

- **Unit Tests**: 100% coverage for utility functions
- **Integration Tests**: Cover all API endpoints and major error scenarios
- **Security Tests**: Authentication, authorization, and input validation
- **Edge Cases**: Boundary conditions and error handling

## Adding New Tests

### For New API Endpoints

1. Add test cases to appropriate integration test file
2. Include positive and negative test scenarios
3. Test authentication and authorization
4. Test input validation and edge cases

### For New Utility Functions

1. Create unit test file in `unit/` directory
2. Test all function behaviors and edge cases
3. Mock external dependencies

### Test Data

Add reusable test data to `fixtures/testData.js` for consistency across tests.

## Debugging Tests

### Common Issues

1. **Database Connection**: Ensure MongoDB is running and accessible
2. **Test Isolation**: Tests should not depend on other test execution order
3. **Async Operations**: Ensure proper async/await usage in tests
4. **Authentication**: Check token validity and user permissions

### Debug Commands

```bash
# Run specific test with detailed output
npm test -- --verbose __tests__/integration/auth.test.js

# Run tests with debugging
node --inspect-brk node_modules/.bin/jest --runInBand

# Check test coverage details
npm run test:coverage -- --verbose
```

## Continuous Integration

Tests are designed to run in CI/CD environments:

- Database setup/teardown is handled automatically
- No external dependencies required beyond MongoDB
- Tests complete within reasonable time limits
- Clear error messages for debugging failures

## Performance Considerations

- Tests use database transactions where possible for speed
- Parallel test execution is supported (use `--runInBand` for debugging)
- Test data is kept minimal while maintaining coverage
- Database operations are optimized for test performance