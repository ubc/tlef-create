import { configureStore } from '@reduxjs/toolkit';
import planReducer, { setQuestionsGenerating } from './planSlice';

describe('planSlice - setQuestionsGenerating', () => {
  let store: ReturnType<typeof configureStore>;

  beforeEach(() => {
    store = configureStore({
      reducer: {
        plan: planReducer,
      },
    });
  });

  it('should set questionsGenerating to true when dispatched with generating: true', () => {
    // Initial state
    expect(store.getState().plan.questionsGenerating).toBe(false);

    // Dispatch action
    store.dispatch(setQuestionsGenerating({ 
      generating: true, 
      quizId: 'test-quiz-123',
      totalQuestions: 10
    }));

    // Verify state updated
    const state = store.getState().plan;
    expect(state.questionsGenerating).toBe(true);
    expect(state.currentQuizId).toBe('test-quiz-123');
    expect(state.questionGenerationStartTime).toBeTruthy();
  });

  it('should set questionsGenerating to false when dispatched with generating: false', () => {
    // Set to true first
    store.dispatch(setQuestionsGenerating({ 
      generating: true, 
      quizId: 'test-quiz-123'
    }));
    expect(store.getState().plan.questionsGenerating).toBe(true);

    // Set to false
    store.dispatch(setQuestionsGenerating({ 
      generating: false, 
      quizId: 'test-quiz-123'
    }));

    // Verify state updated
    const state = store.getState().plan;
    expect(state.questionsGenerating).toBe(false);
    expect(state.questionGenerationStartTime).toBeNull();
  });

  it('should handle multiple rapid dispatches correctly', () => {
    // Dispatch multiple times rapidly
    store.dispatch(setQuestionsGenerating({ generating: true, quizId: 'quiz-1' }));
    store.dispatch(setQuestionsGenerating({ generating: false, quizId: 'quiz-1' }));
    store.dispatch(setQuestionsGenerating({ generating: true, quizId: 'quiz-2' }));

    // Final state should be true with quiz-2
    const state = store.getState().plan;
    expect(state.questionsGenerating).toBe(true);
    expect(state.currentQuizId).toBe('quiz-2');
  });
});
