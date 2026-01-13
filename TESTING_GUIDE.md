# Testing Guide for TLEF-CREATE

## Overview

This project uses **Jest** for backend testing. Tests are organized into **unit tests** and **integration tests**.

## Test Types Explained

### 1. Unit Tests 🧪
**What:** Test individual functions/components in isolation
**Speed:** Fast (milliseconds)
**Location:** `routes/create/__tests__/unit/`

**Example:**
```javascript
test('should generate 6-character course code', () => {
  const code = generateCourseCode();
  expect(code.length).toBe(6);
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
});
```

**When to write:**
- Testing utility functions
- Testing data transformations
- Testing validation logic
- Testing formatters/parsers

### 2. Integration Tests 🔗
**What:** Test how multiple components work together
**Speed:** Medium (seconds)
**Location:** `routes/create/__tests__/integration/`

**Example:**
```javascript
test('should upload file and trigger RAG processing', async () => {
  const response = await request(app)
    .post('/api/materials/upload')
    .set('Authorization', `Bearer ${authToken}`)
    .attach('files', 'test.pdf')
    .field('folderId', folderId)
    .expect(201);

  expect(response.body.data.materials[0].processingStatus).toBe('processing');

  // Verify in database
  const material = await Material.findById(response.body.data.materials[0]._id);
  expect(material).toBeTruthy();
});
```

**When to write:**
- Testing API endpoints
- Testing database operations
- Testing authentication flows
- Testing file uploads
- Testing RAG processing pipeline

### 3. End-to-End (E2E) Tests 🎭
**What:** Test complete user workflows from browser
**Speed:** Slow (minutes)
**Status:** Not implemented yet

**Example (would use Playwright/Cypress):**
```javascript
test('Instructor creates course with materials', async () => {
  await page.goto('http://localhost:5173');
  await page.click('button:has-text("Create Course")');
  await page.fill('input[name="courseName"]', 'EOSC 533');
  await page.click('button:has-text("Next")');
  await page.setInputFiles('input[type="file"]', 'lecture1.pdf');
  await page.click('button:has-text("Create Course")');
  await expect(page.locator('text=EOSC 533')).toBeVisible();
});
```

**When to write:**
- Testing critical user journeys
- Testing across frontend + backend
- Testing real browser interactions

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode (auto-rerun on changes)
```bash
npm run test:watch
```

### Run tests with coverage report
```bash
npm run test:coverage
```

### Run specific test file
```bash
NODE_OPTIONS='--experimental-vm-modules' jest routes/create/__tests__/unit/responseFormatter.test.js
```

### Run tests matching a pattern
```bash
NODE_OPTIONS='--experimental-vm-modules' jest --testNamePattern="should create text material"
```

## Test Structure

### Anatomy of a Test

```javascript
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

describe('Feature Name', () => {
  // Setup before each test
  beforeEach(async () => {
    // Clean database
    await Material.deleteMany({});
  });

  // Cleanup after each test
  afterEach(async () => {
    // Close connections, etc.
  });

  describe('Specific Functionality', () => {
    test('should do something specific', async () => {
      // Arrange: Set up test data
      const testData = { name: 'Test' };

      // Act: Perform the action
      const result = await someFunction(testData);

      // Assert: Verify the result
      expect(result).toBe(expected);
    });
  });
});
```

## Writing Good Tests

### ✅ DO:
- **Test behavior, not implementation**
  ```javascript
  // Good
  expect(response.body.data.material.name).toBe('Test Material');

  // Bad
  expect(material._saveCalled).toBe(true);
  ```

- **Use descriptive test names**
  ```javascript
  // Good
  test('should reject duplicate files with same checksum')

  // Bad
  test('test 1')
  ```

- **Follow AAA pattern: Arrange, Act, Assert**
  ```javascript
  test('should calculate total price', () => {
    // Arrange
    const items = [{ price: 10 }, { price: 20 }];

    // Act
    const total = calculateTotal(items);

    // Assert
    expect(total).toBe(30);
  });
  ```

- **Test edge cases**
  ```javascript
  test('should handle empty material list');
  test('should handle null input');
  test('should handle very large files');
  ```

### ❌ DON'T:
- Don't test implementation details
- Don't write tests that depend on execution order
- Don't use real external services (mock them)
- Don't ignore test failures

## Current Test Coverage

### Backend Tests ✅

**Unit Tests:**
- ✅ Response formatters (successResponse, errorResponse, etc.)
- ✅ Async handler utility
- ⚠️ Missing: Course code generation
- ⚠️ Missing: RAG utility functions
- ⚠️ Missing: File validation

**Integration Tests:**
- ✅ Authentication (register, login, token refresh)
- ✅ Folders (create, get, update, delete)
- ✅ Materials (upload files, add URL, add text)
- ✅ Quizzes (create, get, update, delete)
- ⚠️ Missing: Learning objectives API
- ⚠️ Missing: Question generation API
- ⚠️ Missing: Streaming SSE endpoints
- ⚠️ Missing: RAG processing pipeline

### Frontend Tests ❌
- ❌ No React component tests yet
- ❌ No React hook tests
- ❌ No UI interaction tests

**Recommendation:** Add frontend tests using:
- **Vitest** (faster than Jest for Vite projects)
- **React Testing Library** (for component testing)

## Example: Writing a New Test

### Unit Test Example

Create: `routes/create/__tests__/unit/courseCode.test.js`

```javascript
import { describe, test, expect } from '@jest/globals';
import { generateCourseCode } from '../../utils/courseCode.js';

describe('Course Code Generation', () => {
  test('should generate 6-character code', () => {
    const code = generateCourseCode();
    expect(code).toHaveLength(6);
  });

  test('should only contain valid characters', () => {
    const code = generateCourseCode();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(code).not.toMatch(/[IO01]/); // No confusing chars
  });

  test('should generate unique codes', () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
      codes.add(generateCourseCode());
    }
    expect(codes.size).toBe(100); // All unique
  });
});
```

### Integration Test Example

Create: `routes/create/__tests__/integration/ragProcessing.test.js`

```javascript
import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../server.js';
import Material from '../../models/Material.js';

describe('RAG Processing Integration', () => {
  let authToken;
  let folderId;

  beforeEach(async () => {
    // Setup auth and folder
  });

  test('should process uploaded file through RAG pipeline', async () => {
    const response = await request(app)
      .post('/api/materials/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('files', Buffer.from('test content'), 'test.pdf')
      .field('folderId', folderId)
      .expect(201);

    const materialId = response.body.data.materials[0]._id;

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check material status
    const material = await Material.findById(materialId);
    expect(material.processingStatus).toBe('completed');
    expect(material.qdrantDocumentId).toBeDefined();
  }, 10000); // 10 second timeout for slow processing
});
```

## Mocking External Services

### Mock Database
```javascript
import { jest } from '@jest/globals';

// Mock mongoose
jest.mock('mongoose', () => ({
  connect: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(true)
}));
```

### Mock RAG Service
```javascript
jest.mock('../../services/ragService.js', () => ({
  default: {
    processAndEmbedMaterial: jest.fn().mockResolvedValue({
      success: true,
      chunksCount: 5
    })
  }
}));
```

### Mock LLM Service
```javascript
jest.mock('../../services/llmService.js', () => ({
  default: {
    generateQuestion: jest.fn().mockResolvedValue({
      questionData: {
        questionText: 'Mock question?',
        options: ['A', 'B', 'C', 'D']
      }
    })
  }
}));
```

## Test Database Setup

For integration tests, use a separate test database:

```javascript
// __tests__/setup.js
import mongoose from 'mongoose';

const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/tlef-test';

beforeAll(async () => {
  await mongoose.connect(MONGODB_TEST_URI);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});
```

## Continuous Integration (CI)

Add to your GitHub Actions workflow:

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mongodb:
        image: mongo:7
        ports:
          - 27017:27017

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

## Common Jest Matchers

```javascript
// Equality
expect(value).toBe(4);              // Strict equality (===)
expect(obj).toEqual({ a: 1 });      // Deep equality

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeDefined();

// Numbers
expect(value).toBeGreaterThan(3);
expect(value).toBeLessThan(5);

// Strings
expect(str).toMatch(/pattern/);
expect(str).toContain('substring');

// Arrays
expect(arr).toHaveLength(3);
expect(arr).toContain(item);

// Objects
expect(obj).toHaveProperty('key');
expect(obj).toMatchObject({ a: 1 });

// Async
await expect(promise).resolves.toBe(value);
await expect(promise).rejects.toThrow(Error);

// Functions
expect(fn).toThrow();
expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledWith(arg1, arg2);
```

## Debugging Tests

### Run specific test
```bash
npm test -- --testNamePattern="should create text material"
```

### Run with verbose output
```bash
npm test -- --verbose
```

### Run with debug logging
```bash
DEBUG=* npm test
```

### Use Node debugger
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

Then open `chrome://inspect` in Chrome.

## Next Steps

1. ✅ **Backend unit tests** - Already have some, expand coverage
2. ✅ **Backend integration tests** - Already have some, expand coverage
3. ⚠️ **Add frontend tests** - Set up Vitest + React Testing Library
4. ⚠️ **Add E2E tests** - Set up Playwright for critical workflows
5. ⚠️ **CI/CD integration** - Run tests on every commit

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/ladjs/supertest)
- [React Testing Library](https://testing-library.com/react)
- [Playwright](https://playwright.dev/)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
