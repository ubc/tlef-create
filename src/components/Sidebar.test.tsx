import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';
import appReducer from '../store/slices/appSlice';
import quizReducer, { createQuiz } from '../store/slices/quizSlice';

const mocks = vi.hoisted(() => ({
  getFolders: vi.fn(),
}));

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue('subscription-token'),
  }),
}));

vi.mock('./CreateCourseModal', () => ({ default: () => null }));
vi.mock('./SearchModal', () => ({ default: () => null }));

vi.mock('../services/api', () => {
  class MockApiError extends Error {}

  return {
    ApiError: MockApiError,
    foldersApi: {
      getFolders: mocks.getFolders,
      createFolder: vi.fn(),
    },
    materialsApi: {},
    quizApi: {
      createQuiz: vi.fn(),
    },
  };
});

const createdQuiz = {
  _id: 'quiz-2',
  name: 'Quiz 2',
  folder: 'course-1',
  materials: [],
  learningObjectives: [],
  questions: [],
  generationPlans: [],
  settings: {
    pedagogicalApproach: 'support' as const,
    questionsPerObjective: 3,
    questionTypes: [],
    difficulty: 'moderate' as const,
  },
  status: 'draft' as const,
  progress: {
    materialsAssigned: false,
    objectivesSet: false,
    planGenerated: false,
    planApproved: false,
    questionsGenerated: false,
    reviewCompleted: false,
  },
  createdBy: 'user-1',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

describe('Sidebar Redux quiz synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFolders.mockResolvedValue({
      folders: [{
        _id: 'course-1',
        name: 'Test Course',
        instructor: 'user-1',
        materials: [],
        quizzes: [{ _id: 'quiz-1', name: 'Quiz 1', questions: ['question-1'] }],
        stats: {
          totalQuizzes: 1,
          totalQuestions: 1,
          totalMaterials: 0,
          lastActivity: '2026-07-20T00:00:00.000Z',
        },
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
      }],
    });
  });

  it('adds a Redux-created quiz to the expanded course without reloading folders', async () => {
    const store = configureStore({
      reducer: { app: appReducer, quiz: quizReducer },
      preloadedState: {
        app: {
          activeCourse: null,
          activeQuiz: null,
          user: {
            id: 'user-1',
            cwlId: 'faculty-user',
            displayName: 'Faculty User',
            isAdmin: false,
            stats: {
              coursesCreated: 1,
              quizzesGenerated: 1,
              questionsCreated: 1,
              totalUsageTime: 0,
            },
          },
        },
      },
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/course/course-1']}>
          <Sidebar />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText('Quiz 1')).toBeInTheDocument();

    const args = { name: 'Quiz 2', folderId: 'course-1' };
    store.dispatch(createQuiz.pending('request-1', args));
    store.dispatch(createQuiz.fulfilled(createdQuiz, 'request-1', args));

    await waitFor(() => {
      expect(screen.getByText('Quiz 2')).toBeInTheDocument();
    });
    expect(mocks.getFolders).toHaveBeenCalledTimes(1);
  });
});
