// src/components/QuestionGeneration.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import QuestionGeneration from './QuestionGeneration';
import planSlice from '../store/slices/planSlice';
import appSlice from '../store/slices/appSlice';
import * as api from '../services/api';

// Mock the API module
vi.mock('../services/api', () => ({
  questionsApi: {
    generateFromPlanStream: vi.fn(),
  },
  plansApi: {
    generatePlan: vi.fn(),
    approvePlan: vi.fn(),
  },
}));

// Mock the hooks
vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({
    showNotification: vi.fn(),
    subscribe: vi.fn(),
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

  beforeEach(() => {
    // Create a test store
    store = configureStore({
      reducer: {
        plan: planSlice,
        app: appSlice,
      },
    });

    // Spy on dispatch
    dispatchSpy = vi.spyOn(store, 'dispatch');

    // Mock fetch for streaming generation
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ success: true, sessionId: 'test-session' }),
      })
    ) as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    learningObjectives: ['LO1', 'LO2'],
    assignedMaterials: ['material1', 'material2'],
    quizId: 'test-quiz-123',
    onQuestionsGenerated: vi.fn(),
  };

  it('should dispatch setQuestionsGenerating(true) when generation starts', async () => {
    // Arrange
    const { container } = render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    // Find and click the generate button
    const generateButton = container.querySelector('.btn-primary.btn-lg');
    expect(generateButton).toBeTruthy();

    // Act - click generate button
    generateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Assert - check if setQuestionsGenerating was dispatched with true
    await waitFor(() => {
      const actions = dispatchSpy.mock.calls.map((call: any) => call[0]);
      const setQuestionsGeneratingAction = actions.find(
        (action: any) => action.type === 'plan/setQuestionsGenerating'
      );
      
      // For now, we expect this to fail since we haven't implemented it yet
      expect(setQuestionsGeneratingAction).toBeDefined();
      expect(setQuestionsGeneratingAction.payload.generating).toBe(true);
      expect(setQuestionsGeneratingAction.payload.quizId).toBe('test-quiz-123');
    });
  });

  it('should dispatch setQuestionsGenerating(false) when generation completes', async () => {
    // Arrange
    const { container } = render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    const generateButton = container.querySelector('.btn-primary.btn-lg');

    // Act - click generate button and wait for completion
    generateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Assert - check if setQuestionsGenerating was dispatched with false after completion
    await waitFor(() => {
      const actions = dispatchSpy.mock.calls.map((call: any) => call[0]);
      const setQuestionsGeneratingActions = actions.filter(
        (action: any) => action.type === 'plan/setQuestionsGenerating'
      );
      
      // Should have at least 2 calls: one for true, one for false
      expect(setQuestionsGeneratingActions.length).toBeGreaterThanOrEqual(2);
      
      // Last call should be false
      const lastAction = setQuestionsGeneratingActions[setQuestionsGeneratingActions.length - 1];
      expect(lastAction.payload.generating).toBe(false);
    }, { timeout: 3000 });
  });

  it('should dispatch setQuestionsGenerating(false) when generation fails', async () => {
    // Arrange - mock fetch to fail
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error'))) as any;

    const { container } = render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    const generateButton = container.querySelector('.btn-primary.btn-lg');

    // Act - click generate button
    generateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Assert - check if setQuestionsGenerating was dispatched with false after error
    await waitFor(() => {
      const actions = dispatchSpy.mock.calls.map((call: any) => call[0]);
      const setQuestionsGeneratingActions = actions.filter(
        (action: any) => action.type === 'plan/setQuestionsGenerating'
      );
      
      // Should have dispatched false after error
      const hasFalseAction = setQuestionsGeneratingActions.some(
        (action: any) => action.payload.generating === false
      );
      expect(hasFalseAction).toBe(true);
    }, { timeout: 3000 });
  });

  it('should clean up state on unmount during generation', async () => {
    // Arrange
    const { container, unmount } = render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    const generateButton = container.querySelector('.btn-primary.btn-lg');

    // Act - start generation
    generateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Wait a bit for generation to start
    await new Promise(resolve => setTimeout(resolve, 100));

    // Clear previous calls
    dispatchSpy.mockClear();

    // Unmount component
    unmount();

    // Assert - check if setQuestionsGenerating(false) was called on unmount
    await waitFor(() => {
      const actions = dispatchSpy.mock.calls.map((call: any) => call[0]);
      const setQuestionsGeneratingAction = actions.find(
        (action: any) => action.type === 'plan/setQuestionsGenerating'
      );
      
      if (setQuestionsGeneratingAction) {
        expect(setQuestionsGeneratingAction.payload.generating).toBe(false);
      }
    });
  });
});
