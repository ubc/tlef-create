import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewEdit from './ReviewEdit';
import questionReducer, { setQuestionsForQuiz, selectHasReviewDrafts } from '../../store/slices/questionSlice';
import quizReducer, { setCurrentQuiz } from '../../store/slices/quizSlice';
import type { Quiz } from '../../services/api';
import type { ExtendedQuestion } from './reviewTypes';
import type { useQuestionEditHandlers } from './useQuestionEditHandlers';

const mocks = vi.hoisted(() => ({
  createQuestion: vi.fn(), getQuestions: vi.fn(), reorderQuestions: vi.fn(), updateQuestion: vi.fn(), deleteQuestion: vi.fn(), regenerateQuestion: vi.fn(), notify: vi.fn(),
  subscribe: vi.fn(), unsubscribe: vi.fn(), publish: vi.fn(), confirm: vi.fn(), completeReview: vi.fn()
}));
vi.mock('../../services/api', () => ({
  questionsApi: { createQuestion: mocks.createQuestion, listGenerationJobs: vi.fn().mockResolvedValue([]), getQuestions: mocks.getQuestions, reorderQuestions: mocks.reorderQuestions,
    updateQuestion: mocks.updateQuestion, deleteQuestion: mocks.deleteQuestion, regenerateQuestion: mocks.regenerateQuestion },
  coverageMapApi: {}, exportApi: {}, h5pEditorApi: {}, quizApi: { completeReview: mocks.completeReview }
}));
vi.mock('../../hooks/usePubSub', () => ({ usePubSub: () => ({
  showNotification: mocks.notify, subscribe: mocks.subscribe, unsubscribe: mocks.unsubscribe, publish: mocks.publish
}) }));
vi.mock('../system-dialog/SystemDialogProvider', () => ({ useSystemDialog: () => ({ showConfirm: mocks.confirm }) }));
vi.mock('../../hooks/useFeatureOnboarding', () => ({ useFeatureOnboarding: () => ({ isActive: false, isCompleted: true }) }));
vi.mock('../onboarding/FeatureCoachmark', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../RegeneratePromptModal', () => ({ default: ({ isOpen, onRegenerate }: {
  isOpen: boolean; onRegenerate: () => void
}) => isOpen ? <button onClick={() => onRegenerate()}>Confirm regeneration</button> : null }));
vi.mock('./ChapterEditorPanel', () => ({ default: () => null }));
vi.mock('../PdfExportModal', () => ({ default: () => null }));
vi.mock('./CanvasExportModal', () => ({ default: () => null }));
vi.mock('./ManualQuestionForm', () => ({ default: () => null }));
vi.mock('./H5PStudioDraftDialog', () => ({ default: () => null }));
vi.mock('./QuestionCard', () => ({ default: ({ question, onMove, canMoveUp, canMoveDown, onToggleEdit, onSave, onDelete, onRegenerate, handlers }: {
  question: ExtendedQuestion; onMove: (id: string, direction: -1 | 1) => void; canMoveUp: boolean; canMoveDown: boolean;
  onToggleEdit: (id: string) => void; onSave: (id: string) => void; onDelete: (id: string) => void;
  onRegenerate: (id: string) => void; handlers: ReturnType<typeof useQuestionEditHandlers>;
}) => <article data-testid="question-card"><span>{question.questionText}</span>
  <button disabled={!canMoveUp} onClick={() => onMove(question._id, -1)}>Up {question.questionText}</button>
  <button disabled={!canMoveDown} onClick={() => onMove(question._id, 1)}>Down {question.questionText}</button>
  <button onClick={() => onToggleEdit(question._id)}>{question.isEditing ? 'Cancel' : 'Edit'} {question._id}</button>
  <button onClick={() => onSave(question._id)}>Save {question._id}</button>
  <button onClick={() => onDelete(question._id)}>Delete {question._id}</button>
  <button onClick={() => onRegenerate(question._id)}>Regenerate {question._id}</button>
  {question.isEditing && <input aria-label={`Draft ${question._id}`} value={question.questionText}
    onChange={event => handlers.updateQuestion(question._id, 'questionText', event.target.value)} />}
</article> }));

const questions = ['First', 'Second'].map((text, order) => ({
  _id: text, quiz: 'quiz1', questionText: text, type: 'true-false', order, difficulty: 'easy', correctAnswer: true, content: {}, explanation: 'Saved explanation'
})) as ExtendedQuestion[];
function renderReview() {
  const store = configureStore({ reducer: {
    question: questionReducer,
    app: () => ({ user: { id: 'owner1' } }),
    quiz: () => ({ currentQuiz: { _id: 'quiz1', settings: { targetFormat: 'column' } } })
  } });
  const tree = (quizId: string) => <Provider store={store}><MemoryRouter><ReviewEdit quizId={quizId} learningObjectives={[]} /></MemoryRouter></Provider>;
  const view = render(tree('quiz1'));
  return { store, unmount: view.unmount, changeQuiz: (quizId: string) => view.rerender(tree(quizId)) };
}

function renderReviewWithQuiz() {
  const store = configureStore({ reducer: {
    question: questionReducer,
    app: () => ({ user: { id: 'owner1' } }),
    quiz: quizReducer
  } });
  store.dispatch(setCurrentQuiz({ _id: 'quiz1', settings: { targetFormat: 'column' }, progress: { reviewCompleted: false }, questions: questions.map(question => question._id) } as unknown as Quiz));
  render(<Provider store={store}><MemoryRouter><ReviewEdit quizId="quiz1" learningObjectives={[]} /></MemoryRouter></Provider>);
  return store;
}

describe('Review completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuestions.mockResolvedValue({ questions });
  });

  it('confirms the saved set and reopens review after a saved question edit', async () => {
    const reviewedQuiz = { _id: 'quiz1', settings: { targetFormat: 'column' }, progress: { reviewCompleted: true }, questions: questions.map(question => question._id) } as unknown as Quiz;
    mocks.completeReview.mockResolvedValue({ quiz: reviewedQuiz });
    mocks.updateQuestion.mockResolvedValue({ question: questions[0] });
    const store = renderReviewWithQuiz();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark review complete' }));
    await screen.findByText(/Review complete\. These saved questions are ready to preview/);
    expect(store.getState().quiz.currentQuiz?.progress.reviewCompleted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save First' }));
    await waitFor(() => expect(store.getState().quiz.currentQuiz?.progress.reviewCompleted).toBe(false));
    expect(screen.getByRole('button', { name: 'Mark review complete' })).toBeEnabled();
  });
});

function renderMixedActivityPreview() {
  const store = configureStore({ reducer: {
    question: questionReducer,
    app: () => ({ user: { id: 'owner1' } }),
    quiz: () => ({ currentQuiz: {
      _id: 'quiz1',
      settings: { deliveryTarget: 'canvas-lti', targetFormat: 'mixed-activity' }
    } })
  } });
  return render(<Provider store={store}><MemoryRouter>
    <ReviewEdit quizId="quiz1" learningObjectives={[]} workflowMode="preview-export" />
  </MemoryRouter></Provider>);
}

describe('Review learner preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuestions.mockResolvedValue({ questions });
  });

  it('uses the shared H5P review engine for Mixed Activity', async () => {
    renderMixedActivityPreview();
    const preview = await screen.findByTitle('H5P Quiz Preview');
    expect(preview).toHaveAttribute('src', '/api/create/h5p-preview/quiz/quiz1/render?containerMode=mixed-activity');
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });
});

describe('Review question ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuestions.mockResolvedValue({ questions });
  });

  it('saves the new full order and refreshes the shared questions after success', async () => {
    mocks.reorderQuestions.mockResolvedValue({ questions: [...questions].reverse().map((question, order) => ({ ...question, order })) });
    const { store } = renderReview();
    expect(await screen.findByRole('button', { name: 'Up First' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Up Second' }));
    await waitFor(() => expect(mocks.reorderQuestions).toHaveBeenCalledWith('quiz1', ['Second', 'First']));
    await waitFor(() => expect(store.getState().question.questionsByQuiz.quiz1.map(question => question._id)).toEqual(['Second', 'First']));
    expect(screen.getAllByTestId('question-card')[0]).toHaveTextContent('Second');
  });

  it('retains the saved order when the reorder request fails', async () => {
    mocks.reorderQuestions.mockRejectedValue(new Error('Retry order save'));
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Down First' }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('error', 'Reorder Failed', 'Retry order save'));
    expect(screen.getAllByTestId('question-card')[0]).toHaveTextContent('First');
    expect(screen.getByRole('button', { name: 'Down First' })).toBeEnabled();
  });
});

describe('Review concurrent drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuestions.mockResolvedValue({ questions });
    mocks.confirm.mockResolvedValue(true);
  });

  it.each(['save', 'delete', 'regenerate'] as const)('preserves a second draft edited while %s is pending', async operation => {
    let resolve!: (result: { question: ExtendedQuestion }) => void;
    const request = new Promise<{ question: ExtendedQuestion }>(done => { resolve = done; });
    mocks.updateQuestion.mockReturnValue(request);
    mocks.deleteQuestion.mockReturnValue(request);
    mocks.regenerateQuestion.mockReturnValue(request);
    renderReview();
    await screen.findByRole('button', { name: 'Edit First' });
    if (operation === 'save') {
      fireEvent.click(screen.getByRole('button', { name: 'Edit First' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Draft First' }), { target: { value: 'Saved first draft' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save First' }));
      await waitFor(() => expect(mocks.updateQuestion).toHaveBeenCalled());
    } else if (operation === 'delete') {
      fireEvent.click(screen.getByRole('button', { name: 'Delete First' }));
      await waitFor(() => expect(mocks.deleteQuestion).toHaveBeenCalled());
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate First' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm regeneration' }));
      await waitFor(() => expect(mocks.regenerateQuestion).toHaveBeenCalled());
    }
    fireEvent.click(screen.getByRole('button', { name: 'Edit Second' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft Second' }), { target: { value: 'Unsaved second draft' } });
    await act(async () => { resolve({ question: { ...questions[0], questionText: 'Saved first draft' } }); await request; });
    expect(screen.getByRole('textbox', { name: 'Draft Second' })).toHaveValue('Unsaved second draft');
    expect(screen.getByRole('button', { name: 'Cancel Second' })).toBeInTheDocument();
    // Cancellation must still restore the snapshot from before the pending request.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Second' }));
    expect(screen.getAllByTestId('question-card').at(-1)).toHaveTextContent('Second');
    expect(screen.queryByText('Unsaved second draft')).not.toBeInTheDocument();
  });

  it('does not apply an old save response or notification after switching learning objects', async () => {
    let resolve!: (result: { question: ExtendedQuestion }) => void;
    const request = new Promise<{ question: ExtendedQuestion }>(done => { resolve = done; });
    mocks.updateQuestion.mockReturnValue(request);
    const review = renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Save First' }));
    await waitFor(() => expect(mocks.updateQuestion).toHaveBeenCalled());
    mocks.getQuestions.mockResolvedValue({ questions: [{ ...questions[1], _id: 'other', quiz: 'quiz2', questionText: 'Other learning object' }] });
    review.changeQuiz('quiz2');
    await screen.findByText('Other learning object');
    await act(async () => { resolve({ question: { ...questions[0], questionText: 'Saved first draft' } }); await request; });
    expect(screen.getAllByTestId('question-card')).toHaveLength(1);
    expect(screen.getByText('Other learning object')).toBeInTheDocument();
    expect(mocks.notify).not.toHaveBeenCalledWith('success', 'Question Saved', expect.any(String));
  });
});

describe('Review drafts when a batch is published', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuestions.mockResolvedValue({ questions });
    mocks.confirm.mockResolvedValue(true);
  });

  async function startDraft() {
    const review = renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit First' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft First' }), { target: { value: 'My unsaved question' } });
    return review;
  }

  it.each([false, true])('keeps retired drafts separate from a newly published list (empty=%s)', async empty => {
    const { store } = await startDraft();
    const published = empty ? [] : [{ ...questions[1], _id: 'new-question', questionText: 'New published question' }];
    act(() => store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: published })));
    expect(screen.getByRole('region', { name: 'Recovered unsaved edits' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('View recovered content'));
    const recovered = screen.getByRole('document', { name: 'Recovered question content' });
    expect(recovered).toHaveTextContent('My unsaved question');
    expect(recovered).toHaveTextContent('Answer true');
    expect(recovered).toHaveTextContent('Saved explanation');
    expect(recovered).not.toHaveTextContent('originalQuestionId');
    expect(screen.queryByRole('button', { name: 'Save First' })).not.toBeInTheDocument();
    expect(store.getState().question.questionsByQuiz.quiz1).toEqual(published);
    expect(selectHasReviewDrafts(store.getState(), 'quiz1')).toBe(true);
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
  });

  it('does not lose or restore a retired draft when a save response arrives after publication', async () => {
    let resolve!: (value: { question: ExtendedQuestion }) => void;
    mocks.updateQuestion.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { store } = await startDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save First' }));
    act(() => store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [questions[1]] })));
    await act(async () => resolve({ question: { ...questions[0], questionText: 'My unsaved question' } }));
    expect(screen.getByRole('region', { name: 'Recovered unsaved edits' })).toHaveTextContent('My unsaved question');
    expect(store.getState().question.questionsByQuiz.quiz1.map(q => q._id)).toEqual(['Second']);
    expect(mocks.notify).not.toHaveBeenCalledWith('success', 'Question Saved', expect.any(String));
  });

  it('keeps edits typed after saving began', async () => {
    let resolve!: (value: { question: ExtendedQuestion }) => void;
    mocks.updateQuestion.mockImplementation(() => new Promise(done => { resolve = done; }));
    await startDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save First' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft First' }), { target: { value: 'Typed during save' } });
    await act(async () => resolve({ question: { ...questions[0], questionText: 'My unsaved question' } }));
    expect(screen.getByRole('textbox', { name: 'Draft First' })).toHaveValue('Typed during save');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel First' }));
    expect(screen.getByText('My unsaved question')).toBeInTheDocument();
  });

  it('saves the full recovered content once using a new ID and keeps other published questions', async () => {
    let resolve!: (value: { question: ExtendedQuestion }) => void;
    mocks.createQuestion.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { store } = await startDraft();
    act(() => store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [questions[1]] })));
    const save = screen.getByRole('button', { name: 'Save as new question' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.createQuestion).toHaveBeenCalledTimes(1);
    expect(mocks.createQuestion).toHaveBeenCalledWith({ quizId: 'quiz1', learningObjectiveId: '', type: 'true-false', difficulty: 'easy', questionText: 'My unsaved question', content: {}, correctAnswer: true, explanation: 'Saved explanation' });
    // A concurrent list refresh can observe the created row before its POST
    // response arrives. The response must not append a second copy of that ID.
    act(() => store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [questions[1], { ...questions[0], _id: 'recovered-new', questionText: 'My unsaved question' }] })));
    await act(async () => resolve({ question: { ...questions[0], _id: 'recovered-new', questionText: 'My unsaved question' } }));
    expect(screen.queryByRole('region', { name: 'Recovered unsaved edits' })).not.toBeInTheDocument();
    expect(store.getState().question.questionsByQuiz.quiz1.map(q => q._id)).toEqual(['Second', 'recovered-new']);
    expect(selectHasReviewDrafts(store.getState(), 'quiz1')).toBe(false);
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
  });

  it('retains recovery after creation fails and only discards it after explicit confirmation', async () => {
    mocks.createQuestion.mockRejectedValue(new Error('Invalid recovered question'));
    const { store } = await startDraft();
    act(() => store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [] })));
    fireEvent.click(screen.getByRole('button', { name: 'Save as new question' }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('warning', 'Recovery Not Confirmed', expect.stringContaining('Your draft is still available')));
    expect(screen.getByRole('region', { name: 'Recovered unsaved edits' })).toBeInTheDocument();
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(selectHasReviewDrafts(store.getState(), 'quiz1')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits' }));
    await waitFor(() => expect(selectHasReviewDrafts(store.getState(), 'quiz1')).toBe(false));
  });

  it('can copy and download recovered contents without writing any question', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const createObjectURL = vi.fn().mockReturnValue('blob:recovery');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { store } = await startDraft();
    act(() => store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [] })));
    fireEvent.click(screen.getByRole('button', { name: 'Copy draft' }));
    expect(writeText.mock.calls[0][0]).toContain('Question\nMy unsaved question');
    expect(writeText.mock.calls[0][0]).toContain('Answer\ntrue');
    fireEvent.click(screen.getByRole('button', { name: 'Download draft' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovery');
    expect(mocks.createQuestion).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('isolates drafts by learning object and restores them when returning', async () => {
    const review = await startDraft();
    mocks.getQuestions.mockResolvedValue({ questions: [{ ...questions[1], _id: 'other', quiz: 'quiz2' }] });
    review.changeQuiz('quiz2');
    await screen.findByRole('button', { name: 'Edit other' });
    expect(screen.queryByDisplayValue('My unsaved question')).not.toBeInTheDocument();
    expect(selectHasReviewDrafts(review.store.getState(), 'quiz2')).toBe(false);
    mocks.getQuestions.mockResolvedValue({ questions });
    review.changeQuiz('quiz1');
    expect(await screen.findByRole('textbox', { name: 'Draft First' })).toHaveValue('My unsaved question');
  });
});
