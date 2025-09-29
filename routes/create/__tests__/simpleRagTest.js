/**
 * Simple RAG Service Test
 * Tests just the RAG initialization with Qdrant connection
 */

import dotenv from 'dotenv';
dotenv.config();

import ragService from '../services/ragService.js';

async function testRagInit() {
  console.log('🧪 Testing RAG Service Initialization...');
  console.log(`🔗 Connecting to Qdrant at: ${process.env.QDRANT_URL}`);
  console.log(`🔑 Using API key: ${process.env.QDRANT_API_KEY}`);
  
  try {
    const initialized = await ragService.initialize();
    if (initialized) {
      console.log('✅ RAG Service initialized successfully!');
      
      // Test if we can access Qdrant
      console.log('🔍 Testing Qdrant connection...');
      const testResult = await ragService.indexContent({
        documentId: 'test-doc-123',
        content: 'This is a test document for Qdrant connection verification.',
        metadata: { source: 'test', type: 'verification' }
      });
      
      if (testResult.success) {
        console.log('✅ Qdrant connection successful!');
        
        // Test search
        console.log('🔎 Testing search functionality...');
        const searchResult = await ragService.searchContent('test document', 1);
        console.log('🔍 Search results:', searchResult);
        
        console.log('✅ All tests passed!');
      } else {
        console.log('❌ Qdrant connection failed:', testResult.error);
      }
    } else {
      console.log('❌ RAG Service initialization failed');
    }
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    console.log('📊 Error details:', error);
  }
  
  process.exit(0);
}

testRagInit();