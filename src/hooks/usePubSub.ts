// src/hooks/usePubSub.ts
import { useEffect, useRef, useCallback } from 'react';
import { pubsubService } from '../services/pubsubService';

export const usePubSub = (componentId?: string) => {
    const componentIdRef = useRef(componentId || `component-${Date.now()}`);

    // Subscribe to events with automatic cleanup
    const subscribe = useCallback(<T>(
        event: string,
        callback: (data: T) => void
    ): string => {
        return pubsubService.subscribe(event, callback, componentIdRef.current);
    }, []);

    // Unsubscribe from events
    const unsubscribe = useCallback((token: string): void => {
        pubsubService.unsubscribe(token);
    }, []);

    // Publish events
    const publish = useCallback(<T>(event: string, data: T): void => {
        pubsubService.publish(event, data);
    }, []);

    // Convenience methods
    const showNotification = useCallback((
        type: 'success' | 'error' | 'warning' | 'info',
        title: string,
        message: string,
        duration?: number
    ) => {
        pubsubService.showNotification({ type, title, message, duration });
    }, []);

    const showLoading = useCallback((message: string, id?: string) => {
        return pubsubService.showLoading(message, id);
    }, []);

    const hideLoading = useCallback((id: string) => {
        pubsubService.hideLoading(id);
    }, []);

    const reportError = useCallback((
        error: Error,
        context: string,
        severity: 'low' | 'medium' | 'high' = 'medium'
    ) => {
        pubsubService.reportError(error, context, severity);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            pubsubService.cleanup(componentIdRef.current);
        };
    }, []);

    return {
        subscribe,
        unsubscribe,
        publish,
        showNotification,
        showLoading,
        hideLoading,
        reportError,
    };
};