import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuestionGeneration from './QuestionGeneration';
import questionReducer, { setQuestionsForQuiz, startReviewDraft } from '../../store/slices/questionSlice';
import type { Question } from '../../services/api';

const mocks = vi.hoisted(() => ({ start: vi.fn(), getQuiz: vi.fn(), updateQuiz: vi.fn(), readiness: vi.fn(), notify: vi.fn() }));
vi.mock('../../services/api', () => ({
  ApiError: class extends Error {},
  questionsApi: { checkGenerationReadiness: mocks.readiness, getQuestions: vi.fn().mockResolvedValue({ questions: [] }) },
  quizApi: { getQuiz: mocks.getQuiz, updateQuiz: mocks.updateQuiz }, plansApi: {}
}));
vi.mock('../../hooks/useQuestionGenerationJob', () => ({
  isGenerationJobActive: () => false,
  useQuestionGenerationJob: () => ({ start: mocks.start, isBusy: false, job: null, refresh: vi.fn() })
}));
vi.mock('../../hooks/useSSE', () => ({ useSSE: () => ({ connectionStatus: 'disconnected' }) }));
vi.mock('../../hooks/usePubSub', () => ({ usePubSub: () => ({ showNotification: mocks.notify }) }));
vi.mock('../system-dialog/SystemDialogProvider', () => ({ useSystemDialog: () => ({ showConfirm: vi.fn() }) }));
vi.mock('../../hooks/useFeatureOnboarding', () => ({ useFeatureOnboarding: () => ({ isActive: false, isCompleted: true }) }));
vi.mock('../onboarding/FeatureCoachmark', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./GenerationJobStatus', () => ({ default: () => null }));
vi.mock('./PlanEditor', () => ({ default: () => <div>Test blueprint</div> }));
vi.mock('./GenerationSetup', () => ({ default: () => null }));
vi.mock('./AIConfigPanel', () => ({ default: () => null }));
vi.mock('./AIPlanGenerationTrace', () => ({ default: () => null }));
vi.mock('./StreamingProgress', () => ({ default: () => <div>Started generation</div> }));
vi.mock('./PromptAnalysisSection', () => ({ default: () => null }));
vi.mock('../CoursePromptSettings', () => ({ default: () => null }));

const question = { _id: 'q1', quiz: 'quiz1', questionText: 'Saved question', type: 'true-false', learningObjective: 'lo1' } as Question;
const quiz = { _id: 'quiz1', settings: { targetFormat: 'column', planItems: [{ type: 'true-false', learningObjective: 'lo1', count: 1 }] } };
const objectives = [{ _id: 'lo1', text: 'Explain condensation', order: 0 }];
async function setup(draftQuiz?: string) {
  const store = configureStore({ reducer: {
    question: questionReducer,
    app: () => ({ user: { id: 'owner1' } }),
    quiz: () => ({ currentQuiz: quiz })
  } });
  store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [question] }));
  if (draftQuiz) {
    store.dispatch(setQuestionsForQuiz({ quizId: draftQuiz, questions: [question] }));
    store.dispatch(startReviewDraft({ quizId: draftQuiz, questionId: 'q1' }));
  }
  render(<Provider store={store}><QuestionGeneration quizId="quiz1" assignedMaterials={[]} learningObjectives={objectives} /></Provider>);
  fireEvent.click(await screen.findByRole('button', { name: /Back to AI Plan Configuration/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Generate 1 Question' }));
  return store;
}

describe('generation protects unsaved Review drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuiz.mockResolvedValue({ quiz });
    mocks.updateQuiz.mockResolvedValue({ quiz });
    mocks.readiness.mockResolvedValue({ ready: true });
    mocks.start.mockResolvedValue(undefined);
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('disables replacement while a draft exists but allows append', async () => {
    await setup('quiz1');
    expect(screen.getByRole('button', { name: 'Replace Existing Questions' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('unsaved Review edits');
    fireEvent.click(screen.getByRole('button', { name: 'Add New Questions' }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(mocks.start).toHaveBeenCalledWith(expect.any(Array), 'append');
  });

  it('does not block another learning object because of an unrelated draft', async () => {
    await setup('quiz2');
    expect(screen.getByRole('button', { name: 'Replace Existing Questions' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace Existing Questions' }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith(expect.any(Array), 'replace'));
  });

  it('checks shared drafts again after asynchronous preparation and starts no replacement', async () => {
    let resolve!: (value: { ready: boolean }) => void;
    mocks.readiness.mockImplementation(() => new Promise(done => { resolve = done; }));
    const store = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Replace Existing Questions' }));
    await waitFor(() => expect(mocks.readiness).toHaveBeenCalledOnce());
    act(() => store.dispatch(startReviewDraft({ quizId: 'quiz1', questionId: 'q1' })));
    await act(async () => resolve({ ready: true }));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(store.getState().question.questionsByQuiz.quiz1).toEqual([question]);
    expect(mocks.notify).toHaveBeenCalledWith('warning', 'Unsaved Review Edits', expect.any(String));
  });

  it('also blocks replacement for a recovered draft whose ID is retired', async () => {
    const store = await setup('quiz1');
    act(() => store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [{ ...question, _id: 'new' }] })));
    expect(screen.getByRole('button', { name: 'Replace Existing Questions' })).toBeDisabled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
