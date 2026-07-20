// src/components/LearningObjectives.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import LearningObjectives from './LearningObjectives';
import planSlice from '../store/slices/planSlice';
import appSlice from '../store/slices/appSlice';
import learningObjectiveSlice from '../store/slices/learningObjectiveSlice';
import questionSlice from '../store/slices/questionSlice';
import { pubsubService, PUBSUB_EVENTS } from '../services/pubsubService';
import { objectivesApi, questionsApi, type LearningObjective, type Question } from '../services/api';
import { completeOnboardingStep, ONBOARDING_STORAGE_KEY, readOnboardingState } from '../utils/onboarding';

// Mock the usePubSub hook
const mockShowNotification = vi.fn();
const mockSubscribe = vi.fn((event: string, callback: (payload: unknown) => void) => {
  // Return a mock token
  void callback;
  return `mock-token-${event}`;
});

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({
    showNotification: mockShowNotification,
    subscribe: mockSubscribe,
  }),
}));

describe('LearningObjectives Component - Redux State Subscription', () => {
  let store: ReturnType<typeof configureStore>;

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
        question: questionSlice,
      },
    });

    // Clear all mocks before each test
    vi.clearAllMocks();
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
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

  it('opens a complete manual objective editor with Bloom level and custom subpoints', () => {
    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} />
      </Provider>
    );

    fireEvent.click(screen.getByText('Add New'));

    expect(screen.getByLabelText('Learning Objective')).toBeInTheDocument();
    expect(screen.getByLabelText('Bloom Level')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Subpoint' })).toBeInTheDocument();
    expect(screen.getByText(/preserved if you later use AI Enrich/i)).toBeInTheDocument();
  });

  it('shows an individual AI Enrich action beside each saved objective', () => {
    render(
      <Provider store={store}>
        <LearningObjectives
          {...defaultProps}
          objectives={[{
            _id: 'objective-1',
            text: 'Apply Newton laws',
            order: 0,
            generationMetadata: {
              isAIGenerated: false,
              bloomLevel: 'apply',
              subpoints: ['Draw a free-body diagram']
            }
          }]}
        />
      </Provider>
    );

    const enrichButton = screen.getByRole('button', { name: 'AI enrich learning objective 1' });
    const regenerateButton = screen.getByRole('button', { name: 'Regenerate learning objective 1' });

    expect(enrichButton).toBeEnabled();
    expect(enrichButton.querySelector('.lucide-sparkles')).toBeInTheDocument();
    expect(regenerateButton.querySelector('.lucide-rotate-ccw')).toBeInTheDocument();
  });

  it('shows the AI Enrich tutorial only on the first manually added objective', () => {
    completeOnboardingStep('learning-objectives');

    render(
      <Provider store={store}>
        <LearningObjectives
          {...defaultProps}
          objectives={[
            {
              _id: 'objective-1',
              text: 'Apply Newton laws',
              order: 0,
              generationMetadata: { isAIGenerated: true }
            },
            {
              _id: 'objective-2',
              text: 'Evaluate friction models',
              order: 1,
              generationMetadata: { isAIGenerated: false }
            }
          ]}
        />
      </Provider>
    );

    expect(screen.getByRole('dialog', { name: 'Enrich one objective with AI' })).toBeInTheDocument();
    const enrichButtons = screen.getAllByRole('button', { name: /AI enrich learning objective/i });
    expect(enrichButtons).toHaveLength(1);
    expect(enrichButtons[0].parentElement).toHaveClass('is-tutorial-active');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tutorial' }));
    expect(readOnboardingState().completed).toContain('objective-enrichment');
  });

  it('does not show the AI Enrich tutorial when every objective was AI generated', () => {
    completeOnboardingStep('learning-objectives');

    render(
      <Provider store={store}>
        <LearningObjectives
          {...defaultProps}
          objectives={[
            {
              _id: 'objective-1',
              text: 'Apply Newton laws',
              order: 0,
              generationMetadata: { isAIGenerated: true }
            }
          ]}
        />
      </Provider>
    );

    expect(screen.queryByRole('dialog', { name: 'Enrich one objective with AI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI enrich learning objective 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AI Link Missing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate learning objective 1' })).toBeEnabled();
  });

  it('asks to regenerate linked questions after an objective edit and follows the instructor choice', async () => {
    completeOnboardingStep('learning-objectives');
    completeOnboardingStep('objective-enrichment');
    const objective = { _id: 'objective-1', text: 'Analyze old evidence', order: 0 } as LearningObjective;
    const linkedQuestion = {
      _id: 'question-1',
      learningObjective: 'objective-1',
      questionText: 'Old question'
    } as Question;
    vi.spyOn(objectivesApi, 'getObjectives').mockResolvedValue({ objectives: [objective] });
    const getQuestionsSpy = vi.spyOn(questionsApi, 'getQuestions')
      .mockResolvedValue({ questions: [linkedQuestion] });
    const updateObjectiveSpy = vi.spyOn(objectivesApi, 'updateObjective')
      .mockResolvedValue({ objective: { ...objective, text: 'Analyze revised evidence' } });
    const regenerateQuestionSpy = vi.spyOn(questionsApi, 'regenerateQuestion')
      .mockResolvedValue({ question: linkedQuestion });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <Provider store={store}>
        <LearningObjectives {...defaultProps} objectives={[objective]} />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit learning objective 1' }));
    fireEvent.change(screen.getByLabelText('Learning Objective'), {
      target: { value: 'Analyze revised evidence' }
    });
    const saveButton = await screen.findByRole('button', { name: 'Save Changes' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(updateObjectiveSpy).toHaveBeenCalled());
    await waitFor(() => expect(regenerateQuestionSpy).toHaveBeenCalledWith(
      'question-1',
      expect.stringContaining('linked learning objective was revised')
    ));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Select Cancel to keep the existing questions unchanged.'));
    expect(getQuestionsSpy).toHaveBeenCalled();
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
  let store: ReturnType<typeof configureStore>;

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
        question: questionSlice,
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
    const tokens = mockSubscribe.mock.results.map(result => result.value);

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
      call => call[0] === PUBSUB_EVENTS.QUESTION_GENERATION_STARTED
    )?.[1];

    const completedCallback = mockSubscribe.mock.calls.find(
      call => call[0] === PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED
    )?.[1];

    const failedCallback = mockSubscribe.mock.calls.find(
      call => call[0] === PUBSUB_EVENTS.QUESTION_GENERATION_FAILED
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
