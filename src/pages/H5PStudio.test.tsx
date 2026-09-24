import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import H5PStudio from './H5PStudio';

const mocks = vi.hoisted(() => ({
  getEditorModel: vi.fn(),
  getSourceStatus: vi.fn(),
  listContents: vi.fn(),
  updateContent: vi.fn(),
  save: vi.fn(),
  showNotification: vi.fn(),
  editor: { current: null as null | {
    contentId: string;
    props: {
      saveContentCallback: (contentId: string, request: unknown) => Promise<{ contentId: string; metadata: unknown }>;
      onSaved?: (contentId: string, metadata: unknown) => void;
    };
    request: { library: string; params: { metadata: { title: string }; params: { question: string } } };
  } }
}));

vi.mock('../hooks/redux', () => ({ useAppSelector: () => 'test-author' }));

vi.mock('../components/h5p/StudioAssistant', () => ({ default: function MockStudioAssistant({ sessionId, initialQuizId, initialInstructions, initialMaterialIds, onSessionChange, onOpenActivity, onDirtyChange }: {
  sessionId?: string; initialQuizId?: string; initialInstructions?: string; initialMaterialIds?: string[]; onSessionChange: (id: string) => void; onOpenActivity: (id: string, preview: boolean) => void; onDirtyChange: (dirty: boolean) => void;
}) { const [brief, setBrief] = useState(initialInstructions || ''); return <section aria-label="Assistant workspace"><span>Session: {sessionId || 'new'}</span><span>Source: {initialQuizId || 'none'}</span><span>Materials: {initialMaterialIds?.join(',') || 'none'}</span>
  <label>Course task<input value={brief} onChange={event => setBrief(event.target.value)} /></label>
  <button onClick={() => onDirtyChange(true)}>Edit course plan</button>
  <button onClick={() => onSessionChange('saved-assistant')}>Create assistant task</button>
  <button onClick={() => onOpenActivity('content-1', false)}>Open assistant output</button>
  <button onClick={() => onOpenActivity('content-1', true)}>Preview assistant output</button>
</section>; } }));

vi.mock('../components/h5p/StudioAIComposer', () => ({ default: function MockStudioAIComposer({ quizId, onBuildCourseQuestions }: { quizId?: string; onBuildCourseQuestions: (brief: { courseId: string; quizId: string; materialIds: string[]; instructions: string }) => void }) { const [brief, setBrief] = useState(''); return <section aria-label="Create with AI workspace"><span>Source: {quizId || 'none'}</span><label>Teaching instructions<input value={brief} onChange={event => setBrief(event.target.value)} /></label><button onClick={() => onBuildCourseQuestions({ courseId: 'course-1', quizId: 'quiz-1', materialIds: ['material-1'], instructions: 'Teach net force.' })}>Build linked course questions</button></section>; } }));

vi.mock('@lumieducation/h5p-react', () => ({
  H5PEditorUI: forwardRef((props: {
    contentId: string;
    loadContentCallback: (contentId: string) => Promise<unknown>;
    onLoaded: () => void;
    saveContentCallback: (contentId: string, request: unknown) => Promise<{ contentId: string; metadata: unknown }>;
    onSaved?: (contentId: string, metadata: unknown) => void;
  }, ref) => {
    const { contentId, loadContentCallback } = props;
    const [title, setTitle] = useState('Example activity');
    const onLoadedRef = useRef(props.onLoaded);
    onLoadedRef.current = props.onLoaded;
    useImperativeHandle(ref, () => ({ save: mocks.save }));
    mocks.editor.current = {
      contentId,
      props,
      request: {
        library: 'H5P.MultiChoice 1.16',
        params: { metadata: { title }, params: { question: title } }
      }
    };

    useEffect(() => {
      void loadContentCallback(contentId).then(() => onLoadedRef.current());
    }, [contentId, loadContentCallback]);

    return <div data-testid="h5p-editor"><label>H5P title<input value={title} onChange={event => setTitle(event.target.value)} /></label></div>;
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
    getSourceStatus: mocks.getSourceStatus,
    importContent: vi.fn(),
    listContents: mocks.listContents,
    updateContent: mocks.updateContent
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
    mocks.getSourceStatus.mockResolvedValue({ data: { source: { state: 'standalone' } } });
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
    mocks.getEditorModel.mockResolvedValue({ data: { model: {
      library: 'H5P.MultiChoice 1.16',
      metadata: {
        title: 'Example activity',
        authors: [],
        preloadedDependencies: [{ machineName: 'H5P.MultiChoice', majorVersion: 1, minorVersion: 16 }]
      },
      params: { question: 'Example activity', media: { type: null } }
    } } });
    mocks.updateContent.mockResolvedValue({ data: {
      contentId: 'content-1',
      metadata: { title: 'Updated activity' },
      content: { contentId: 'content-1' }
    } });
    mocks.save.mockImplementation(async () => {
      const editor = mocks.editor.current;
      if (!editor) return undefined;
      const result = await editor.props.saveContentCallback(editor.contentId, editor.request);
      editor.props.onSaved?.(result.contentId, result.metadata);
      return result;
    });
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

  it('opens an unchanged saved activity without another persistence write', async () => {
    render(<MemoryRouter initialEntries={['/h5p-studio?contentId=content-1']}><H5PStudio /></MemoryRouter>);
    const preview = await screen.findByRole('button', { name: 'Preview' });
    await waitFor(() => expect(preview).toBeEnabled());
    fireEvent.click(preview);
    await screen.findByTitle('Preview Example activity');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.updateContent).not.toHaveBeenCalled();
    expect(mocks.showNotification).not.toHaveBeenCalledWith(
      'success', expect.any(String), expect.any(String)
    );
    expect(screen.queryByRole('navigation', { name: 'H5P activity workflow' })).not.toBeInTheDocument();
    expect(screen.queryByText('Create a draft')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
    await screen.findByTestId('h5p-editor');
    expect(screen.queryByTitle('Preview Example activity')).not.toBeInTheDocument();
  });

  it('does not preview a stale saved copy when current editor validation fails', async () => {
    mocks.save.mockResolvedValue(undefined);
    render(<MemoryRouter initialEntries={['/h5p-studio?contentId=content-1']}><H5PStudio /></MemoryRouter>);
    const preview = await screen.findByRole('button', { name: 'Preview' });
    await waitFor(() => expect(preview).toBeEnabled());
    fireEvent.click(preview);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(screen.queryByTitle('Preview Example activity')).not.toBeInTheDocument();
    expect(screen.getByTestId('h5p-editor')).toBeInTheDocument();
  });

  it('saves changed editor content before opening its preview', async () => {
    render(<MemoryRouter initialEntries={['/h5p-studio?contentId=content-1']}><H5PStudio /></MemoryRouter>);
    const title = await screen.findByLabelText('H5P title');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled());
    fireEvent.change(title, { target: { value: 'Updated activity' } });
    const preview = screen.getByRole('button', { name: 'Save changes & preview' });
    fireEvent.click(preview);
    await screen.findByTitle('Preview Example activity');
    expect(mocks.updateContent).toHaveBeenCalledOnce();
    expect(mocks.showNotification).toHaveBeenCalledWith(
      'success', 'Changes saved', 'Your updated H5P content is ready to preview or download.'
    );
  });

  it('warns about changed source content and links to the actual source, not URL context', async () => {
    mocks.getSourceStatus.mockResolvedValue({ data: { source: { state: 'changed', quizId: 'source-quiz', folderId: 'source-course', title: 'Original Quiz' } } });
    render(<MemoryRouter initialEntries={['/h5p-studio?contentId=content-1&quizId=unrelated']}><H5PStudio /></MemoryRouter>);
    expect(await screen.findByText(/The source Quiz has changed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View source Quiz: Original Quiz' })).toHaveAttribute('href', '/course/source-course/quiz/source-quiz?tab=review');
    expect(screen.getByText(/They do not update Quiz questions/)).toBeInTheDocument();
  });

it('opens the unified AI builder from a linked Quiz', async () => {
  render(<MemoryRouter initialEntries={['/h5p-studio?contentId=content-1&quizId=quiz1']}><H5PStudio /></MemoryRouter>);
  await screen.findByTestId('h5p-editor');
  fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }));
  expect(screen.getByRole('region', { name: 'Create with AI workspace' })).toHaveTextContent('Source: quiz1');
  expect(screen.queryByRole('tab', { name: /Use course materials/ })).not.toBeInTheDocument();
});

it('restores an assistant session from the URL and opens saved output preview only on request', async () => {
  render(<MemoryRouter initialEntries={['/h5p-studio?create=assistant&assistantSession=saved-assistant']}><H5PStudio /></MemoryRouter>);
  expect(screen.getByText('Session: saved-assistant')).toBeInTheDocument();
  expect(screen.queryByTestId('h5p-editor')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Preview assistant output' }));
  expect(await screen.findByTitle('Preview Example activity')).toBeInTheDocument();
});


it('routes an old assistant entry without a saved session into the unified builder', async () => {
  render(<MemoryRouter initialEntries={['/h5p-studio?create=assistant']}><H5PStudio /></MemoryRouter>);
  expect(await screen.findByRole('region', { name: 'Create with AI workspace' })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Assistant workspace' })).not.toBeInTheDocument();
});

it('carries a unified course brief into the linked course assistant', async () => {
  render(<MemoryRouter initialEntries={['/h5p-studio?create=ai']}><H5PStudio /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Build linked course questions' }));
  const assistant = screen.getByRole('region', { name: 'Assistant workspace' });
  expect(assistant).toBeVisible();
  expect(assistant).toHaveTextContent('Source: quiz-1');
  expect(assistant).toHaveTextContent('Materials: material-1');
  expect(screen.getByLabelText('Course task')).toHaveValue('Teach net force.');
});

it('preserves legacy quick-activity URLs and offers secondary blank and import actions', async () => {
  render(<MemoryRouter initialEntries={['/h5p-studio?create=ai']}><H5PStudio /></MemoryRouter>);
  expect(await screen.findByLabelText('Teaching instructions')).toBeVisible();
  expect(screen.getByRole('button', { name: 'New blank activity' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Import .h5p' })).toBeEnabled();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});
});
