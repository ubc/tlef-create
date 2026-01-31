// src/store/middleware/pubsubMiddleware.ts
import { Middleware, PayloadAction } from '@reduxjs/toolkit';
import { pubsubService, PUBSUB_EVENTS, NotificationPayload, QuestionGenerationStartedPayload, QuestionGenerationCompletedPayload } from '../../services/pubsubService';
import type { RootState } from '../index';

// Define action types for type safety
interface AddCoursePayload {
    name: string;
    quizCount: number;
}

interface SetQuestionsGeneratingPayload {
    generating: boolean;
    quizId?: string;
    totalQuestions?: number;
}

// Track generation start times per quizId
const generationStartTimes = new Map<string, number>();

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

        case 'plan/setQuestionsGenerating': {
            const payload = action.payload as SetQuestionsGeneratingPayload;
            const quizId = payload.quizId || 'unknown';
            const timestamp = Date.now();

            if (payload.generating) {
                // Store start time for duration calculation
                generationStartTimes.set(quizId, timestamp);

                // Publish STARTED event
                const startedPayload: QuestionGenerationStartedPayload = {
                    quizId,
                    timestamp,
                    totalQuestions: payload.totalQuestions,
                };
                pubsubService.publish(PUBSUB_EVENTS.QUESTION_GENERATION_STARTED, startedPayload);
            } else {
                // Calculate duration
                const startTime = generationStartTimes.get(quizId) || timestamp;
                const duration = timestamp - startTime;
                generationStartTimes.delete(quizId);

                // Get state to check how many questions were generated
                const state = store.getState() as RootState;
                const questionsGenerated = 0; // TODO: Get actual count from state when available

                // Publish COMPLETED event
                const completedPayload: QuestionGenerationCompletedPayload = {
                    quizId,
                    timestamp,
                    questionsGenerated,
                    duration,
                };
                pubsubService.publish(PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED, completedPayload);
            }
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