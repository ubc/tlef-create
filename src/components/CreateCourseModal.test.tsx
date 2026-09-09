import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreateCourseModal from './CreateCourseModal';

vi.mock('./MaterialUpload', () => ({
  default: () => <div>Course material uploader</div>,
}));

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({ subscribe: vi.fn() }),
}));

vi.mock('../services/api', () => ({
  canvasApi: {
    getConfig: vi.fn().mockResolvedValue({ data: { enabled: false } }),
    getAuthStatus: vi.fn(),
  },
}));

describe('CreateCourseModal workflow', () => {
  it('shows labelled steps and advances after the course is named', () => {
    render(
      <CreateCourseModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Create New Course' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close create course dialog' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Create course steps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Course details/ })).toHaveAttribute('aria-current', 'step');

    fireEvent.change(screen.getByLabelText('Course Name'), { target: { value: 'CPSC 310' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByRole('button', { name: /Course materials/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Course material uploader')).toBeInTheDocument();
  });
});
