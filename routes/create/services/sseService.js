/**
 * Server-Sent Events (SSE) Service
 * Handles real-time streaming of question generation progress
 */

import { EventEmitter } from 'events';

class SSEService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // sessionId -> response object
    this.sessions = new Map(); // sessionId -> session info
  }

  /**
   * Add SSE client connection
   */
  addClient(sessionId, res, metadata = {}) {
    console.log(`📡 SSE client connected: ${sessionId}`);
    
    // Store client response object
    this.clients.set(sessionId, res);
    this.sessions.set(sessionId, {
      connectedAt: new Date(),
      metadata,
      status: 'connected'
    });

    // Setup SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection message
    this.sendToClient(sessionId, 'connected', {
      message: 'SSE connection established',
      sessionId,
      timestamp: new Date().toISOString()
    });

    // Handle client disconnect
    res.on('close', () => {
      console.log(`📡 SSE client disconnected: ${sessionId}`);
      this.removeClient(sessionId);
    });

    res.on('error', (error) => {
      console.error(`📡 SSE client error for ${sessionId}:`, error);
      this.removeClient(sessionId);
    });

    return sessionId;
  }

  /**
   * Remove SSE client
   */
  removeClient(sessionId) {
    this.clients.delete(sessionId);
    this.sessions.delete(sessionId);
    console.log(`📡 Removed SSE client: ${sessionId}`);
  }

  /**
   * Send data to specific client
   */
  sendToClient(sessionId, eventType, data) {
    const client = this.clients.get(sessionId);
    if (!client) {
      console.warn(`📡 No client found for session: ${sessionId}`);
      return false;
    }

    try {
      // Clean the data to remove undefined values
      const cleanData = JSON.parse(JSON.stringify(data || {}));
      const sseData = `event: ${eventType}\ndata: ${JSON.stringify(cleanData)}\n\n`;
      client.write(sseData);
      return true;
    } catch (error) {
      console.error(`📡 Failed to send to client ${sessionId}:`, error);
      console.error(`📡 Problematic data:`, data);
      this.removeClient(sessionId);
      return false;
    }
  }

  /**
   * Broadcast to all clients
   */
  broadcast(eventType, data) {
    let successCount = 0;
    for (const sessionId of this.clients.keys()) {
      if (this.sendToClient(sessionId, eventType, data)) {
        successCount++;
      }
    }
    console.log(`📡 Broadcasted to ${successCount}/${this.clients.size} clients`);
    return successCount;
  }

  /**
   * Stream question generation progress
   */
  streamQuestionProgress(sessionId, questionId, progressData) {
    return this.sendToClient(sessionId, 'question-progress', {
      questionId,
      type: 'progress',
      data: progressData,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Stream LLM text chunks (流式响应)
   */
  streamTextChunk(sessionId, questionId, textChunk, metadata = {}) {
    return this.sendToClient(sessionId, 'text-chunk', {
      questionId,
      type: 'text-chunk',
      chunk: textChunk,
      metadata,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notify question completion
   */
  notifyQuestionComplete(sessionId, questionId, questionData) {
    return this.sendToClient(sessionId, 'question-complete', {
      questionId,
      type: 'complete',
      question: questionData,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notify generation batch started
   */
  notifyBatchStarted(sessionId, batchInfo) {
    return this.sendToClient(sessionId, 'batch-started', {
      type: 'batch-started',
      ...batchInfo,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notify generation batch completed
   */
  notifyBatchComplete(sessionId, summary) {
    return this.sendToClient(sessionId, 'batch-complete', {
      type: 'batch-complete',
      summary,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Send error notification
   */
  emitError(sessionId, questionId, errorMessage, errorType = 'generation-error') {
    return this.sendToClient(sessionId, 'error', {
      questionId,
      type: 'error',
      errorType,
      message: errorMessage,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Send heartbeat to keep connection alive
   */
  sendHeartbeat(sessionId) {
    return this.sendToClient(sessionId, 'heartbeat', {
      type: 'heartbeat',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get active sessions info
   */
  getActiveSessionsInfo() {
    const sessions = [];
    for (const [sessionId, sessionInfo] of this.sessions.entries()) {
      sessions.push({
        sessionId,
        ...sessionInfo,
        hasActiveConnection: this.clients.has(sessionId)
      });
    }
    return sessions;
  }

  /**
   * Start heartbeat interval to keep connections alive
   */
  startHeartbeat(intervalMs = 30000) {
    setInterval(() => {
      for (const sessionId of this.clients.keys()) {
        this.sendHeartbeat(sessionId);
      }
    }, intervalMs);
    
    console.log(`💓 SSE heartbeat started (${intervalMs}ms interval)`);
  }
}

// Create singleton instance
const sseService = new SSEService();

export default sseService;