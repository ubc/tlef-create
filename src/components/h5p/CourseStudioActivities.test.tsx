import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CourseStudioActivities from './CourseStudioActivities';
const list = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ h5pEditorApi: { listContents: list } }));
const content = { contentId: 'studio-1', title: 'Course reflection', quizId: 'quiz-1', status: 'ready', mainLibrary: 'H5P.DocumentationTool', updatedAt: '2026-09-20' };
const view = (courseId = 'course-1') => <MemoryRouter><CourseStudioActivities courseId={courseId} learningObjects={[{ id: 'quiz-1', name: 'Reflection' }]} /></MemoryRouter>;
describe('course Studio activity navigation', () => {
  beforeEach(() => { vi.clearAllMocks(); list.mockResolvedValue({ data: { contents: [content] } }); });
  it('loads only the course scope and links to the same activity and guided source', async () => {
    render(view());
    expect(await screen.findByText('Course reflection')).toBeVisible();
    expect(list).toHaveBeenCalledWith({ folderId: 'course-1' });
    expect(screen.getByRole('link', { name: 'Continue in Studio' })).toHaveAttribute('href', '/h5p-studio?contentId=studio-1');
    expect(screen.getByRole('link', { name: 'Course source: Reflection' })).toHaveAttribute('href', '/course/course-1/quiz/quiz-1?tab=review');
    expect(screen.getByText(/Studio saves its own version/)).toBeVisible();
  });
  it('ignores a previous course response after navigation', async () => {
    let finish!: (value: unknown) => void;
    list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ data: { contents: [] } });
    const rendered = render(view());
    rendered.rerender(view('course-2'));
    await act(async () => { finish({ data: { contents: [content] } }); });
    expect(screen.queryByText('Course reflection')).not.toBeInTheDocument();
    expect(screen.getByText(/Open a learning object's/)).toBeVisible();
  });
  it('offers retry on failure and does not label it an empty course', async () => {
    list.mockRejectedValueOnce(new Error('offline'));
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Course reflection')).toBeVisible();
  });
});
