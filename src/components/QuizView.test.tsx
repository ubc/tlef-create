import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuizView from './QuizView';

const dispatch = vi.fn();
const navigate = vi.fn();
const setSearchParams = vi.fn();
let routeParams = new URLSearchParams();

const state = {
  quiz: {
    currentQuiz: {
      _id: 'quiz-1',
      name: 'Test Learning Object',
      folder: { name: 'Test Course' },
      materials: ['material-1'],
      learningObjectives: [{ _id: 'objective-1', text: 'Analyze evidence', order: 0 }],
      questions: [] as string[]
    },
    loading: false,
    error: null
  },
  material: { materials: [] as Array<{ _id: string; processingStatus: string }> },
  learningObjective: {
    objectives: [{ _id: 'objective-1', text: 'Analyze evidence', order: 0 }]
  }
};

vi.mock('react-redux', () => ({
  useDispatch: () => dispatch,
  useSelector: (selector: (value: typeof state) => unknown) => selector(state)
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ courseId: 'course-1', quizId: 'quiz-1' }),
  useNavigate: () => navigate,
  useSearchParams: () => [routeParams, setSearchParams]
}));

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({ showNotification: vi.fn(), publish: vi.fn() })
}));

vi.mock('./MaterialAssignment', () => ({ default: () => <div>Materials panel</div> }));
vi.mock('./LearningObjectives', () => ({ default: () => <div>Objectives panel</div> }));
vi.mock('./CoverageMapPanel', () => ({
  default: ({ isActive }: { isActive?: boolean }) => (
    <div data-testid="coverage-panel" data-active={String(Boolean(isActive))}>Coverage panel</div>
  )
}));
vi.mock('./generation', () => ({ default: () => <div>Generation panel</div> }));
vi.mock('./review', () => ({ default: () => <div>Review panel</div> }));

describe('QuizView tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParams = new URLSearchParams();
    state.quiz.currentQuiz.materials = ['material-1'];
    state.quiz.currentQuiz.questions = [];
    state.material.materials = [];
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
    window.scrollTo = vi.fn();
  });

  it('preserves the current page position when Coverage Map is selected', async () => {
    render(<QuizView />);

    expect(screen.getByRole('navigation', { name: 'Quiz creation steps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Blueprint & Generate/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preview & Export/ })).toBeDisabled();

    const coverageTab = await screen.findByRole('button', { name: 'Coverage Map' });
    await waitFor(() => expect(coverageTab).toBeEnabled());
    expect(coverageTab).toHaveAttribute('title', 'Open Coverage Map');
    expect(screen.getByTestId('coverage-panel')).toHaveAttribute('data-active', 'false');

    fireEvent.click(coverageTab);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'auto' });
    expect(screen.getByTestId('coverage-panel').parentElement).toHaveStyle({ display: 'block' });
    expect(screen.getByTestId('coverage-panel')).toHaveAttribute('data-active', 'true');
  });

  it('restores Materials when browser navigation returns to step 1', async () => {
    routeParams = new URLSearchParams('tab=generation');
    const view = render(<QuizView />);
    expect(screen.getByRole('button', { name: /Blueprint & Generate/ })).toHaveAttribute('aria-current', 'step');
    routeParams = new URLSearchParams('tab=materials');
    view.rerender(<QuizView />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Materials/ })).toHaveAttribute('aria-current', 'step'));
    expect(screen.getByText('Materials panel').parentElement).toHaveStyle({ display: 'block' });
  });

  it('does not mark processing sources complete and refreshes the step once ready', async () => {
    state.material.materials = [{ _id: 'material-1', processingStatus: 'processing' }];
    const view = render(<QuizView />);
    expect(await screen.findByRole('button', { name: /Materials Checking or processing sources/ })).toBeInTheDocument();
    state.material.materials = [{ _id: 'material-1', processingStatus: 'completed' }];
    view.rerender(<QuizView />);
    expect(await screen.findByRole('button', { name: /Materials Ready · 1 assigned/ })).toBeInTheDocument();
  });

  it('keeps existing questions reviewable when assigned materials have been removed', async () => {
    state.quiz.currentQuiz.materials = [];
    state.quiz.currentQuiz.questions = ['question-1'];
    render(<QuizView />);
    expect(await screen.findByRole('button', { name: /^Review / })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Preview & Export/ })).toBeEnabled();
  });
});
