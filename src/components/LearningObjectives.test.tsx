// src/components/LearningObjectives.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import LearningObjectives from './LearningObjectives';
import planSlice from '../store/slices/planSlice';
import appSlice from '../store/slices/appSlice';
import learningObjectiveSlice from '../store/slices/learningObjectiveSlice';
import { pubsubService, PUBSUB_EVENTS } from '../services/pubsubService';

// Mock the usePubSub hook
const mockShowNotification = vi.fn();
const mockSubscribe = vi.fn((event, callback) => {
  // Return a mock token
  return `mock-token-${event}`;
});

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({
    showNotification: mockShowNotification,
    subscribe: mockSubscribe,
  }),
}));

describe('LearningObjectives Component - Redux State Subscription', () => {
  let store: any;

  const defaultProps = {
    assignedMaterials: ['material1', 'material2'],
    objectives: ['Objective 1', 'Objective 2'],
    onObjectivesChange: vi.fn(),
    quizId: 'test-quiz-123',
    onNavigateNext: vi.fn(),
  };

  beforeEach(() => {
    // Create a test store
    store = configureStore({
      reducer: {
        plan: planSlice,
        app: appSlice,
        learningObjective: learningObjectiveSlice,
      },
    });

    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    vi.clearAllMocks();
  });

  it('should read questionsGenerating from Redux state', () => {
    // Arrange - set questionsGenerating to true in store
    store.dispatch({ 
      type: 'plan/setQuestionsGenerating', 
      payload: { generating: true, quizId: 'test-quiz-123' } 
    });

    // Act
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Assert - check that buttons are disabled
    const addButton = screen.getByText('Add New').closest('button');
    expect(addButton).toBeDisabled();
  });

  it('should disable buttons when questionsGenerating is true', () => {
    // Arrange
    store.dispatch({ 
      type: 'plan/setQuestionsGenerating', 
      payload: { generating: true, quizId: 'test-quiz-123' } 
    });

    // Act
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Assert - check all action buttons are disabled
    const addButton = screen.getByText('Add New').closest('button');
    const deleteAllButton = screen.getByText('Delete All').closest('button');
    const regenerateAllButton = screen.getByText('Regenerate All').closest('button');

    expect(addButton).toBeDisabled();
    expect(deleteAllButton).toBeDisabled();
    expect(regenerateAllButton).toBeDisabled();
  });

  it('should enable buttons when questionsGenerating is false', () => {
    // Arrange
    store.dispatch({ 
      type: 'plan/setQuestionsGenerating', 
      payload: { generating: false, quizId: 'test-quiz-123' } 
    });

    // Act
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Assert - check all action buttons are enabled
    const addButton = screen.getByText('Add New').closest('button');
    const deleteAllButton = screen.getByText('Delete All').closest('button');
    const regenerateAllButton = screen.getByText('Regenerate All').closest('button');

    expect(addButton).not.toBeDisabled();
    expect(deleteAllButton).not.toBeDisabled();
    expect(regenerateAllButton).not.toBeDisabled();
  });

  it('should have correct disabled state for all action buttons', () => {
    // Arrange - set questionsGenerating to true
    store.dispatch({ 
      type: 'plan/setQuestionsGenerating', 
      payload: { generating: true, quizId: 'test-quiz-123' } 
    });

    // Act
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Assert - verify all buttons that should be disabled are disabled
    const addButton = screen.getByText('Add New').closest('button');
    const deleteAllButton = screen.getByText('Delete All').closest('button');
    const regenerateAllButton = screen.getByText('Regenerate All').closest('button');

    // All these buttons should be disabled
    expect(addButton).toBeDisabled();
    expect(deleteAllButton).toBeDisabled();
    expect(regenerateAllButton).toBeDisabled();

    // Verify tooltips show the correct message
    expect(addButton?.getAttribute('title')).toContain('Cannot add while generating questions');
    expect(deleteAllButton?.getAttribute('title')).toContain('Cannot delete while generating questions');
    expect(regenerateAllButton?.getAttribute('title')).toContain('Cannot regenerate while generating questions');
  });

  it('should show appropriate tooltips when buttons are disabled', () => {
    // Arrange
    store.dispatch({ 
      type: 'plan/setQuestionsGenerating', 
      payload: { generating: true, quizId: 'test-quiz-123' } 
    });

    // Act
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Assert - check tooltips
    const addButton = screen.getByText('Add New').closest('button');
    const deleteAllButton = screen.getByText('Delete All').closest('button');
    const regenerateAllButton = screen.getByText('Regenerate All').closest('button');

    expect(addButton?.getAttribute('title')).toBe('Cannot add while generating questions');
    expect(deleteAllButton?.getAttribute('title')).toBe('Cannot delete while generating questions');
    expect(regenerateAllButton?.getAttribute('title')).toBe('Cannot regenerate while generating questions');
  });
});

describe('LearningObjectives Component - PubSub Event Subscriptions', () => {
  let store: any;

  const defaultProps = {
    assignedMaterials: ['material1', 'material2'],
    objectives: ['Objective 1', 'Objective 2'],
    onObjectivesChange: vi.fn(),
    quizId: 'test-quiz-123',
    onNavigateNext: vi.fn(),
  };

  beforeEach(() => {
    // Create a test store
    store = configureStore({
      reducer: {
        plan: planSlice,
        app: appSlice,
        learningObjective: learningObjectiveSlice,
      },
    });

    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    vi.clearAllMocks();
  });

  it('should subscribe to QUESTION_GENERATION_STARTED event', () => {
    // Act
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Assert - verify subscribe was called with QUESTION_GENERATION_STARTED
    expect(mockSubscribe).toHaveBeenCalledWith(
      PUBSUB_EVENTS.QUESTION_GENERATION_STARTED,
      expect.any(Function)
    );
  });

  it('should subscribe to QUESTION_GENERATION_COMPLETED event', () => {
    // Act
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Assert - verify subscribe was called with QUESTION_GENERATION_COMPLETED
    expect(mockSubscribe).toHaveBeenCalledWith(
      PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED,
      expect.any(Function)
    );
  });

  it('should subscribe to QUESTION_GENERATION_FAILED event', () => {
    // Act
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Assert - verify subscribe was called with QUESTION_GENERATION_FAILED
    expect(mockSubscribe).toHaveBeenCalledWith(
      PUBSUB_EVENTS.QUESTION_GENERATION_FAILED,
      expect.any(Function)
    );
  });

  it('should unsubscribe from events on unmount', () => {
    // Arrange - spy on pubsubService.unsubscribe
    const unsubscribeSpy = vi.spyOn(pubsubService, 'unsubscribe');

    // Act - render and unmount
    const { unmount } = render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Get the tokens that were returned by subscribe
    const tokens = mockSubscribe.mock.results.map((result: any) => result.value);

    unmount();

    // Assert - verify unsubscribe was called for each token
    tokens.forEach((token: string) => {
      expect(unsubscribeSpy).toHaveBeenCalledWith(token);
    });

    unsubscribeSpy.mockRestore();
  });

  it('should show notifications when events are received', async () => {
    // Arrange - render component
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    // Get the callback functions that were passed to subscribe
    const startedCallback = mockSubscribe.mock.calls.find(
      (call: any) => call[0] === PUBSUB_EVENTS.QUESTION_GENERATION_STARTED
    )?.[1];

    const completedCallback = mockSubscribe.mock.calls.find(
      (call: any) => call[0] === PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED
    )?.[1];

    const failedCallback = mockSubscribe.mock.calls.find(
      (call: any) => call[0] === PUBSUB_EVENTS.QUESTION_GENERATION_FAILED
    )?.[1];

    // Act - simulate events being published
    if (startedCallback) {
      startedCallback({ quizId: 'test-quiz-123', timestamp: Date.now() });
    }

    if (completedCallback) {
      completedCallback({ 
        quizId: 'test-quiz-123', 
        timestamp: Date.now(), 
        questionsGenerated: 10,
        duration: 5000 
      });
    }

    if (failedCallback) {
      failedCallback({ 
        quizId: 'test-quiz-123', 
        timestamp: Date.now(), 
        error: 'Test error',
        errorType: 'unknown' 
      });
    }

    // Assert - verify showNotification was called for each event
    await waitFor(() => {
      expect(mockShowNotification).toHaveBeenCalledTimes(3);
    });

    // Verify notification types
    expect(mockShowNotification).toHaveBeenCalledWith(
      'info',
      expect.any(String),
      expect.any(String),
      expect.any(Number)
    );

    expect(mockShowNotification).toHaveBeenCalledWith(
      'success',
      expect.any(String),
      expect.any(String),
      expect.any(Number)
    );

    expect(mockShowNotification).toHaveBeenCalledWith(
      'error',
      expect.any(String),
      expect.any(String),
      expect.any(Number)
    );
  });
});
