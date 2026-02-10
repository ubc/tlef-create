// src/services/pubsubService.ts
import * as PubSub from 'pubsub-js';

// Event Types for type safety
export const PUBSUB_EVENTS = {
    // Learning Objectives Events
    OBJECTIVES_DELETED: 'OBJECTIVES_DELETED',

    // Question Events
    QUESTIONS_DELETED: 'QUESTIONS_DELETED',

    // Question Generation State Events
    QUESTION_GENERATION_STARTED: 'QUESTION_GENERATION_STARTED',
    QUESTION_GENERATION_COMPLETED: 'QUESTION_GENERATION_COMPLETED',
    QUESTION_GENERATION_FAILED: 'QUESTION_GENERATION_FAILED',

    // UI Events
    SHOW_NOTIFICATION: 'SHOW_NOTIFICATION',
    HIDE_NOTIFICATION: 'HIDE_NOTIFICATION',
} as const;

// Type definitions for event payloads
export interface QuestionGenerationStartedPayload {
    quizId: string;
    timestamp: number;
    totalQuestions?: number;
}

export interface QuestionGenerationCompletedPayload {
    quizId: string;
    timestamp: number;
    questionsGenerated: number;
    duration: number;
}

export interface QuestionGenerationFailedPayload {
    quizId: string;
    timestamp: number;
    error: string;
    errorType: 'network' | 'server' | 'validation' | 'unknown';
}

export interface NotificationPayload {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
    duration?: number;
}

// PubSub Service Class
export class PubSubService {
    private static instance: PubSubService;
    private subscriptions: Map<string, string[]> = new Map();

    // Private counter for unique IDs
    private static notificationCounter = 0;

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

    // Convenience method for notifications with deduplication
    showNotification(notification: Omit<NotificationPayload, 'id'>): void {
        // Check for debouncing
        if (this.shouldDebounceNotification(notification.title, notification.message)) {
            return;
        }

        const payload: NotificationPayload = {
            id: this.generateNotificationId(),
            ...notification,
            duration: notification.duration ?? 4000, // Default 4 seconds auto-dismiss, but allow override
        };
        this.publish(PUBSUB_EVENTS.SHOW_NOTIFICATION, payload);
    }
}

// Export singleton instance
export const pubsubService = PubSubService.getInstance();
