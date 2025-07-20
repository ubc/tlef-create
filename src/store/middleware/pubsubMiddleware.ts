// src/store/middleware/pubsubMiddleware.ts
import { Middleware, PayloadAction } from '@reduxjs/toolkit';
import { pubsubService, PUBSUB_EVENTS, NotificationPayload } from '../../services/pubsubService';

// Define action types for type safety
interface AddCoursePayload {
    name: string;
    quizCount: number;
}

// Bridge between Redux actions and PubSub events
export const pubsubMiddleware: Middleware = (store) => (next) => (action: PayloadAction<any>) => {
    const result = next(action);

    // Map Redux actions to PubSub events
    switch (action.type) {
        case 'app/addCourse': {
            const payload = action.payload as AddCoursePayload;
            const notification: Omit<NotificationPayload, 'id'> = {
                type: 'success',
                title: 'Course Created',
                message: `${payload.name} has been created successfully`,
                duration: 3000,
            };
            pubsubService.showNotification(notification);
            break;
        }

        case 'app/setActiveCourse': {
            const courseId = action.payload as string;
            pubsubService.publish('COURSE_SELECTED', {
                courseId,
            });
            break;
        }

        case 'app/setActiveQuiz': {
            const quizId = action.payload as string;
            pubsubService.publish('QUIZ_SELECTED', {
                quizId,
            });
            break;
        }

        default:
            // Handle other actions if needed
            break;
    }

    return result;
};

// PubSub listeners that dispatch Redux actions
export const setupPubSubListeners = (dispatch: any) => {
    // Listen for notifications and update UI state
    pubsubService.subscribe(PUBSUB_EVENTS.SHOW_NOTIFICATION, (data: NotificationPayload) => {
        // You could dispatch to a notifications slice if you had one
        console.log('Notification:', data);
    });

    // Listen for loading states
    pubsubService.subscribe(PUBSUB_EVENTS.SHOW_LOADING, (data: { id: string; message: string }) => {
        // You could dispatch to a loading slice if you had one
        console.log('Loading started:', data);
    });

    // Listen for errors
    pubsubService.subscribe(PUBSUB_EVENTS.GLOBAL_ERROR, (data: { error: Error; context: string; severity: string }) => {
        console.error('Global error:', data);
        // Could dispatch to error handling slice
    });

    // Listen for quiz generation events
    pubsubService.subscribe(PUBSUB_EVENTS.QUIZ_GENERATION_COMPLETED, (data: any) => {
        // Could dispatch action to update quiz in Redux store
        console.log('Quiz generation completed:', data);
    });
};