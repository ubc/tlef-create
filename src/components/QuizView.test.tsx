import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuizView from './QuizView';

const dispatch = vi.fn();
const navigate = vi.fn();

const state = {
  quiz: {
    currentQuiz: {
      _id: 'quiz-1',
      name: 'Test Learning Object',
      folder: { name: 'Test Course' },
      materials: ['material-1'],
      learningObjectives: [{ _id: 'objective-1', text: 'Analyze evidence', order: 0 }],
      questions: []
    },
    loading: false,
    error: null
  },
  material: { materials: [] },
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
  useSearchParams: () => [new URLSearchParams()]
}));

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({ showNotification: vi.fn(), publish: vi.fn() })
}));

vi.mock('./MaterialAssignment', () => ({ default: () => <div>Materials panel</div> }));
vi.mock('./LearningObjectives', () => ({ default: () => <div>Objectives panel</div> }));
vi.mock('./CoverageMapPanel', () => ({ default: () => <div data-testid="coverage-panel">Coverage panel</div> }));
vi.mock('./generation', () => ({ default: () => <div>Generation panel</div> }));
vi.mock('./review', () => ({ default: () => <div>Review panel</div> }));

describe('QuizView tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
    window.scrollTo = vi.fn();
  });

  it('preserves the current page position when Coverage Map is selected', async () => {
    render(<QuizView />);

    const coverageTab = await screen.findByRole('button', { name: 'Coverage Map' });
    await waitFor(() => expect(coverageTab).toBeEnabled());
    expect(coverageTab).toHaveAttribute('title', 'Coverage Map');

    fireEvent.click(coverageTab);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'auto' });
    expect(screen.getByTestId('coverage-panel').parentElement).toHaveStyle({ display: 'block' });
  });
});
