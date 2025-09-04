/**
 * Test embeddings generation directly
 */

import dotenv from 'dotenv';
dotenv.config();

import { EmbeddingsModule } from 'ubc-genai-toolkit-embeddings';
import { ConsoleLogger } from 'ubc-genai-toolkit-core';

async function testEmbeddings() {
  try {
    console.log('🧪 Testing Embeddings Generation...');
    
    const logger = new ConsoleLogger('TEST');
    const embeddings = new EmbeddingsModule({
      providerType: 'fastembed',
      model: 'fast-bge-small-en-v1.5',
      logger: logger
    });
    
    console.log('📊 Initializing embeddings...');
    await embeddings.initialize();
    
    console.log('🔍 Generating embeddings for test text...');
    const testText = 'This is a test document for embeddings verification.';
    const result = await embeddings.create([testText]);
    
    console.log('✅ Embeddings generated!');
    console.log('📊 Result type:', typeof result);
    console.log('📊 Result structure:', Object.keys(result));
    console.log('📊 First embedding info:');
    if (Array.isArray(result.embeddings)) {
      console.log('   - Array length:', result.embeddings.length);
      if (result.embeddings[0]) {
        console.log('   - First embedding length:', result.embeddings[0].length);
        console.log('   - First few values:', result.embeddings[0].slice(0, 5));
        console.log('   - Data type of values:', typeof result.embeddings[0][0]);
      }
    } else {
      console.log('   - Not an array:', result);
    }
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
  
  process.exit(0);
}

testEmbeddings();