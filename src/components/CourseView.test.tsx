import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CourseView from './CourseView';
import quizReducer from '../store/slices/quizSlice';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn(),
  createQuiz: vi.fn(),
  getFolder: vi.fn(),
  getMaterials: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ courseId: 'course-1' }),
}));

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({
    publish: mocks.publish,
    subscribe: mocks.subscribe,
    showNotification: vi.fn(),
  }),
}));

vi.mock('./MaterialUpload', () => ({
  default: () => <div>Materials</div>,
}));

vi.mock('./CoursePromptSettings', () => ({
  default: () => <div>Course Prompts</div>,
}));

vi.mock('../services/api', () => {
  class MockApiError extends Error {
    isNotFoundError() { return false; }
    isAuthError() { return false; }
  }

  return {
    ApiError: MockApiError,
    foldersApi: {
      getFolder: mocks.getFolder,
      deleteFolder: vi.fn(),
    },
    materialsApi: {
      getMaterials: mocks.getMaterials,
    },
    quizApi: {
      createQuiz: mocks.createQuiz,
    },
  };
});

const existingQuiz = {
  _id: 'quiz-1',
  name: 'Quiz 1',
  questions: ['question-1'],
};

const createdQuiz = {
  _id: 'quiz-2',
  name: 'Quiz 2',
  folder: 'course-1',
  materials: [],
  learningObjectives: [],
  questions: [],
  generationPlans: [],
  settings: {
    pedagogicalApproach: 'support',
    questionsPerObjective: 3,
    questionTypes: [],
    difficulty: 'moderate',
  },
  status: 'draft',
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

describe('CourseView quiz creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribe.mockReturnValue('subscription-token');
    mocks.getFolder.mockResolvedValue({
      folder: {
        _id: 'course-1',
        name: 'Test Course',
        quizzes: [existingQuiz],
      },
    });
    mocks.getMaterials.mockResolvedValue({ materials: [] });
    mocks.createQuiz.mockResolvedValue({ quiz: createdQuiz });
  });

  it('shows Add Quiz when quizzes exist and stores a newly created quiz in Redux', async () => {
    const store = configureStore({ reducer: { quiz: quizReducer } });

    render(
      <Provider store={store}>
        <CourseView />
      </Provider>
    );

    expect(await screen.findByText('Quizzes (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Quiz' }));

    await waitFor(() => {
      expect(store.getState().quiz.quizzes).toEqual([createdQuiz]);
      expect(store.getState().quiz.selectedFolderId).toBe('course-1');
    });

    expect(mocks.publish).toHaveBeenCalledWith('quiz-created', {
      quizId: 'quiz-2',
      courseId: 'course-1',
      quizName: 'Quiz 2',
      quiz: createdQuiz,
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/course/course-1/quiz/quiz-2');
  });
});
