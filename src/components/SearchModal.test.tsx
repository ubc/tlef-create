import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchModal from './SearchModal';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  getFolder: vi.fn(),
  getProcessingStatus: vi.fn(),
  getQuiz: vi.fn()
}));

vi.mock('../services/api', () => ({
  searchApi: { search: mocks.search },
  foldersApi: { getFolder: mocks.getFolder },
  materialsApi: { getProcessingStatus: mocks.getProcessingStatus },
  quizApi: { getQuiz: mocks.getQuiz }
}));

describe('SearchModal stale results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes a quiz result when its deleted course can no longer be resolved', async () => {
    mocks.search.mockResolvedValue({
      data: {
        results: [{
          type: 'question',
          id: 'question-1',
          title: 'Quiz 2 question',
          snippet: 'A stale result',
          courseName: 'Test',
          courseId: 'deleted-course',
          quizName: 'Quiz 2',
          quizId: 'deleted-quiz',
          navigationPath: '/course/deleted-course/quiz/deleted-quiz?tab=review&questionId=question-1'
        }]
      }
    });
    mocks.getQuiz.mockRejectedValue(new Error('Quiz not found'));

    render(
      <MemoryRouter>
        <SearchModal isOpen onClose={vi.fn()} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/Search materials/i), {
      target: { value: 'Quiz 2' }
    });
    const resultTitle = await screen.findByText('Quiz 2 question');
    fireEvent.click(resultTitle.closest('.search-result-card')!);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer available/i);
    expect(screen.queryByText('Quiz 2 question')).not.toBeInTheDocument();
  });
});
