import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreateCourseModal from './CreateCourseModal';
import { canvasApi } from '../services/api';

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
    expect(screen.getByRole('tablist', { name: 'Create course steps' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Course details/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Course materials/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('tabpanel', { name: /Course details/ })).toContainElement(screen.getByLabelText('Course Name'));

    fireEvent.change(screen.getByLabelText('Course Name'), { target: { value: 'CPSC 310' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByRole('tab', { name: /Course materials/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /Course materials/ })).toContainElement(screen.getByText('Course material uploader'));

    fireEvent.click(screen.getByRole('tab', { name: /Course details/ }));
    expect(screen.getByLabelText('Course Name')).toHaveValue('CPSC 310');
  });
  it('offers Canvas connection before the user is connected', async () => {
    vi.mocked(canvasApi.getConfig).mockResolvedValueOnce({ data: { enabled: true } } as never);
    vi.mocked(canvasApi.getAuthStatus).mockResolvedValueOnce({ data: { connected: false } } as never);
    render(<CreateCourseModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} />);
    await screen.findByRole('tab', { name: /^Canvas/ });
    fireEvent.change(screen.getByLabelText('Course Name'), { target: { value: 'Canvas QA' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('button', { name: 'Connect to Canvas' })).toBeInTheDocument();
  });

});
