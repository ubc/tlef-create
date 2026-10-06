import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasMaterialImportModal from './CanvasMaterialImportModal';
const mocks = vi.hoisted(() => ({ getConfig: vi.fn(), getAuthStatus: vi.fn(), getImportCourses: vi.fn(), getImportMaterials: vi.fn(), importMaterials: vi.fn(), getConnectUrl: vi.fn() }));
vi.mock('../services/api', () => ({ canvasApi: mocks }));
const resources = [
  { id: '4', resourceType: 'file', name: 'Lecture.pdf', materialType: 'pdf', supported: true },
  { id: '1', resourceType: 'page', name: 'Lesson page', materialType: 'text', supported: true },
  { id: '5', resourceType: 'file', name: 'Slides.pptx', supported: false, reason: 'Convert to PDF or DOCX.' }
];
async function open() {
  const onClose = vi.fn(); const onImported = vi.fn();
  render(<CanvasMaterialImportModal isOpen folderId="folder" onClose={onClose} onImported={onImported} />);
  await screen.findByRole('combobox', { name: 'Canvas course' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
  await screen.findByText('Lecture.pdf');
  return { onClose, onImported };
}
describe('Canvas material import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockResolvedValue({ data: { enabled: true } });
    mocks.getAuthStatus.mockResolvedValue({ data: { connected: true } });
    mocks.getImportCourses.mockResolvedValue({ data: { courses: [{ id: '2', name: 'Physics', courseCode: 'PHYS' }] } });
    mocks.getImportMaterials.mockResolvedValue({ data: { resources, warnings: [], batchLimit: 10, maxFileBytes: 50 * 1024 * 1024 } });
  });
  it('selects multiple supported sources, displays partial results and leaves failed items selected for retry', async () => {
    const { onImported } = await open();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[2]).toBeDisabled(); fireEvent.click(boxes[0]); fireEvent.click(boxes[1]);
    mocks.importMaterials.mockResolvedValue({ data: { summary: { imported: 1, skipped: 0, failed: 1 }, results: [
      { ...resources[0], status: 'imported', message: 'Saved.' }, { ...resources[1], status: 'failed', message: 'Canvas denied access.' }
    ] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 selected' }));
    await screen.findByText('1 imported · 0 already present · 1 failed');
    expect(mocks.importMaterials).toHaveBeenCalledWith('folder', '2', [{ id: '4', resourceType: 'file' }, { id: '1', resourceType: 'page' }]);
    expect(onImported).toHaveBeenCalledOnce();
    expect(boxes[0]).not.toBeChecked(); expect(boxes[1]).toBeChecked();
  });
  it('enforces the batch limit while retaining selection after a request failure', async () => {
    mocks.getImportMaterials.mockResolvedValue({ data: { resources, warnings: [], batchLimit: 1, maxFileBytes: 1000000 } });
    await open(); const boxes = screen.getAllByRole('checkbox'); fireEvent.click(boxes[0]);
    expect(boxes[1]).toBeDisabled();
    mocks.importMaterials.mockRejectedValue(new Error('Reconnect Canvas.'));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 selected' }));
    await screen.findByRole('alert');
    expect(boxes[0]).toBeChecked(); expect(screen.getByText('Reconnect Canvas.')).toBeInTheDocument();
  });
  it('keeps loading and close protection while a batch is in flight', async () => {
    const { onClose } = await open(); let finish!: (value: unknown) => void;
    mocks.importMaterials.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]); fireEvent.click(screen.getByRole('button', { name: 'Import 1 selected' }));
    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Close' })) fireEvent.click(button);
    expect(onClose).not.toHaveBeenCalled();
    finish({ data: { summary: { imported: 0, skipped: 1, failed: 0 }, results: [{ ...resources[0], status: 'skipped', message: 'Already present.' }] } });
    await screen.findByText('0 imported · 1 already present · 0 failed');
  });
  it('distinguishes a denied catalog from an empty course', async () => {
    mocks.getImportMaterials.mockResolvedValue({ data: { resources: [], warnings: [{ message: 'Enable file read permissions.' }], batchLimit: 10, maxFileBytes: 50000000 } });
    render(<CanvasMaterialImportModal isOpen folderId="folder" onClose={vi.fn()} />);
    await screen.findByRole('combobox'); fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    await screen.findByRole('alert');
    expect(screen.getByText('Enable file read permissions.')).toBeInTheDocument();
    expect(screen.getByText('No materials could be listed. Review the access messages above.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect Canvas' })).toBeInTheDocument();
  });
  it('explains unavailable configuration and handles blocked sign-in popups', async () => {
    mocks.getAuthStatus.mockResolvedValue({ data: { connected: false } });
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<CanvasMaterialImportModal isOpen folderId="folder" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect to Canvas' }));
    await screen.findByText('Allow pop-ups for CREATE, then select Connect to Canvas again.');
    expect(mocks.getConnectUrl).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
