import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

const mocks = vi.hoisted(() => ({
  getFolders: vi.fn(),
  navigate: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn()
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock('../hooks/redux', () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => selector({
    app: { user: { displayName: 'Faculty User' } }
  })
}));

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({ publish: mocks.publish, subscribe: mocks.subscribe })
}));

vi.mock('../services/api', async importOriginal => {
  const original = await importOriginal<typeof import('../services/api')>();
  return {
    ...original,
    foldersApi: { ...original.foldersApi, getFolders: mocks.getFolders }
  };
});

const completedMaterial = {
  _id: 'material-1',
  name: 'Lecture notes',
  processingStatus: 'completed' as const,
  updatedAt: '2026-09-03T16:00:00.000Z'
};

const folder = {
  _id: 'course-1',
  name: 'CPSC',
  instructor: 'user-1',
  materials: [completedMaterial],
  quizzes: [
    {
      _id: 'quiz-1',
      name: 'Quiz 1',
      questions: Array.from({ length: 19 }, (_, index) => `question-${index}`),
      updatedAt: '2026-09-03T17:00:00.000Z',
      progress: {
        materialsAssigned: true,
        objectivesSet: true,
        planGenerated: true,
        planApproved: true,
        questionsGenerated: true,
        reviewCompleted: false
      }
    },
    {
      _id: 'quiz-2',
      name: 'Quiz 2',
      questions: [],
      updatedAt: '2026-09-02T17:00:00.000Z',
      progress: {
        materialsAssigned: false,
        objectivesSet: false,
        planGenerated: false,
        planApproved: false,
        questionsGenerated: false,
        reviewCompleted: false
      }
    }
  ],
  stats: {
    totalQuizzes: 2,
    totalQuestions: 19,
    totalMaterials: 1,
    lastActivity: '2026-09-03T17:00:00.000Z'
  },
  createdAt: '2026-09-01T17:00:00.000Z',
  updatedAt: '2026-09-03T17:00:00.000Z'
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses actual question counts and keeps existing questions reviewable when progress is stale', async () => {
    mocks.getFolders.mockResolvedValue({ folders: [{ ...folder, materials: [], stats: { ...folder.stats, totalQuestions: 999 }, quizzes: [{ ...folder.quizzes[0], progress: {} }] }] });
    render(<Dashboard />);
    expect(await screen.findByRole('button', { name: /Continue Review/ })).toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
  });

  it('turns course progress into a dynamic next action and attention list', async () => {
    mocks.getFolders.mockResolvedValue({ folders: [folder] });
    render(<Dashboard />);

    expect(await screen.findByRole('heading', { name: 'Continue where you left off' })).toBeInTheDocument();
    expect(screen.getByText('Total Quizzes')).toBeInTheDocument();
    expect(screen.getByText('Estimated Time Saved')).toBeInTheDocument();
    expect(screen.getAllByText('Review generated questions').length).toBeGreaterThan(0);
    expect(screen.getByText('CPSC · Quiz 2')).toBeInTheDocument();
    expect(screen.getByText('Assign materials to this Quiz')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Continue Review/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/course/course-1/quiz/quiz-1?tab=review');
  });

  it('shows the short onboarding state only when no courses exist', async () => {
    mocks.getFolders.mockResolvedValue({ folders: [] });
    render(<Dashboard />);

    expect(await screen.findByRole('heading', { name: 'Create your first course' })).toBeInTheDocument();
    expect(screen.queryByText('Continue where you left off')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Create Your First Course/ }));
    expect(mocks.publish).toHaveBeenCalledWith('open-create-course', {});
  });

  it('offers a retry when the dashboard request fails', async () => {
    mocks.getFolders.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ folders: [folder] });
    render(<Dashboard />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load courses');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(mocks.getFolders).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Continue where you left off')).toBeInTheDocument();
  });
});
