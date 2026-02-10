import { configureStore } from '@reduxjs/toolkit';
import planReducer, { setQuestionsGenerating, clearGenerationStatus } from './planSlice';

describe('planSlice - setQuestionsGenerating', () => {
  let store: ReturnType<typeof configureStore>;

  beforeEach(() => {
    store = configureStore({
      reducer: {
        plan: planReducer,
      },
    });
  });

  it('should set generationStatusByQuiz when dispatched with generating: true', () => {
    // Initial state - no entry for quiz
    expect(store.getState().plan.generationStatusByQuiz).toEqual({});

    // Dispatch action
    store.dispatch(setQuestionsGenerating({
      generating: true,
      quizId: 'test-quiz-123',
      totalQuestions: 10
    }));

    // Verify state updated
    const status = store.getState().plan.generationStatusByQuiz['test-quiz-123'];
    expect(status).toBeDefined();
    expect(status.generating).toBe(true);
    expect(status.startTime).toBeTruthy();
    expect(status.totalQuestions).toBe(10);
  });

  it('should set generating to false when dispatched with generating: false', () => {
    // Set to true first
    store.dispatch(setQuestionsGenerating({
      generating: true,
      quizId: 'test-quiz-123'
    }));
    expect(store.getState().plan.generationStatusByQuiz['test-quiz-123'].generating).toBe(true);

    // Set to false
    store.dispatch(setQuestionsGenerating({
      generating: false,
      quizId: 'test-quiz-123'
    }));

    // Verify state updated
    const status = store.getState().plan.generationStatusByQuiz['test-quiz-123'];
    expect(status.generating).toBe(false);
    expect(status.startTime).toBeNull();
  });

  it('should handle multiple rapid dispatches correctly', () => {
    // Dispatch multiple times rapidly
    store.dispatch(setQuestionsGenerating({ generating: true, quizId: 'quiz-1' }));
    store.dispatch(setQuestionsGenerating({ generating: false, quizId: 'quiz-1' }));
    store.dispatch(setQuestionsGenerating({ generating: true, quizId: 'quiz-2' }));

    // Final state: quiz-1 should be false, quiz-2 should be true
    const state = store.getState().plan;
    expect(state.generationStatusByQuiz['quiz-1'].generating).toBe(false);
    expect(state.generationStatusByQuiz['quiz-2'].generating).toBe(true);
  });

  it('should clear generation status for a quiz', () => {
    store.dispatch(setQuestionsGenerating({ generating: true, quizId: 'quiz-1' }));
    expect(store.getState().plan.generationStatusByQuiz['quiz-1']).toBeDefined();

    store.dispatch(clearGenerationStatus('quiz-1'));
    expect(store.getState().plan.generationStatusByQuiz['quiz-1']).toBeUndefined();
  });
});
