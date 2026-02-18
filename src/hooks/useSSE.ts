/**
 * Custom React Hook for Server-Sent Events (SSE)
 * Handles real-time streaming for question generation
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface BatchStartedData {
  totalQuestions: number;
  sessionId: string;
}

interface QuestionProgressData {
  questionId: string;
  type: string;
  status: string;
  questionIndex?: number;
}

interface TextChunkMetadata {
  questionType: string;
  questionIndex: number;
}

interface TextChunkData {
  chunk: string;
  questionId: string;
  metadata?: TextChunkMetadata;
}

interface QuestionCompleteData {
  questionId: string;
  question: unknown;
  questionText?: string;
}

interface BatchCompleteData {
  totalGenerated: number;
  sessionId: string;
}

interface SSEErrorData {
  message: string;
  questionId?: string;
  errorType?: string;
}

interface SSEEvent {
  type: string;
  data: BatchStartedData | QuestionProgressData | TextChunkData | QuestionCompleteData | BatchCompleteData | SSEErrorData;
  timestamp?: string;
}

interface SSEHookOptions {
  onConnected?: () => void;
  onBatchStarted?: (data: BatchStartedData) => void;
  onQuestionProgress?: (questionId: string, data: QuestionProgressData) => void;
  onTextChunk?: (questionId: string, chunk: string, metadata?: TextChunkMetadata) => void;
  onQuestionComplete?: (questionId: string, question: unknown) => void;
  onBatchComplete?: (summary: BatchCompleteData) => void;
  onError?: (questionId: string, errorMessage: string, errorType: string) => void;
  onHeartbeat?: () => void;
}

export const useSSE = (sseUrl: string | null, options: SSEHookOptions = {}) => {
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxReconnectAttempts = 5;

  // Use refs to always have access to the latest callbacks without re-creating EventSource
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    setConnectionStatus('disconnected');
    setReconnectAttempts(0);
  }, []);

  const connect = useCallback(() => {
    if (!sseUrl) {
      return;
    }

    // If already connected to the same URL, don't reconnect
    if (eventSourceRef.current && eventSourceRef.current.url === sseUrl) {
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnectionStatus('connecting');
    setError(null);

    // Use EventSource with credentials enabled for cross-origin requests
    // Note: EventSource will automatically include cookies if same-origin,
    // but for cross-origin we rely on CORS with credentials: true
    const eventSource = new EventSource(sseUrl, { withCredentials: true });
    eventSourceRef.current = eventSource;

    // Connection opened
    eventSource.onopen = () => {
      setConnectionStatus('connected');
      setError(null);
      setReconnectAttempts(0);
    };

    // Connection error
    eventSource.onerror = (event) => {
      console.error('[SSE] Connection error:', event);
      setConnectionStatus('error');
      
      if (reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);

        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectAttempts(prev => prev + 1);
          connect();
        }, delay);
      } else {
        setError('Failed to connect to SSE after multiple attempts');
        console.error('[SSE] Max reconnection attempts reached');
      }
    };

    // Handle specific event types - use callbacksRef to always get latest callbacks
    eventSource.addEventListener('connected', (event) => {
      try {
        if (event.data && event.data.trim() && event.data !== 'undefined') {
          JSON.parse(event.data);
        }
        callbacksRef.current.onConnected?.();
      } catch (err) {
        console.error('[SSE] Error parsing connected event:', err);
      }
    });

    eventSource.addEventListener('batch-started', (event) => {
      try {
        const data = JSON.parse(event.data);
        callbacksRef.current.onBatchStarted?.(data);
      } catch (err) {
        console.error('[SSE] Error parsing batch-started event:', err);
      }
    });

    eventSource.addEventListener('question-progress', (event) => {
      try {
        const data = JSON.parse(event.data);
        // Log progress for debugging
        console.log(`[SSE Progress] ${data.questionId}: ${data.data?.status} - ${data.data?.message || ''}`);
        callbacksRef.current.onQuestionProgress?.(data.questionId, data.data);
      } catch (err) {
        console.error('[SSE] Error parsing question-progress event:', err);
      }
    });

    eventSource.addEventListener('text-chunk', (event) => {
      try {
        const data = JSON.parse(event.data);
        callbacksRef.current.onTextChunk?.(data.questionId, data.chunk, data.metadata);
      } catch (err) {
        console.error('[SSE] Error parsing text-chunk event:', err);
      }
    });

    eventSource.addEventListener('question-complete', (event) => {
      try {
        console.log('[SSE] Received question-complete event:', event.data);
        const data = JSON.parse(event.data);
        console.log('[SSE] Parsed question-complete:', data.questionId);
        callbacksRef.current.onQuestionComplete?.(data.questionId, data.question);
      } catch (err) {
        console.error('[SSE] Error parsing question-complete event:', err);
      }
    });

    eventSource.addEventListener('batch-complete', (event) => {
      try {
        console.log('[SSE] Received batch-complete event:', event.data);
        const data = JSON.parse(event.data);
        console.log('[SSE] Parsed batch-complete, calling callback...');
        callbacksRef.current.onBatchComplete?.(data.summary);
      } catch (err) {
        console.error('[SSE] Error parsing batch-complete event:', err);
      }
    });

    eventSource.addEventListener('error', (event) => {
      try {
        const messageEvent = event as MessageEvent;
        if (messageEvent.data && messageEvent.data.trim() && messageEvent.data !== 'undefined') {
          const data = JSON.parse(messageEvent.data);
          console.error('[SSE] Error event:', data);
          callbacksRef.current.onError?.(data.questionId, data.message, data.errorType);
        } else {
          console.error('[SSE] Error event (no data):', event);
        }
      } catch (err) {
        console.error('[SSE] Error parsing error event:', err);
      }
    });

    eventSource.addEventListener('heartbeat', (event) => {
      try {
        JSON.parse(event.data);
        callbacksRef.current.onHeartbeat?.();
      } catch (err) {
        console.error('[SSE] Error parsing heartbeat event:', err);
      }
    });

    // Generic message handler (fallback)
    eventSource.onmessage = (event) => {
      try {
        JSON.parse(event.data);
      } catch (err) {
        console.error('[SSE] Error parsing generic message:', err);
      }
    };

  }, [sseUrl, reconnectAttempts]);

  // Connect when URL is provided
  useEffect(() => {
    if (sseUrl) {
      connect();
    }

    // Cleanup on unmount or URL change
    return () => {
      disconnect();
    };
  }, [sseUrl]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    setReconnectAttempts(0);
    connect();
  }, [connect]);

  return {
    connectionStatus,
    error,
    disconnect,
    reconnect,
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting',
    hasError: connectionStatus === 'error'
  };
};

export default useSSE;