/**
 * Custom React Hook for Server-Sent Events (SSE)
 * Handles real-time streaming for question generation
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface SSEEvent {
  type: string;
  data: any;
  timestamp?: string;
}

interface SSEHookOptions {
  onConnected?: () => void;
  onBatchStarted?: (data: any) => void;
  onQuestionProgress?: (questionId: string, data: any) => void;
  onTextChunk?: (questionId: string, chunk: string, metadata: any) => void;
  onQuestionComplete?: (questionId: string, question: any) => void;
  onBatchComplete?: (summary: any) => void;
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

  const {
    onConnected,
    onBatchStarted,
    onQuestionProgress, 
    onTextChunk,
    onQuestionComplete,
    onBatchComplete,
    onError,
    onHeartbeat
  } = options;

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      // console.log('📡 Disconnecting SSE connection');
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
      console.warn('📡 No SSE URL provided');
      return;
    }

    // 如果已经有相同URL的连接，不要重复连接
    if (eventSourceRef.current && eventSourceRef.current.url === sseUrl) {
      console.log('📡 SSE connection already exists for this URL');
      return;
    }

    if (eventSourceRef.current) {
      console.log('📡 Closing existing SSE connection');
      eventSourceRef.current.close();
    }

    console.log(`📡 Connecting to SSE: ${sseUrl}`);
    setConnectionStatus('connecting');
    setError(null);

    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    // Connection opened
    eventSource.onopen = () => {
      console.log('✅ SSE connection opened');
      setConnectionStatus('connected');
      setError(null);
      setReconnectAttempts(0);
    };

    // Connection error
    eventSource.onerror = (event) => {
      console.error('❌ SSE connection error:', event);
      setConnectionStatus('error');
      
      if (reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000); // Exponential backoff
        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectAttempts(prev => prev + 1);
          connect();
        }, delay);
      } else {
        setError('Failed to connect to SSE after multiple attempts');
        console.error('❌ Max reconnection attempts reached');
      }
    };

    // Handle specific event types
    eventSource.addEventListener('connected', (event) => {
      try {
        if (event.data && event.data.trim() && event.data !== 'undefined') {
          const data = JSON.parse(event.data);
          console.log('🔗 SSE connected event:', data);
        }
        onConnected?.();
      } catch (err) {
        console.error('Error parsing connected event:', err);
      }
    });

    eventSource.addEventListener('batch-started', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('🚀 Batch started:', data);
        onBatchStarted?.(data);
      } catch (err) {
        console.error('Error parsing batch-started event:', err);
      }
    });

    eventSource.addEventListener('question-progress', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📊 Question progress:', data);
        onQuestionProgress?.(data.questionId, data.data);
      } catch (err) {
        console.error('Error parsing question-progress event:', err);
      }
    });

    eventSource.addEventListener('text-chunk', (event) => {
      try {
        const data = JSON.parse(event.data);
        // Don't log every text chunk to avoid spam
        onTextChunk?.(data.questionId, data.chunk, data.metadata);
      } catch (err) {
        console.error('Error parsing text-chunk event:', err);
      }
    });

    eventSource.addEventListener('question-complete', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('✅ Question complete:', data.questionId);
        onQuestionComplete?.(data.questionId, data.question);
      } catch (err) {
        console.error('Error parsing question-complete event:', err);
      }
    });

    eventSource.addEventListener('batch-complete', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('🎉 Batch complete:', data);
        onBatchComplete?.(data.summary);
      } catch (err) {
        console.error('Error parsing batch-complete event:', err);
      }
    });

    eventSource.addEventListener('error', (event) => {
      try {
        // Cast to MessageEvent to access data property
        const messageEvent = event as MessageEvent;
        // Only parse data if it exists and is not empty
        if (messageEvent.data && messageEvent.data.trim() && messageEvent.data !== 'undefined') {
          const data = JSON.parse(messageEvent.data);
          console.error('🚨 SSE error event:', data);
          onError?.(data.questionId, data.message, data.errorType);
        } else {
          console.error('🚨 SSE error event (no data):', event);
        }
      } catch (err) {
        console.error('Error parsing error event:', err);
      }
    });

    eventSource.addEventListener('heartbeat', (event) => {
      try {
        const data = JSON.parse(event.data);
        // Don't log heartbeats to avoid spam
        onHeartbeat?.();
      } catch (err) {
        console.error('Error parsing heartbeat event:', err);
      }
    });

    // Generic message handler (fallback)
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📨 SSE generic message:', data);
      } catch (err) {
        console.error('Error parsing generic SSE message:', err);
      }
    };

  }, [sseUrl, reconnectAttempts]); // 移除回调函数依赖，避免无限重连

  // Connect when URL is provided
  useEffect(() => {
    if (sseUrl) {
      connect();
    }

    // Cleanup on unmount or URL change
    return () => {
      disconnect();
    };
  }, [sseUrl]); // 只依赖 sseUrl，避免无限重连

  // Send a manual reconnect function
  const reconnect = useCallback(() => {
    console.log('🔄 Manual reconnect triggered');
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