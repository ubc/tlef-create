// src/store/middleware/pubsubMiddleware.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { pubsubMiddleware } from './pubsubMiddleware';
import { pubsubService, PUBSUB_EVENTS } from '../../services/pubsubService';
import planSlice, { setQuestionsGenerating } from '../slices/planSlice';

describe('pubsubMiddleware - Question Generation Events', () => {
    let store: any;
    let publishSpy: any;

    beforeEach(() => {
        // Create a spy on the publish method
        publishSpy = vi.spyOn(pubsubService, 'publish');

        // Create a test store with the middleware
        store = configureStore({
            reducer: {
                plan: planSlice,
            },
            middleware: (getDefaultMiddleware) =>
                getDefaultMiddleware().concat(pubsubMiddleware),
        });
    });

    afterEach(() => {
        // Clean up spies
        publishSpy.mockRestore();
    });

    it('should publish QUESTION_GENERATION_STARTED event when setQuestionsGenerating(true) is dispatched', () => {
        // Arrange
        const quizId = 'test-quiz-123';

        // Act
        store.dispatch(setQuestionsGenerating({ generating: true, quizId }));

        // Assert
        expect(publishSpy).toHaveBeenCalledWith(
            PUBSUB_EVENTS.QUESTION_GENERATION_STARTED,
            expect.objectContaining({
                quizId: 'test-quiz-123',
                timestamp: expect.any(Number),
            })
        );
    });

    it('should publish QUESTION_GENERATION_COMPLETED event when setQuestionsGenerating(false) is dispatched', () => {
        // Arrange
        const quizId = 'test-quiz-456';
        const startTime = Date.now();

        // First set to true
        store.dispatch(setQuestionsGenerating({ generating: true, quizId }));
        publishSpy.mockClear();

        // Act - set to false
        store.dispatch(setQuestionsGenerating({ generating: false, quizId }));

        // Assert
        expect(publishSpy).toHaveBeenCalledWith(
            PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED,
            expect.objectContaining({
                quizId: 'test-quiz-456',
                timestamp: expect.any(Number),
                duration: expect.any(Number),
            })
        );
    });

    it('should include correct data in event payloads', () => {
        // Arrange
        const quizId = 'test-quiz-789';
        const beforeTimestamp = Date.now();

        // Act
        store.dispatch(setQuestionsGenerating({ generating: true, quizId, totalQuestions: 10 }));

        // Assert
        const afterTimestamp = Date.now();
        expect(publishSpy).toHaveBeenCalledTimes(1);

        const callArgs = publishSpy.mock.calls[0];
        expect(callArgs[0]).toBe(PUBSUB_EVENTS.QUESTION_GENERATION_STARTED);
        expect(callArgs[1]).toMatchObject({
            quizId: 'test-quiz-789',
            totalQuestions: 10,
        });
        expect(callArgs[1].timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
        expect(callArgs[1].timestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    it('should NOT publish question generation events for other Redux actions', () => {
        // Act - dispatch an unrelated action
        store.dispatch({ type: 'unknown/action', payload: {} });

        // Assert - should not have called publish with question generation events
        expect(publishSpy).not.toHaveBeenCalledWith(
            PUBSUB_EVENTS.QUESTION_GENERATION_STARTED,
            expect.anything()
        );
        expect(publishSpy).not.toHaveBeenCalledWith(
            PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED,
            expect.anything()
        );
        expect(publishSpy).not.toHaveBeenCalledWith(
            PUBSUB_EVENTS.QUESTION_GENERATION_FAILED,
            expect.anything()
        );
    });

    it('should calculate duration correctly between start and complete', async () => {
        // Arrange
        const quizId = 'test-quiz-duration';

        // Act - start generation
        store.dispatch(setQuestionsGenerating({ generating: true, quizId }));

        // Simulate some time passing
        await new Promise(resolve => setTimeout(resolve, 50));

        publishSpy.mockClear();

        // Complete generation
        store.dispatch(setQuestionsGenerating({ generating: false, quizId }));

        // Assert
        expect(publishSpy).toHaveBeenCalledWith(
            PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED,
            expect.objectContaining({
                quizId: 'test-quiz-duration',
                duration: expect.any(Number),
            })
        );

        // Duration should be at least 50ms
        const callArgs = publishSpy.mock.calls[0];
        expect(callArgs[1].duration).toBeGreaterThanOrEqual(50);
    });
});
