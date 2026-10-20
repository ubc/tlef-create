import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasExportModal from './CanvasExportModal';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(), getAuthStatus: vi.fn(), getCourses: vi.fn(), getModules: vi.fn(),
  getConnectUrl: vi.fn(), createModule: vi.fn(), exportToCanvas: vi.fn(), disconnect: vi.fn()
}));
const folderMocks = vi.hoisted(() => ({ setLinkedCanvasCourse: vi.fn() }));
vi.mock('../../services/api', () => ({ canvasApi: mocks, foldersApi: folderMocks }));

const renderModal = (linkedCanvasCourseId?: string, onLinkedCanvasCourseChange?: (id: string) => void) => render(
  <CanvasExportModal isOpen onClose={vi.fn()} quizId="quiz" quizName="Quiz 1" folderId="folder"
    linkedCanvasCourseId={linkedCanvasCourseId} onLinkedCanvasCourseChange={onLinkedCanvasCourseChange}
    showNotification={vi.fn()} />
);

describe('CanvasExportModal linked course', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockResolvedValue({ data: { enabled: true } });
    mocks.getAuthStatus.mockResolvedValue({ data: { connected: true } });
    mocks.getCourses.mockResolvedValue({ data: { courses: [
      // Canvas returns numeric IDs; the linked ID is stored as a string.
      { id: 2, name: 'Physics', courseCode: 'PHYS' },
      { id: 3, name: 'Chemistry', courseCode: 'CHEM' }
    ] } });
    mocks.getModules.mockResolvedValue({ data: { modules: [] } });
  });

  it('opens on the module step for the linked course and offers to create a module', async () => {
    renderModal('2');
    await screen.findByText('No modules found. Create one below.');
    expect(screen.getByText('Physics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to courses' })).toBeInTheDocument();
    expect(mocks.getModules).toHaveBeenCalledWith(2);
  });

  it('shows the course list with a notice when the linked course is not available', async () => {
    renderModal('99');
    await screen.findByText(/linked to this course isn't available/);
    expect(screen.getByText('Chemistry')).toBeInTheDocument();
    expect(mocks.getModules).not.toHaveBeenCalled();
  });

  it('lets the user save a different course as the linked course', async () => {
    folderMocks.setLinkedCanvasCourse.mockResolvedValue({ folder: {} });
    const onLinked = vi.fn();
    renderModal('2', onLinked);
    await screen.findByText('No modules found. Create one below.');
    expect(screen.queryByRole('button', { name: /Set as linked course/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to courses' }));
    fireEvent.click(await screen.findByText('Chemistry'));
    fireEvent.click(await screen.findByRole('button', { name: /Set as linked course/ }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith('3'));
    expect(folderMocks.setLinkedCanvasCourse).toHaveBeenCalledWith('folder', '3');
  });

  it('asks for a course when none is linked', async () => {
    renderModal();
    await screen.findByText('Chemistry');
    expect(screen.queryByText(/isn't available/)).not.toBeInTheDocument();
    expect(mocks.getModules).not.toHaveBeenCalled();
  });
});
