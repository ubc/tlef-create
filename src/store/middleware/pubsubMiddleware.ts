// src/store/middleware/pubsubMiddleware.ts
import { Middleware, PayloadAction } from '@reduxjs/toolkit';
import { pubsubService, PUBSUB_EVENTS, QuestionGenerationStartedPayload, QuestionGenerationCompletedPayload } from '../../services/pubsubService';

interface SetQuestionsGeneratingPayload {
    generating: boolean;
    quizId: string;
    totalQuestions?: number;
}

// Track generation start times per quizId
const generationStartTimes = new Map<string, number>();

// Bridge between Redux actions and PubSub events
export const pubsubMiddleware: Middleware = (store) => (next) => (action: PayloadAction<unknown>) => {
    const result = next(action);

    // Map Redux actions to PubSub events
    switch (action.type) {
        case 'plan/setQuestionsGenerating': {
            const payload = action.payload as SetQuestionsGeneratingPayload;
            const quizId = payload.quizId || 'unknown';
            const timestamp = Date.now();

            if (payload.generating) {
                generationStartTimes.set(quizId, timestamp);

                const startedPayload: QuestionGenerationStartedPayload = {
                    quizId,
                    timestamp,
                    totalQuestions: payload.totalQuestions,
                };
                pubsubService.publish(PUBSUB_EVENTS.QUESTION_GENERATION_STARTED, startedPayload);
            } else {
                const startTime = generationStartTimes.get(quizId) || timestamp;
                const duration = timestamp - startTime;
                generationStartTimes.delete(quizId);

                const completedPayload: QuestionGenerationCompletedPayload = {
                    quizId,
                    timestamp,
                    questionsGenerated: 0,
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

