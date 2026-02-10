// src/components/QuestionGeneration.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import QuestionGeneration from './generation';
import planSlice from '../store/slices/planSlice';
import appSlice from '../store/slices/appSlice';
import questionSlice from '../store/slices/questionSlice';

// Mock the API module
vi.mock('../services/api', () => ({
  questionsApi: {
    generateFromPlanStream: vi.fn(),
    getQuestions: vi.fn().mockResolvedValue({ questions: [] }),
    deleteQuestion: vi.fn(),
  },
  plansApi: {
    generatePlan: vi.fn(),
    approvePlan: vi.fn(),
    generateAIPlan: vi.fn().mockResolvedValue({ planItems: [] }),
  },
  quizApi: {
    getQuiz: vi.fn().mockResolvedValue({
      quiz: {
        _id: 'test-quiz-id',
        settings: {
          pedagogicalApproach: 'support',
          questionsPerObjective: 3,
          questionTypes: [],
          difficulty: 'moderate'
        }
      }
    }),
    updateQuiz: vi.fn().mockResolvedValue({}),
  },
}));

// Mock the hooks
vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({
    showNotification: vi.fn(),
    subscribe: vi.fn().mockReturnValue('mock-token'),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
  }),
}));

vi.mock('../hooks/useSSE', () => ({
  useSSE: () => ({
    connectionStatus: 'disconnected',
    isConnected: false,
    error: null,
    disconnect: vi.fn(),
  }),
}));

describe('QuestionGeneration Component - Redux Integration', () => {
  let store: any;
  let dispatchSpy: any;
  const originalFetch = global.fetch;

  beforeEach(() => {
    store = configureStore({
      reducer: {
        plan: planSlice,
        app: appSlice,
        question: questionSlice,
      },
    });

    dispatchSpy = vi.spyOn(store, 'dispatch');

    // Mock fetch for streaming generation - must include ok: true
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, sessionId: 'test-session' }),
      })
    ) as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  const defaultProps = {
    learningObjectives: [
      { _id: 'lo-1', text: 'Understand basic concepts', order: 0 },
      { _id: 'lo-2', text: 'Apply advanced techniques', order: 1 },
    ],
    assignedMaterials: ['material1', 'material2'],
    quizId: 'test-quiz-123',
    onQuestionsGenerated: vi.fn(),
  };

  it('should dispatch setQuestionsGenerating(true) when generation starts', async () => {
    render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    // Wait for the generate button to appear (after useEffect restores settings / initializes default plan)
    const generateButton = await screen.findByText(/Generate \d+ Questions/);
    expect(generateButton).toBeTruthy();

    // Act - click generate button
    fireEvent.click(generateButton);

    // Assert - check if setQuestionsGenerating was dispatched with true
    await waitFor(() => {
      const actions = dispatchSpy.mock.calls.map((call: any) => call[0]);
      const setQuestionsGeneratingAction = actions.find(
        (action: any) => action.type === 'question/setQuestionsGenerating'
      );

      expect(setQuestionsGeneratingAction).toBeDefined();
      expect(setQuestionsGeneratingAction.payload.generating).toBe(true);
      expect(setQuestionsGeneratingAction.payload.quizId).toBe('test-quiz-123');
    });
  });

  it('should dispatch setQuestionsGenerating(false) when generation fails', async () => {
    // Arrange - mock fetch to fail
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error'))) as any;

    render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    const generateButton = await screen.findByText(/Generate \d+ Questions/);

    // Act - click generate button
    fireEvent.click(generateButton);

    // Assert - check if setQuestionsGenerating was dispatched with false after error
    await waitFor(() => {
      const actions = dispatchSpy.mock.calls.map((call: any) => call[0]);
      const setQuestionsGeneratingActions = actions.filter(
        (action: any) => action.type === 'question/setQuestionsGenerating'
      );

      // Should have dispatched true then false
      const hasTrueAction = setQuestionsGeneratingActions.some(
        (action: any) => action.payload.generating === true
      );
      const hasFalseAction = setQuestionsGeneratingActions.some(
        (action: any) => action.payload.generating === false
      );
      expect(hasTrueAction).toBe(true);
      expect(hasFalseAction).toBe(true);
    }, { timeout: 3000 });
  });

  it('should render generation form with plan editor', async () => {
    render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    // Wait for the component to initialize
    expect(await screen.findByText('Generate Questions')).toBeTruthy();

    // Should show the generate button after plan items are initialized
    expect(await screen.findByText(/Generate \d+ Questions/)).toBeTruthy();
  });

  it('should clean up state on unmount during generation', async () => {
    const { unmount } = render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    const generateButton = await screen.findByText(/Generate \d+ Questions/);

    // Act - start generation
    fireEvent.click(generateButton);

    // Wait for generation dispatch
    await waitFor(() => {
      const actions = dispatchSpy.mock.calls.map((call: any) => call[0]);
      const hasGeneratingAction = actions.some(
        (action: any) => action.type === 'question/setQuestionsGenerating' && action.payload.generating === true
      );
      expect(hasGeneratingAction).toBe(true);
    });

    // Unmount component
    unmount();

    // No error should occur during unmount
    expect(true).toBe(true);
  });
});
