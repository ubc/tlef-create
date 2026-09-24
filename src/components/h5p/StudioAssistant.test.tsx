import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import StudioAssistant from './StudioAssistant';
import type { StudioAssistantSession } from '../../services/api';

const mocks = vi.hoisted(() => ({
  getFolders: vi.fn(), createFolder: vi.fn(), getMaterials: vi.fn(), uploadFiles: vi.fn(), reprocessMaterial: vi.fn(),
  getCapabilities: vi.fn(), listSessions: vi.fn(), getSession: vi.fn(), createSession: vi.fn(), savePlan: vi.fn(), approve: vi.fn(), resume: vi.fn(), publish: vi.fn(), open: vi.fn(), confirm: vi.fn(), useSSE: vi.fn()
}));
vi.mock('../../services/api', () => ({
  ApiError: class ApiError extends Error { constructor(message: string, public status: number) { super(message); } },
  foldersApi: { getFolders: mocks.getFolders, createFolder: mocks.createFolder },
  materialsApi: { getMaterials: mocks.getMaterials, uploadFiles: mocks.uploadFiles, reprocessMaterial: mocks.reprocessMaterial },
  studioAssistantApi: { getCapabilities: mocks.getCapabilities, listSessions: mocks.listSessions, getSession: mocks.getSession, createSession: mocks.createSession, savePlan: mocks.savePlan, approve: mocks.approve, resume: mocks.resume }
}));
vi.mock('../../hooks/usePubSub', () => ({ usePubSub: () => ({ publish: mocks.publish }) }));
vi.mock('../../hooks/useSSE', () => ({ useSSE: mocks.useSSE }));
vi.mock('../system-dialog/SystemDialogProvider', () => ({ useSystemDialog: () => ({ showConfirm: mocks.confirm }) }));
vi.mock('../SourceReferencePreviewModal', () => ({ default: () => <div>Source preview</div> }));
const readyMaterial = { _id: 'material1', name: 'Synthetic source.pdf', processingStatus: 'completed', folder: 'course1' };
const session: StudioAssistantSession = {
  id: 'session1', requestId: 'request1', courseId: 'course1', quizId: 'quiz1', quizName: 'Synthetic lesson', materialIds: ['material1'],
  instructions: 'Teach synthetic concepts with a reflection.', revision: 1, status: 'awaiting_approval',
  objectives: [{ id: 'lo1', text: 'Explain the synthetic concept', sourceReferences: [] }],
  plan: [{ id: 'row1', title: 'Apply the concept', questionType: 'multiple-choice', count: 1, objectiveIds: ['lo1'], instructions: 'Check the stated concept.' }],
  outputs: [], events: [{ stage: 'plan', message: 'Plan ready for review.', createdAt: '2026-09-20T00:00:00Z' }]
};
function Location() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}</output>; }
function mount(initialSessionId?: string, ownerId = 'owner1') {
  function Wrapper() {
    const [id, setId] = useState(initialSessionId);
    return <MemoryRouter><StudioAssistant ownerId={ownerId} initialCourseId="course1" initialQuizId="quiz1" sessionId={id}
      onSessionChange={value => setId(value || undefined)} onOpenActivity={mocks.open} /><Location /></MemoryRouter>;
  }
  return render(<Wrapper />);
}
const response = (value: StudioAssistantSession) => ({ data: { session: value } });

beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  mocks.confirm.mockResolvedValue(false);
  mocks.getFolders.mockResolvedValue({ folders: [{ _id: 'course1', name: 'Synthetic course', quizzes: [{ _id: 'quiz1', name: 'Synthetic lesson' }] }] });
  mocks.createFolder.mockResolvedValue({ folder: { _id: 'course2', name: 'New course', quizzes: ['quiz2'] } });
  mocks.getMaterials.mockResolvedValue({ materials: [readyMaterial] });
  mocks.getCapabilities.mockResolvedValue({ data: { questionTypes: [{ type: 'multiple-choice', title: 'Multiple Choice' }, { type: 'true-false', title: 'True/False' }], maxObjectives: 8, maxPlanRows: 8, maxQuestions: 20 } });
  mocks.listSessions.mockResolvedValue({ data: { sessions: [] } });
  mocks.getSession.mockResolvedValue(response(session));
  mocks.createSession.mockResolvedValue(response({ ...session, status: 'planning' }));
  mocks.savePlan.mockResolvedValue(response({ ...session, revision: 2 }));
  mocks.approve.mockResolvedValue(response({ ...session, revision: 3, status: 'generating' }));
  mocks.resume.mockResolvedValue(response({ ...session, revision: 4, status: 'generating' }));
  mocks.useSSE.mockReturnValue({ connectionStatus: 'connected' });
});
afterEach(() => vi.useRealTimers());

it('plans from ready materials and the existing Learning Object without approving or generating automatically', async () => {
  mount();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Synthetic source.pdf' }));
  fireEvent.change(screen.getByLabelText('Teaching task'), { target: { value: 'Prepare a synthetic lesson with a reflection.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Plan learning objectives & questions' }));
  await waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce());
  expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'course1', quizId: 'quiz1', materialIds: ['material1'], instructions: 'Prepare a synthetic lesson with a reflection.' }));
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(await screen.findByRole('link', { name: /Learning objectives: Synthetic lesson/ })).toHaveAttribute('href', '/course/course1/quiz/quiz1?tab=objectives');
  expect(sessionStorage.getItem('create-studio-assistant-request:owner1')).toBeNull();
});

it('uploads PDF files, blocks planning while indexing, and waits for real completed state', async () => {
  mocks.uploadFiles.mockImplementation(async (_course, _files, progress) => { progress(100); return { materials: [{ ...readyMaterial, _id: 'uploaded', name: 'Upload.pdf', processingStatus: 'processing' }] }; });
  mount();
  await screen.findByRole('checkbox', { name: 'Synthetic source.pdf' });
  fireEvent.change(screen.getByLabelText('Upload PDF or DOCX'), { target: { files: [new File(['synthetic'], 'Upload.pdf', { type: 'application/pdf' })] } });
  expect(await screen.findByRole('checkbox', { name: 'Upload.pdf' })).toBeChecked();
  fireEvent.change(screen.getByLabelText('Teaching task'), { target: { value: 'Teach the uploaded synthetic material.' } });
  expect(screen.getByRole('button', { name: 'Plan learning objectives & questions' })).toBeDisabled();
  mocks.getMaterials.mockResolvedValue({ materials: [{ ...readyMaterial, _id: 'uploaded', name: 'Upload.pdf' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh materials' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Plan learning objectives & questions' })).toBeEnabled());
});

it('creates a course through the existing API and reuses its empty Learning Object', async () => {
  mount(); await screen.findByRole('checkbox', { name: 'Synthetic source.pdf' });
  fireEvent.click(screen.getByRole('button', { name: 'New course' }));
  fireEvent.change(screen.getByLabelText('Course name'), { target: { value: 'New course' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create course' }));
  await waitFor(() => expect(mocks.createFolder).toHaveBeenCalledWith('New course', 1));
  expect(mocks.publish).toHaveBeenCalledWith('course-created', { courseId: 'course2', courseName: 'New course' });
  expect(screen.getByLabelText('Course')).toHaveValue('course2');
  expect(screen.getByLabelText('Learning Object')).toHaveValue('quiz2');
});

it('saves edited objectives and question plan before explicit approval with the returned revision', async () => {
  mount('session1');
  const objective = await screen.findByLabelText('LO1');
  fireEvent.change(objective, { target: { value: 'Revised objective' } });
  fireEvent.change(screen.getByLabelText('Number of questions'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Question type'), { target: { value: 'true-false' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve & generate questions' }));
  await waitFor(() => expect(mocks.approve).toHaveBeenCalledOnce());
  expect(mocks.savePlan).toHaveBeenCalledWith('session1', expect.objectContaining({ revision: 1, objectives: [expect.objectContaining({ text: 'Revised objective' })], plan: [expect.objectContaining({ count: 2, questionType: 'true-false' })] }));
  expect(mocks.approve).toHaveBeenCalledWith('session1', expect.objectContaining({ revision: 2 }));
  expect(mocks.savePlan.mock.invocationCallOrder[0]).toBeLessThan(mocks.approve.mock.invocationCallOrder[0]);
});

it('does not approve after save failure and retains the edited plan', async () => {
  mocks.savePlan.mockRejectedValue(new Error('Plan could not save'));
  mount('session1');
  fireEvent.change(await screen.findByLabelText('Row title'), { target: { value: 'Keep my new title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve & generate questions' }));
  await screen.findByText('Plan could not save');
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Row title')).toHaveValue('Keep my new title');
});

it.each(['', '1.5', '21', '-1'])('rejects invalid visible question count %j rather than sending a stale count', async count => {
  mount('session1');
  fireEvent.change(await screen.findByLabelText('Number of questions'), { target: { value: count } });
  expect(screen.getByRole('button', { name: 'Approve & generate questions' })).toBeDisabled();
  expect(mocks.savePlan).not.toHaveBeenCalled();
});

it('recovers an uncertain create via matching requestId without repeating the paid request or storing prompts', async () => {
  mocks.createSession.mockRejectedValue(new TypeError('Network disconnected'));
  mount();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Synthetic source.pdf' }));
  fireEvent.change(screen.getByLabelText('Teaching task'), { target: { value: 'Private synthetic teaching instructions' } });
  fireEvent.click(screen.getByRole('button', { name: 'Plan learning objectives & questions' }));
  await screen.findByText(/Planning could not be confirmed/);
  const requestId = sessionStorage.getItem('create-studio-assistant-request:owner1');
  expect(requestId).toBeTruthy();
  expect(JSON.stringify(sessionStorage)).not.toContain('Private synthetic');
  mocks.listSessions.mockResolvedValue({ data: { sessions: [{ ...session, requestId }] } });
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
  await screen.findByText('Needs your approval');
  expect(mocks.createSession).toHaveBeenCalledOnce();
});

it('keeps unsaved edits on a status refresh and uses the original revision for conflict detection', async () => {
  mount('session1');
  fireEvent.change(await screen.findByLabelText('Row title'), { target: { value: 'Local unsaved title' } });
  mocks.getSession.mockResolvedValue(response({ ...session, revision: 5, plan: [{ ...session.plan[0], title: 'Changed elsewhere' }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check status' })).toBeEnabled());
  expect(screen.getByLabelText('Row title')).toHaveValue('Local unsaved title');
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitFor(() => expect(mocks.savePlan).toHaveBeenCalledWith('session1', expect.objectContaining({ revision: 1 })));
});

it('shows actual prepared-question preview and completed outputs without forcing the editor to switch', async () => {
  vi.useFakeTimers();
  const generating = { ...session, status: 'generating' as const, generation: { requestId: 'generation1', status: 'running', readyCount: 1, totalQuestions: 2, items: [{ index: 0, status: 'ready' }] }, previewVersion: 1 };
  mocks.getSession.mockResolvedValue(response(generating));
  mount('session1');
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTitle('Prepared question preview')).toHaveAttribute('src', '/api/create/h5p-editor/assistant/sessions/session1/preview?v=1');
  expect(screen.getByText(/the batch is not saved/)).toBeInTheDocument();
  mocks.getSession.mockResolvedValue(response({ ...session, status: 'completed', outputs: [{ contentId: 'content1', title: 'Combined lesson' }] }));
  await act(async () => vi.advanceTimersByTimeAsync(2100));
  expect(screen.getByText('Combined lesson')).toBeInTheDocument();
  expect(mocks.open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit activity' }));
  expect(mocks.open).toHaveBeenCalledWith('content1', false);
});

it('connects the Studio generation receipt to SSE and streams per-question draft progress', async () => {
  const generating = { ...session, status: 'generating' as const, generation: {
    requestId: 'generation1', sessionId: 'stream-session-1', status: 'running', readyCount: 0, totalQuestions: 1,
    items: [{ index: 0, questionId: 'question-1', status: 'generating' }]
  } };
  mocks.getSession.mockResolvedValue(response(generating));
  mount('session1');
  expect(await screen.findByText('Live updates connected')).toBeInTheDocument();
  const [url, handlers] = mocks.useSSE.mock.calls.at(-1)!;
  expect(url).toContain('/api/create/streaming/questions/stream-session-1');
  act(() => {
    handlers.onQuestionProgress('question-1', { status: 'llm-started' });
    handlers.onTextChunk('question-1', '{"questionText":"What changes?"}');
  });
  expect(await screen.findByText('Writing the first draft…')).toBeInTheDocument();
  expect(await screen.findByText(/What changes/)).toBeInTheDocument();
  act(() => handlers.onTextReset('question-1', { attempt: 2 }));
  expect(screen.getByText('Revising draft · attempt 2')).toBeInTheDocument();
});

it('requires an explicit retry after failed generation and never replays automatically on recovery', async () => {
  mocks.getSession.mockResolvedValue(response({ ...session, status: 'failed', error: { message: 'Synthetic failure' } }));
  mount('session1');
  const retry = await screen.findByRole('button', { name: 'Retry question batch' });
  expect(mocks.resume).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledWith('session1', expect.objectContaining({ revision: 1 })));
});

it('retries an unconfirmed create only with its original request ID and original in-memory brief', async () => {
  mocks.createSession.mockRejectedValueOnce(new TypeError('Network disconnected')).mockResolvedValueOnce(response({ ...session, status: 'planning' }));
  mount();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Synthetic source.pdf' }));
  fireEvent.change(screen.getByLabelText('Teaching task'), { target: { value: 'The original synthetic request body.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Plan learning objectives & questions' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry same request' }));
  await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(2));
  expect(mocks.createSession.mock.calls[1][0]).toEqual(mocks.createSession.mock.calls[0][0]);
});

it('recovers only the signed-in owner pending ID and offers explicit planning retry', async () => {
  sessionStorage.setItem('create-studio-assistant-request:other-owner', 'someone-else-request');
  mocks.getSession.mockResolvedValue(response({ ...session, phase: 'planning', status: 'interrupted', plan: [] }));
  mount('session1');
  expect(await screen.findByRole('button', { name: 'Retry planning' })).toBeEnabled();
  expect(mocks.createSession).not.toHaveBeenCalled();
  expect(mocks.resume).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry planning' }));
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledOnce());
  expect(sessionStorage.getItem('create-studio-assistant-request:other-owner')).toBe('someone-else-request');
});

it('distinguishes packaging failure after publication from an unpublished question batch', async () => {
  mocks.getSession.mockResolvedValue(response({ ...session, status: 'failed', phase: 'generating',
    error: 'Studio package could not be prepared.',
    generation: { requestId: 'published-request', status: 'succeeded', readyCount: 1, totalQuestions: 1, items: [{ index: 0, status: 'ready' }] }
  }));
  mount('session1');
  const retry = await screen.findByRole('button', { name: 'Retry Studio draft' });
  expect(screen.getByText(/Questions are already saved in the Learning Object/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry question batch' })).not.toBeInTheDocument();
  expect(screen.queryByTitle('Prepared question preview')).not.toBeInTheDocument();
  expect(mocks.resume).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledOnce());
  expect(mocks.approve).not.toHaveBeenCalled();
});

it('allows an automatically selected failed upload to be excluded while retaining a ready source', async () => {
  mocks.uploadFiles.mockResolvedValue({ materials: [{ ...readyMaterial, _id: 'bad-upload', name: 'Unreadable.pdf', processingStatus: 'failed' }] });
  mount();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Synthetic source.pdf' }));
  fireEvent.change(screen.getByLabelText('Upload PDF or DOCX'), { target: { files: [new File(['synthetic'], 'Unreadable.pdf', { type: 'application/pdf' })] } });
  const failed = await screen.findByRole('checkbox', { name: 'Unreadable.pdf' });
  fireEvent.change(screen.getByLabelText('Teaching task'), { target: { value: 'Teach only the ready synthetic material.' } });
  expect(failed).toBeChecked();
  expect(screen.getByRole('button', { name: 'Plan learning objectives & questions' })).toBeDisabled();
  fireEvent.click(failed);
  expect(failed).not.toBeChecked();
  expect(failed).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Plan learning objectives & questions' })).toBeEnabled();
});

it('protects unsaved plan edits when following a course link and leaves only after explicit confirmation', async () => {
  mount('session1');
  fireEvent.change(await screen.findByLabelText('Row title'), { target: { value: 'Unsaved planning change' } });
  fireEvent.click(screen.getByRole('link', { name: 'Open course' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Leave with unsaved plan edits?', cancelLabel: 'Keep editing' })));
  expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/$/);
  expect(screen.getByLabelText('Row title')).toHaveValue('Unsaved planning change');
  mocks.confirm.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole('link', { name: 'Open course' }));
  await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent('/course/course1'));
  expect(mocks.savePlan).not.toHaveBeenCalled();
});

it('recovers material polling after a temporary network failure and clears only its material error', async () => {
  vi.useFakeTimers();
  mocks.getMaterials.mockResolvedValueOnce({ materials: [{ ...readyMaterial, processingStatus: 'processing' }] })
    .mockRejectedValueOnce(new Error('Temporary material network failure'))
    .mockResolvedValue({ materials: [readyMaterial] });
  mount();
  await act(async () => { await Promise.resolve(); });
  await act(async () => vi.advanceTimersByTimeAsync(2600));
  expect(screen.getByText(/Temporary material network failure/)).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(2600));
  expect(screen.getByText('Ready')).toBeInTheDocument();
  expect(screen.queryByText(/Temporary material network failure/)).not.toBeInTheDocument();
  expect(mocks.createSession).not.toHaveBeenCalled();
});
