// src/components/QuestionGeneration.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import QuestionGeneration from './generation';
import planSlice from '../store/slices/planSlice';
import appSlice from '../store/slices/appSlice';
import questionSlice, { setQuestionsForQuiz, setQuestionsGenerating } from '../store/slices/questionSlice';
import { quizApi, questionsApi, plansApi, type Question } from '../services/api';

const dialogMocks = vi.hoisted(() => ({ confirm: vi.fn(), notify: vi.fn() }));
vi.mock('./system-dialog/SystemDialogProvider', () => ({ useSystemDialog: () => ({ showConfirm: dialogMocks.confirm }) }));

// Mock the API module
vi.mock('../services/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    details?: Record<string, unknown>;

    constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
  questionsApi: {
    generateFromPlanStream: vi.fn(),
    listGenerationJobs: vi.fn().mockResolvedValue([]),
    getGenerationJob: vi.fn(),
    startQuestionGeneration: vi.fn().mockImplementation(async (_quiz, sessionId, configs, options) => ({ success: true, sessionId, job: {
      requestId: options.requestId, jobId: options.requestId, quizId: _quiz, sessionId,
      status: 'running', mode: options.mode, totalQuestions: configs.length, completedQuestions: 0, questionIds: [], items: []
    } })),
    getQuestions: vi.fn().mockResolvedValue({ questions: [] }),
    deleteQuestion: vi.fn(),
    checkGenerationReadiness: vi.fn().mockResolvedValue({ ready: true }),
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
    showNotification: dialogMocks.notify,
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

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

const createTestStore = () => configureStore({
  reducer: { plan: planSlice, app: appSlice, question: questionSlice }
});

describe('QuestionGeneration Component - Redux Integration', () => {
  let store: ReturnType<typeof createTestStore>;
  let dispatchSpy: MockInstance<typeof store.dispatch>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    dialogMocks.confirm.mockReset().mockResolvedValue(false);
    store = createTestStore();

    dispatchSpy = vi.spyOn(store, 'dispatch');

    // Mock fetch for streaming generation - must include ok: true
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ success: true, sessionId: 'test-session' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
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
      const actions = dispatchSpy.mock.calls.map(([action]) => action);
      const setQuestionsGeneratingAction = actions.find(
        setQuestionsGenerating.match
      );

      expect(setQuestionsGeneratingAction).toBeDefined();
      expect(setQuestionsGeneratingAction.payload.generating).toBe(true);
      expect(setQuestionsGeneratingAction.payload.quizId).toBe('test-quiz-123');
    });
  });

  it('should dispatch setQuestionsGenerating(false) when the server explicitly refuses generation', async () => {
    vi.mocked(questionsApi.startQuestionGeneration).mockRejectedValueOnce(Object.assign(new Error('Request refused'), { status: 400 }));

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
      const actions = dispatchSpy.mock.calls.map(([action]) => action);
      const setQuestionsGeneratingActions = actions.filter(
        setQuestionsGenerating.match
      );

      // Should have dispatched true then false
      const hasTrueAction = setQuestionsGeneratingActions.some(
        action => action.payload.generating === true
      );
      const hasFalseAction = setQuestionsGeneratingActions.some(
        action => action.payload.generating === false
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

  it('saves only current Blueprint fields and omits blank optional values', async () => {
    vi.mocked(quizApi.getQuiz).mockResolvedValueOnce({
      quiz: {
        _id: defaultProps.quizId,
        settings: {
          pedagogicalApproach: 'support',
          questionsPerObjective: 3,
          questionTypes: [],
          difficulty: 'moderate',
          planMode: 'ai-auto',
          deliveryTarget: 'h5p-package',
          targetFormat: 'question-set',
          planItems: [{
            type: 'multiple-choice',
            learningObjective: 'lo-1',
            count: 1,
            pedagogicalIntent: '' as never,
            bloomLevel: '' as never,
            difficulty: '' as never,
            focusArea: ' ',
            rationale: ' ',
            selectionMode: 'single'
          }],
          aiConfig: {
            totalQuestions: 1,
            approach: 'support',
            additionalInstructions: ''
          }
        }
      }
    } as never);
    vi.mocked(quizApi.updateQuiz).mockResolvedValueOnce({
      quiz: { _id: defaultProps.quizId, settings: {} }
    } as never);

    render(<Provider store={store}><QuestionGeneration {...defaultProps} /></Provider>);
    fireEvent.change(await screen.findByPlaceholderText('Specific concept, skill, misconception, or scenario'), {
      target: { value: '  cell structure  ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Plan' }));

    await waitFor(() => expect(quizApi.updateQuiz).toHaveBeenCalledOnce());
    const update = vi.mocked(quizApi.updateQuiz).mock.calls[0][1];
    expect(update.settings).not.toHaveProperty('pedagogicalApproach');
    expect(update.settings?.planItems?.[0]).toEqual({
      type: 'multiple-choice',
      learningObjective: 'lo-1',
      count: 1,
      difficulty: 'moderate',
      focusArea: 'cell structure',
      useCustomPromptOnly: false,
      selectionMode: 'single'
    });
    expect(quizApi.getQuiz).toHaveBeenCalledOnce();
  });

  it('reconciles the Question Plan with the current Redux questions when returning from results', async () => {
    const existingQuestion = {
      _id: 'question-1',
      quiz: defaultProps.quizId,
      learningObjective: 'lo-1',
      type: 'multiple-choice',
      difficulty: 'moderate',
      questionText: 'Current question',
      content: { selectionMode: 'single' },
      correctAnswer: 'A',
      order: 0,
      reviewStatus: 'pending',
      createdBy: 'user-1',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } as Question;
    store.dispatch(setQuestionsForQuiz({
      quizId: defaultProps.quizId,
      questions: [existingQuestion]
    }));
    vi.mocked(quizApi.getQuiz).mockResolvedValueOnce({
      quiz: {
        _id: defaultProps.quizId,
        settings: {
          planMode: 'manual',
          targetFormat: 'interactive-book',
          deliveryTarget: 'h5p-package',
          aiConfig: { approach: 'gamify', totalQuestions: 12, additionalInstructions: 'Keep my saved teaching instructions.' },
          planItems: [{
            type: 'multiple-choice',
            learningObjective: 'lo-1',
            count: 5,
            difficulty: 'moderate',
            selectionMode: 'single'
          }]
        }
      }
    } as never);

    const { container } = render(
      <Provider store={store}>
        <QuestionGeneration {...defaultProps} />
      </Provider>
    );

    const backToPlan = await screen.findByRole('button', {
      name: 'Back to AI Plan Configuration'
    });
    expect(screen.getByRole('button', { name: 'Show Details' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));
    expect(defaultProps.onQuestionsGenerated).toHaveBeenCalledOnce();
    fireEvent.click(backToPlan);

    await waitFor(() => {
      expect(container.querySelector('.count-input')).toHaveValue(1);
    });
    expect(screen.getByRole('radio', { name: 'GAMIFY' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Interactive Book', exact: true })).toBeChecked();
    expect(screen.getByLabelText('Additional Instructions (Optional)')).toHaveValue('Keep my saved teaching instructions.');
    await waitFor(() => expect(container.querySelector('.generation-setup-start')).toHaveFocus());
    expect(questionsApi.deleteQuestion).not.toHaveBeenCalled();
    expect(plansApi.generateAIPlan).not.toHaveBeenCalled();
    expect(quizApi.updateQuiz).not.toHaveBeenCalled();
  });

  it('keeps unsaved purpose and layout choices when the objective props refresh', async () => {
    const view = render(<Provider store={store}><QuestionGeneration {...defaultProps} /></Provider>);
    await screen.findByText(/Generate \d+ Questions/);
    fireEvent.click(screen.getByRole('radio', { name: 'ASSESS' }));
    screen.getByRole('radio', { name: 'Interactive Book', exact: true }).focus();
    fireEvent.click(screen.getByRole('radio', { name: 'Interactive Book', exact: true }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Interactive Book', exact: true })).toBeChecked());
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Interactive Book', exact: true })).toHaveFocus());
    const loads = vi.mocked(quizApi.getQuiz).mock.calls.length;
    view.rerender(<Provider store={store}><QuestionGeneration {...defaultProps} learningObjectives={defaultProps.learningObjectives.map(lo => ({ ...lo }))} /></Provider>);
    expect(screen.getByRole('radio', { name: 'ASSESS' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Interactive Book', exact: true })).toBeChecked();
    expect(quizApi.getQuiz).toHaveBeenCalledTimes(loads);
    fireEvent.click(screen.getByRole('radio', { name: 'H5P Package', exact: true }));
    expect(screen.getByRole('radio', { name: 'Interactive Book', exact: true })).toBeChecked();
    expect(dialogMocks.confirm).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not remove questions when a layout confirmation is cancelled (approve plan: %s)', async approvePlan => {
    store.dispatch(setQuestionsForQuiz({ quizId: defaultProps.quizId, questions: [{ _id: 'flashcard-1', quiz: defaultProps.quizId, learningObjective: 'lo-1', type: 'flashcard', questionText: 'Keep this card', content: {}, order: 0 } as Question] }));
    vi.mocked(quizApi.getQuiz).mockResolvedValueOnce({ quiz: { _id: defaultProps.quizId, settings: { targetFormat: 'column', planItems: [{ type: 'flashcard', learningObjective: 'lo-1', count: 1 }] } } } as never);
    render(<Provider store={store}><QuestionGeneration {...defaultProps} /></Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to AI Plan Configuration' }));
    await screen.findByText('Set quiz length and instructions');
    dialogMocks.confirm.mockResolvedValueOnce(approvePlan).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Question Set', exact: true }));
    await waitFor(() => expect(dialogMocks.confirm).toHaveBeenCalledTimes(approvePlan ? 2 : 1));
    expect(dialogMocks.confirm.mock.calls[0][0].title).toBe('Update incompatible plan items?');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Column', exact: true })).toBeEnabled());
    expect(screen.getByRole('radio', { name: 'Column', exact: true })).toBeChecked();
    expect(questionsApi.deleteQuestion).not.toHaveBeenCalled();
    expect(store.getState().question.questionsByQuiz[defaultProps.quizId]).toHaveLength(1);
  });

  it('keeps existing questions when material readiness fails before replacement', async () => {
    const oldQuestion = { _id: 'existing-1', quiz: defaultProps.quizId, type: 'multiple-choice',
      learningObjective: 'lo-1', questionText: 'Keep this question', content: {}, order: 0 } as Question;
    store.dispatch(setQuestionsForQuiz({ quizId: defaultProps.quizId, questions: [oldQuestion] }));
    vi.mocked(questionsApi.checkGenerationReadiness).mockRejectedValueOnce(new Error('Assigned materials are not ready.'));
    render(<Provider store={store}><QuestionGeneration {...defaultProps} /></Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to AI Plan Configuration' }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate \d+ Questions?/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Replace Existing Questions' }));
    await waitFor(() => expect(dialogMocks.notify).toHaveBeenCalledWith(
      'error', 'Generation Failed', 'Assigned materials are not ready.'
    ));
    expect(questionsApi.deleteQuestion).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.getState().question.questionsByQuiz[defaultProps.quizId]).toEqual([oldQuestion]);
  });

  it('sends replacement intent without deleting or clearing the existing questions', async () => {
    const oldQuestion = { _id: 'preserved', quiz: defaultProps.quizId, type: 'multiple-choice',
      learningObjective: 'lo-1', questionText: 'Keep this until the full batch succeeds', content: {}, order: 0 } as Question;
    store.dispatch(setQuestionsForQuiz({ quizId: defaultProps.quizId, questions: [oldQuestion] }));
    render(<Provider store={store}><QuestionGeneration {...defaultProps} /></Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to AI Plan Configuration' }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate \d+ Questions?/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Replace Existing Questions' }));
    await waitFor(() => expect(questionsApi.startQuestionGeneration).toHaveBeenCalledWith(
      defaultProps.quizId, expect.any(String), expect.any(Array), expect.objectContaining({ mode: 'replace', requestId: expect.any(String) })
    ));
    expect(questionsApi.deleteQuestion).not.toHaveBeenCalled();
    expect(store.getState().question.questionsByQuiz[defaultProps.quizId]).toEqual([oldQuestion]);
    expect(screen.queryByRole('button', { name: 'Stop Generation' })).not.toBeInTheDocument();
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
      const actions = dispatchSpy.mock.calls.map(([action]) => action);
      const hasGeneratingAction = actions.some(
        action => setQuestionsGenerating.match(action) && action.payload.generating === true
      );
      expect(hasGeneratingAction).toBe(true);
    });

    // Unmount component
    unmount();

    // No error should occur during unmount
    expect(true).toBe(true);
  });
});
