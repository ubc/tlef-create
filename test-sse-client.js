/**
 * Test SSE Client
 * Simulates frontend SSE connection for testing
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const EventSourceLib = require('eventsource');
const EventSource = EventSourceLib.default || EventSourceLib;

const BASE_URL = 'http://localhost:8051/api/create';
const TEST_SESSION_ID = 'test-session-' + Date.now();

console.log('🧪 Testing SSE connectivity...');
console.log(`📡 Session ID: ${TEST_SESSION_ID}`);
console.log(`🔗 SSE URL: ${BASE_URL}/streaming/test-sse/${TEST_SESSION_ID}`);

// First, let's test if the server responds to regular requests
async function testServerConnection() {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    if (response.ok) {
      console.log('✅ Server is reachable');
      return true;
    } else {
      console.log('❌ Server responded with error:', response.status);
      return false;
    }
  } catch (error) {
    console.log('❌ Cannot reach server:', error.message);
    return false;
  }
}

// Test SSE connection (without auth for now)
function testSSEConnection() {
  console.log('\n📡 Testing SSE connection...');
  
  const eventSource = new EventSource(`${BASE_URL}/streaming/test-sse/${TEST_SESSION_ID}`);
  
  eventSource.onopen = function(event) {
    console.log('✅ SSE connection opened');
  };
  
  eventSource.onmessage = function(event) {
    console.log('📨 Received message:', event.data);
  };
  
  // Listen for specific events
  eventSource.addEventListener('connected', function(event) {
    console.log('🔗 Connected event:', JSON.parse(event.data));
  });
  
  eventSource.addEventListener('batch-started', function(event) {
    console.log('🚀 Batch started:', JSON.parse(event.data));
  });
  
  eventSource.addEventListener('text-chunk', function(event) {
    const data = JSON.parse(event.data);
    console.log(`💬 Text chunk for ${data.questionId}: "${data.chunk}"`);
  });
  
  eventSource.addEventListener('question-complete', function(event) {
    const data = JSON.parse(event.data);
    console.log(`✅ Question complete: ${data.questionId}`);
  });
  
  eventSource.addEventListener('batch-complete', function(event) {
    console.log('🎉 Batch complete:', JSON.parse(event.data));
    eventSource.close();
    console.log('🔚 Test completed - SSE connection closed');
    process.exit(0);
  });
  
  eventSource.addEventListener('error', function(event) {
    console.log('🚨 SSE error event:', JSON.parse(event.data));
  });
  
  eventSource.onerror = function(event) {
    console.log('❌ SSE connection error:', event);
    if (event.type === 'error') {
      console.log('🔄 Will retry connection...');
    }
  };
  
  // Cleanup after 30 seconds
  setTimeout(() => {
    console.log('⏰ Test timeout - closing connection');
    eventSource.close();
    process.exit(0);
  }, 30000);
  
  return eventSource;
}

// Test mock generation endpoint
async function testMockGeneration() {
  console.log('\n🧪 Testing mock generation...');
  
  try {
    const response = await fetch(`${BASE_URL}/streaming/test-mock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: TEST_SESSION_ID,
        testType: 'mock-generation'
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Mock generation started:', result);
      return true;
    } else {
      console.log('❌ Mock generation failed:', response.status);
      const error = await response.text();
      console.log('Error details:', error);
      return false;
    }
  } catch (error) {
    console.log('❌ Mock generation request failed:', error.message);
    return false;
  }
}

// Run the test
async function runTest() {
  console.log('🎯 Starting SSE Test Suite\n');
  
  // Test 1: Check server connectivity
  const serverOk = await testServerConnection();
  if (!serverOk) {
    console.log('❌ Cannot proceed - server not reachable');
    process.exit(1);
  }
  
  // Test 2: Setup SSE connection
  const eventSource = testSSEConnection();
  
  // Test 3: Wait a moment for connection to establish
  setTimeout(async () => {
    // Test 4: Trigger mock generation
    await testMockGeneration();
  }, 2000);
}

runTest().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});