import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import H5PStudio from './H5PStudio';

const mocks = vi.hoisted(() => ({
  getEditorModel: vi.fn(),
  listContents: vi.fn(),
  save: vi.fn(),
  showNotification: vi.fn()
}));

vi.mock('@lumieducation/h5p-react', () => ({
  H5PEditorUI: forwardRef((props: {
    contentId: string;
    loadContentCallback: (contentId: string) => Promise<unknown>;
    onLoaded: () => void;
  }, ref) => {
    const { contentId, loadContentCallback } = props;
    const onLoadedRef = useRef(props.onLoaded);
    onLoadedRef.current = props.onLoaded;
    useImperativeHandle(ref, () => ({ save: mocks.save }));

    useEffect(() => {
      void loadContentCallback(contentId).then(() => onLoadedRef.current());
    }, [contentId, loadContentCallback]);

    return <div data-testid="h5p-editor" />;
  })
}));

vi.mock('../services/api', () => ({
  ApiError: class ApiError extends Error {},
  h5pEditorApi: {
    createContent: vi.fn(),
    createFromQuiz: vi.fn(),
    deleteContent: vi.fn(),
    downloadContent: vi.fn(),
    getEditorModel: mocks.getEditorModel,
    importContent: vi.fn(),
    listContents: mocks.listContents,
    updateContent: vi.fn()
  }
}));

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({ showNotification: mocks.showNotification })
}));

vi.mock('../components/system-dialog/SystemDialogProvider', () => ({
  useSystemDialog: () => ({ showConfirm: vi.fn() })
}));

describe('H5PStudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listContents.mockResolvedValue({
      data: {
        contents: [{
          id: 'record-1',
          contentId: 'content-1',
          title: 'Example activity',
          mainLibrary: 'H5P.MultiChoice',
          source: 'editor',
          status: 'ready',
          lastEditedAt: '2026-08-05T00:00:00.000Z',
          createdAt: '2026-08-05T00:00:00.000Z',
          updatedAt: '2026-08-05T00:00:00.000Z'
        }]
      }
    });
    mocks.getEditorModel.mockResolvedValue({ data: { model: { library: 'H5P.MultiChoice 1.16' } } });
    mocks.save.mockResolvedValue({ contentId: 'content-1' });
  });

  it('keeps the loaded editor active when the selected content is clicked again', async () => {
    render(
      <MemoryRouter initialEntries={['/h5p-studio?contentId=content-1']}>
        <H5PStudio />
      </MemoryRouter>
    );

    await waitFor(() => expect(mocks.getEditorModel).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByText('Loading the official H5P editor…')).not.toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole('button', { name: /Example activity/ }));

    expect(mocks.getEditorModel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Loading the official H5P editor…')).not.toBeInTheDocument();
    expect(screen.getByTestId('h5p-editor')).toBeInTheDocument();
  });

  it('saves before preview and keeps the active preview step stable', async () => {
    render(<MemoryRouter initialEntries={['/h5p-studio?contentId=content-1']}><H5PStudio /></MemoryRouter>);
    const preview = await screen.findByRole('button', { name: 'Save & preview' });
    await waitFor(() => expect(preview).toBeEnabled());
    fireEvent.click(preview);
    await screen.findByTitle('Preview Example activity');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Preview & download Save/ }));
    expect(screen.getByTitle('Preview Example activity')).toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
    await screen.findByTestId('h5p-editor');
    expect(screen.queryByTitle('Preview Example activity')).not.toBeInTheDocument();
  });

  it('does not preview a stale saved copy when current editor validation fails', async () => {
    mocks.save.mockResolvedValue(undefined);
    render(<MemoryRouter initialEntries={['/h5p-studio?contentId=content-1']}><H5PStudio /></MemoryRouter>);
    const preview = await screen.findByRole('button', { name: 'Save & preview' });
    await waitFor(() => expect(preview).toBeEnabled());
    fireEvent.click(preview);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(screen.queryByTitle('Preview Example activity')).not.toBeInTheDocument();
    expect(screen.getByTestId('h5p-editor')).toBeInTheDocument();
  });
});
