// src/services/pubsubService.ts
import * as PubSub from 'pubsub-js';

// Event Types for type safety
export const PUBSUB_EVENTS = {
    // File Upload Events
    FILE_UPLOAD_STARTED: 'FILE_UPLOAD_STARTED',
    FILE_UPLOAD_PROGRESS: 'FILE_UPLOAD_PROGRESS',
    FILE_UPLOAD_COMPLETED: 'FILE_UPLOAD_COMPLETED',
    FILE_UPLOAD_FAILED: 'FILE_UPLOAD_FAILED',

    // Quiz Generation Events
    QUIZ_GENERATION_STARTED: 'QUIZ_GENERATION_STARTED',
    QUIZ_GENERATION_PROGRESS: 'QUIZ_GENERATION_PROGRESS',
    QUIZ_GENERATION_COMPLETED: 'QUIZ_GENERATION_COMPLETED',
    QUIZ_GENERATION_FAILED: 'QUIZ_GENERATION_FAILED',

    // Material Processing Events
    MATERIAL_PARSED: 'MATERIAL_PARSED',
    MATERIAL_ANALYSIS_COMPLETED: 'MATERIAL_ANALYSIS_COMPLETED',

    // Learning Objectives Events
    OBJECTIVES_GENERATED: 'OBJECTIVES_GENERATED',
    OBJECTIVES_UPDATED: 'OBJECTIVES_UPDATED',

    // UI Events
    SHOW_NOTIFICATION: 'SHOW_NOTIFICATION',
    HIDE_NOTIFICATION: 'HIDE_NOTIFICATION',
    SHOW_LOADING: 'SHOW_LOADING',
    HIDE_LOADING: 'HIDE_LOADING',

    // Error Events
    GLOBAL_ERROR: 'GLOBAL_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

// Type definitions for event payloads
export interface FileUploadStartedPayload {
    fileId: string;
    fileName: string;
    fileSize: number;
}

export interface FileUploadProgressPayload {
    fileId: string;
    progress: number; // 0-100
}

export interface FileUploadCompletedPayload {
    fileId: string;
    fileName: string;
    materialId: string;
    parsedContent?: string;
}

export interface QuizGenerationStartedPayload {
    quizId: string;
    totalQuestions: number;
    approach: string;
}

export interface QuizGenerationProgressPayload {
    quizId: string;
    currentStep: string;
    progress: number;
    questionsGenerated: number;
    totalQuestions: number;
}

export interface QuizGenerationCompletedPayload {
    quizId: string;
    questions: any[];
    totalTime: number;
}

export interface NotificationPayload {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
    duration?: number;
}

export interface LoadingPayload {
    id: string;
    message: string;
}

export interface ErrorPayload {
    error: Error;
    context: string;
    severity: 'low' | 'medium' | 'high';
}

// PubSub Service Class
export class PubSubService {
    private static instance: PubSubService;
    private subscriptions: Map<string, string[]> = new Map();

    // Private counters for unique IDs
    private static notificationCounter = 0;
    private static loadingCounter = 0;

    // Debounce mechanism for notifications
    private recentNotifications: Map<string, number> = new Map();
    private readonly DEBOUNCE_TIME = 500; // 500ms debounce

    private constructor() {}

    static getInstance(): PubSubService {
        if (!PubSubService.instance) {
            PubSubService.instance = new PubSubService();
        }
        return PubSubService.instance;
    }

    // Generate unique IDs
    private generateNotificationId(): string {
        PubSubService.notificationCounter++;
        return `notification-${Date.now()}-${PubSubService.notificationCounter}`;
    }

    private generateLoadingId(): string {
        PubSubService.loadingCounter++;
        return `loading-${Date.now()}-${PubSubService.loadingCounter}`;
    }

    // Check if notification should be debounced
    private shouldDebounceNotification(title: string, message: string): boolean {
        const key = `${title}-${message}`;
        const now = Date.now();
        const lastTime = this.recentNotifications.get(key);

        if (lastTime && (now - lastTime) < this.DEBOUNCE_TIME) {
            return true; // Should debounce
        }

        this.recentNotifications.set(key, now);

        // Clean up old entries
        setTimeout(() => {
            this.recentNotifications.delete(key);
        }, this.DEBOUNCE_TIME * 2);

        return false; // Should not debounce
    }

    // Subscribe to events with automatic cleanup tracking
    subscribe<T>(event: string, callback: (data: T) => void, componentId?: string): string {
        const token = PubSub.subscribe(event, (_msg: string, data: T) => {
            callback(data);
        });

        // Track subscription for cleanup
        if (componentId) {
            if (!this.subscriptions.has(componentId)) {
                this.subscriptions.set(componentId, []);
            }
            this.subscriptions.get(componentId)!.push(token);
        }

        return token;
    }

    // Unsubscribe from specific event
    unsubscribe(token: string): void {
        PubSub.unsubscribe(token);
    }

    // Cleanup all subscriptions for a component
    cleanup(componentId: string): void {
        const tokens = this.subscriptions.get(componentId);
        if (tokens) {
            tokens.forEach(token => PubSub.unsubscribe(token));
            this.subscriptions.delete(componentId);
        }
    }

    // Publish events
    publish<T>(event: string, data: T): void {
        PubSub.publish(event, data);
    }

    // Convenience methods for common events
    showNotification(notification: Omit<NotificationPayload, 'id'>): void {
        // Check for debouncing
        if (this.shouldDebounceNotification(notification.title, notification.message)) {
            console.log('Debouncing duplicate notification:', notification.title);
            return;
        }

        const payload: NotificationPayload = {
            id: this.generateNotificationId(),
            ...notification,
            duration: notification.duration ?? 4000, // Default 4 seconds auto-dismiss, but allow override
        };
        console.log('🔔 Publishing notification with payload:', payload);
        this.publish(PUBSUB_EVENTS.SHOW_NOTIFICATION, payload);
    }

    showLoading(message: string, id?: string): void {
        const payload: LoadingPayload = {
            id: id || this.generateLoadingId(),
            message,
        };
        this.publish(PUBSUB_EVENTS.SHOW_LOADING, payload);
    }

    hideLoading(id: string): void {
        this.publish(PUBSUB_EVENTS.HIDE_LOADING, { id });
    }

    reportError(error: Error, context: string, severity: 'low' | 'medium' | 'high' = 'medium'): void {
        const payload: ErrorPayload = { error, context, severity };
        this.publish(PUBSUB_EVENTS.GLOBAL_ERROR, payload);
    }
}

// Export singleton instance
export const pubsubService = PubSubService.getInstance();