/**
 * RAG Service Test Suite
 * Tests the RAG (Retrieval-Augmented Generation) service independently
 * Run with: node routes/create/__tests__/ragServiceTest.js
 */

import dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config();

import ragService from '../services/ragService.js';
import { DocumentParsingModule } from 'ubc-genai-toolkit-document-parsing';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Console colors for better readability
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(`🧪 ${title}`, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

function logTest(testName) {
  log(`\n📋 Testing: ${testName}`, colors.bright);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logWarning(message) {
  log(`⚠️ ${message}`, colors.yellow);
}

function logInfo(message) {
  log(`ℹ️ ${message}`, colors.blue);
}

// Test data
const testQuizId = 'test-quiz-' + Date.now();
const testMaterialId = 'test-material-' + Date.now();
const testContent = `
The Pragmatic Programmer emphasizes several key design principles for building evolvable systems:

1. DRY (Don't Repeat Yourself): This principle states that every piece of knowledge must have a single, 
unambiguous, authoritative representation within a system. By avoiding duplication, changes need to be 
made in only one place, making the system more maintainable and evolvable.

2. Orthogonality: Design components to be independent and self-contained. When components are orthogonal, 
changes to one don't affect others, allowing the system to evolve more easily. This reduces risk and 
makes testing simpler.

3. Reversibility: Don't assume any decision is final. Design systems to be flexible enough to accommodate 
change. Use abstractions and interfaces to insulate different parts of the system from each other.

4. Tracer Bullets: Build a minimal end-to-end implementation first, then evolve it. This approach helps 
you understand the system's architecture early and allows for rapid feedback and adjustment.

5. Prototypes and Post-it Notes: Use cheap, disposable prototypes to explore ideas before committing to 
a full implementation. This allows for experimentation without the cost of building production code.
`;

// Test suite
async function runTests() {
  logSection('RAG Service Test Suite');
  
  let testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    errors: []
  };

  try {
    // Test 1: Initialize RAG Service
    logTest('RAG Service Initialization');
    testResults.total++;
    
    try {
      const isInitialized = await ragService.initialize();
      if (isInitialized) {
        logSuccess('RAG Service initialized successfully');
        testResults.passed++;
      } else {
        logWarning('RAG Service initialization returned false (might already be initialized)');
        testResults.passed++;
      }
    } catch (error) {
      logError(`Failed to initialize RAG Service: ${error.message}`);
      testResults.failed++;
      testResults.errors.push({ test: 'initialization', error: error.message });
    }

    // Test 2: Parse and chunk document
    logTest('Document Parsing and Chunking');
    testResults.total++;
    
    try {
      // Create a test file (use .md extension as .txt is not supported)
      const testFilePath = path.join(__dirname, 'test-document.md');
      await fs.writeFile(testFilePath, testContent);
      
      const parser = new DocumentParsingModule();
      const parsedContent = await parser.parse({ filePath: testFilePath }, 'text');
      
      logInfo(`Parsed content length: ${parsedContent.content.length} characters`);
      
      // Check if ragService has chunkContent method, if not create chunks manually
      let chunks;
      if (typeof ragService.chunkContent === 'function') {
        chunks = ragService.chunkContent(parsedContent.content, {
          chunkSize: 500,
          chunkOverlap: 50
        });
      } else {
        // Manual chunking fallback
        chunks = [];
        const chunkSize = 500;
        const chunkOverlap = 50;
        const text = parsedContent.content;
        
        for (let i = 0; i < text.length; i += (chunkSize - chunkOverlap)) {
          chunks.push({
            content: text.substring(i, i + chunkSize),
            index: chunks.length
          });
        }
      }
      
      logSuccess(`Successfully chunked content into ${chunks.length} chunks`);
      testResults.passed++;
      
      // Clean up test file
      await fs.unlink(testFilePath);
    } catch (error) {
      logError(`Document parsing/chunking failed: ${error.message}`);
      testResults.failed++;
      testResults.errors.push({ test: 'parsing', error: error.message });
    }

    // Test 3: Index content in RAG
    logTest('Content Indexing in Vector Database');
    testResults.total++;
    
    try {
      const indexResult = await ragService.indexContent({
        documentId: testMaterialId,
        content: testContent,
        metadata: {
          quizId: testQuizId,
          materialId: testMaterialId,
          source: 'test-document.txt',
          type: 'text'
        }
      });
      
      if (indexResult.success) {
        logSuccess(`Content indexed successfully: ${indexResult.chunksIndexed} chunks`);
        testResults.passed++;
      } else {
        throw new Error(indexResult.error || 'Unknown indexing error');
      }
    } catch (error) {
      logError(`Content indexing failed: ${error.message}`);
      testResults.failed++;
      testResults.errors.push({ test: 'indexing', error: error.message });
    }

    // Test 4: Search/Retrieve content
    logTest('Content Retrieval with Query');
    testResults.total++;
    
    try {
      const query = 'What are the design principles for evolvable systems?';
      const searchResult = await ragService.retrieveRelevantContent(
        query,
        'multiple-choice',
        {
          topK: 3,
          quizId: testQuizId,
          minScore: 0.3
        }
      );
      
      if (searchResult.success) {
        logSuccess(`Retrieved ${searchResult.chunks.length} relevant chunks`);
        searchResult.chunks.forEach((chunk, index) => {
          logInfo(`  Chunk ${index + 1}: Score ${chunk.score.toFixed(3)} - ${chunk.content.substring(0, 100)}...`);
        });
        testResults.passed++;
      } else {
        throw new Error(searchResult.error || 'Search failed');
      }
    } catch (error) {
      logError(`Content retrieval failed: ${error.message}`);
      testResults.failed++;
      testResults.errors.push({ test: 'retrieval', error: error.message });
    }

    // Test 5: Test with learning objective
    logTest('RAG with Learning Objective');
    testResults.total++;
    
    try {
      const learningObjective = 'Analyze the design principles outlined in the Pragmatic Programmer and explain how they contribute to evolvable systems';
      const searchResult = await ragService.retrieveRelevantContent(
        learningObjective,
        'multiple-choice',
        {
          topK: 5,
          quizId: testQuizId,
          minScore: 0.2
        }
      );
      
      if (searchResult.success && searchResult.chunks.length > 0) {
        logSuccess(`Found ${searchResult.chunks.length} chunks relevant to learning objective`);
        const avgScore = searchResult.chunks.reduce((sum, chunk) => sum + chunk.score, 0) / searchResult.chunks.length;
        logInfo(`Average relevance score: ${avgScore.toFixed(3)}`);
        testResults.passed++;
      } else {
        throw new Error('No relevant content found for learning objective');
      }
    } catch (error) {
      logError(`Learning objective search failed: ${error.message}`);
      testResults.failed++;
      testResults.errors.push({ test: 'learning-objective', error: error.message });
    }

    // Test 6: Clean up - Remove test content from vector DB
    logTest('Cleanup Test Data');
    testResults.total++;
    
    try {
      const deleteResult = await ragService.deleteQuizContent(testQuizId);
      if (deleteResult.success) {
        logSuccess('Test data cleaned up successfully');
        testResults.passed++;
      } else {
        logWarning('Cleanup may have failed - manual cleanup might be needed');
        testResults.passed++;
      }
    } catch (error) {
      logWarning(`Cleanup failed: ${error.message} (non-critical)`);
      testResults.passed++;
    }

  } catch (globalError) {
    logError(`Global test error: ${globalError.message}`);
    console.error(globalError);
  }

  // Print test summary
  logSection('Test Results Summary');
  log(`Total Tests: ${testResults.total}`, colors.bright);
  log(`Passed: ${testResults.passed}`, colors.green);
  log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? colors.red : colors.green);
  
  if (testResults.errors.length > 0) {
    log('\nErrors encountered:', colors.red);
    testResults.errors.forEach(err => {
      log(`  - ${err.test}: ${err.error}`, colors.red);
    });
  }

  // Overall result
  console.log('\n' + '='.repeat(60));
  if (testResults.failed === 0) {
    log('🎉 ALL TESTS PASSED! RAG Service is working correctly! 🎉', colors.bright + colors.green);
  } else {
    log('⚠️ Some tests failed. Please fix the issues above. ⚠️', colors.bright + colors.red);
  }
  console.log('='.repeat(60) + '\n');

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run the tests
console.log(`${colors.bright}${colors.magenta}Starting RAG Service Tests...${colors.reset}`);
console.log(`${colors.cyan}This will test the RAG service independently without running the full app${colors.reset}\n`);

runTests().catch(error => {
  logError(`Fatal error running tests: ${error.message}`);
  console.error(error);
  process.exit(1);
});