import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthoringWorkspace from './AuthoringWorkspace';
import type { AuthoringSession } from '../../../services/api';

const mocks = vi.hoisted(() => ({ folders: vi.fn(), materials: vi.fn(), uploadFiles: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), command: vi.fn(), cancel: vi.fn(), savePlan: vi.fn(), publish: vi.fn(), confirm: vi.fn(), session: vi.fn(), open: vi.fn() }));
vi.mock('../../../services/api', () => ({ ApiError: class ApiError extends Error { status = 0; }, foldersApi: { getFolders: mocks.folders }, materialsApi: { getMaterials: mocks.materials, uploadFiles: mocks.uploadFiles },
  studioAuthoringApi: { list: mocks.list, get: mocks.get, create: mocks.create, command: mocks.command, cancel: mocks.cancel },
  studioAssistantApi: { savePlan: mocks.savePlan }, h5pEditorApi: {} }));
vi.mock('../../../hooks/usePubSub', () => ({ usePubSub: () => ({ publish: mocks.publish }) }));
vi.mock('../../system-dialog/SystemDialogProvider', () => ({ useSystemDialog: () => ({ showConfirm: mocks.confirm }) }));
vi.mock('../../SourceReferencePreviewModal', () => ({ default: () => <div>Source preview</div> }));
vi.mock('../StudioPreview', () => ({ default: ({ contentId }: { contentId: string }) => <div data-testid="preview">{contentId}</div> }));
const saved: AuthoringSession = {
  id: 'task1', title: 'Water activity', courseId: 'course1', quizId: 'quiz1', materialIds: ['material1'], instructions: 'Teach water.',
  autoApprove: false, revision: 4, status: 'awaiting_approval', error: '', currentVersionId: null, candidateVersionId: null,
  messages: [{ id: 'm1', role: 'user', text: 'Teach the water cycle.', createdAt: '2026-09-27' }], versions: [],
  assistant: { id: 'assistant1', courseId: 'course1', quizId: 'quiz1', materialIds: ['material1'], instructions: 'Teach water.', revision: 2, status: 'awaiting_approval',
    objectives: [{ id: 'lo1', text: 'Explain evaporation.', sourceReferences: [] }],
    plan: [{ id: 'row1', title: 'Check evaporation', questionType: 'multiple-choice', count: 2, objectiveIds: ['lo1'], instructions: 'Ask about water.' }], outputs: [], events: [] },
  run: { id: 'run1', status: 'succeeded', checkpoint: 'planning' }, updatedAt: '2026-09-27'
};
function mount(sessionId?: string, initialCourseId = 'course1') {
  return render(<MemoryRouter><AuthoringWorkspace ownerId="owner1" sessionId={sessionId} initialCourseId={initialCourseId}
    onSessionChange={mocks.session} onOpenActivity={mocks.open} onAdvanced={() => {}} /></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  mocks.folders.mockResolvedValue({ folders: [{ _id: 'course1', name: 'Water science', quizzes: [] }] });
  mocks.materials.mockResolvedValue({ materials: [{ _id: 'material1', name: 'Water.pdf', processingStatus: 'completed' }] });
  mocks.uploadFiles.mockResolvedValue({ materials: [{ _id: 'material2', name: 'Lecture.pdf', processingStatus: 'processing' }] });
  mocks.list.mockResolvedValue({ data: { sessions: [] } });
  mocks.get.mockResolvedValue({ data: { session: structuredClone(saved) } });
  mocks.command.mockResolvedValue({ data: { session: { ...saved, status: 'working', run: { id: 'run2', status: 'queued', checkpoint: 'start' } } } });
});
afterEach(() => { vi.useRealTimers(); });
describe('Studio AI workspace', () => {
  it('offers initial teaching choices without showing plan approval before requirements are answered', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, status: 'awaiting_requirements', assistant: null,
      messages: [{ id: 'intake1', role: 'assistant', text: 'Tell me the intended learning task.', createdAt: '2026-09-30',
        clarification: [{ question: 'Question count?', options: ['One', 'Three'] }] }] } } });
    mount('task1');
    expect(await screen.findByRole('radio', { name: 'One' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Accept plan & generate/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use selected answers' }));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('fills the composer from current clarification choices and calls the API only after Send', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, messages: [{ id: 'clarify1', role: 'assistant', text: 'Choose your intended count.', createdAt: '2026-09-30',
      clarification: [{ question: 'How many questions?', options: ['One', 'Five'] }] }] } } });
    mount('task1');
    fireEvent.click(await screen.findByRole('radio', { name: 'One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use selected answers' }));
    expect((screen.getByRole('textbox', { name: 'Message Studio AI' }) as HTMLTextAreaElement).value).toContain('How many questions? One');
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Five' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use selected answers' }));
    expect((screen.getByRole('textbox', { name: 'Message Studio AI' }) as HTMLTextAreaElement).value).not.toContain('How many questions? One');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({ text: expect.stringContaining('How many questions? Five') })));
  });
  it('opens failed draft details and allows plan instructions to be edited before a new approval', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, status: 'needs_attention', error: 'Batch blocked.',
      assistant: { ...saved.assistant, status: 'failed', phase: 'generating', errorCode: 'ASSISTANT_QUESTION_BATCH_FAILED',
        generation: { requestId: 'request-1', status: 'failed', readyCount: 1, totalQuestions: 2,
          items: [{ index: 0, status: 'ready' }, { index: 1, status: 'failed', reason: 'ANSWER_INVALID', message: 'Answer ambiguous.',
            review: { questionText: 'A rejected water draft.', correctAnswer: 'Rock', options: [{ text: 'Rock', isCorrect: true }], issues: ['Water changes phase, not rock.', 'Calculation check (option 1 feedback): 7 * 8 evaluates to 56; the feedback claimed 54.'] } }] } } } } });
    mount('task1');
    const instructions = await screen.findByRole('textbox', { name: 'Question instructions for plan row 1' });
    expect(instructions).toBeEnabled();
    fireEvent.change(instructions, { target: { value: 'Ask about condensation, with one answer.' } });
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Accept plan & generate/ })).not.toBeInTheDocument();
    expect(screen.getByText('Water changes phase, not rock.')).toBeInTheDocument();
    expect(screen.getByText('Failure details')).toBeInTheDocument();
    expect(screen.getByText(/7 \* 8 evaluates to 56/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discuss the failure' }));
    expect((screen.getByRole('textbox', { name: 'Message Studio AI' }) as HTMLTextAreaElement).value).toContain('Explain the failed');
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('submits chosen teaching preferences as a revision and never auto-approves it', async () => {
    mount('task1');
    await screen.findByRole('button', { name: /Accept plan & generate/ });
    fireEvent.click(screen.getByText('Refine teaching requirements'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Learner level' }), { target: { value: 'introductory university students' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Question difficulty' }), { target: { value: 'easy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update proposal' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({ text: expect.stringContaining('Difficulty: easy.') })));
    expect(mocks.command).toHaveBeenCalledTimes(1);
  });

  it('shows per-question diagnoses from the saved batch', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, status: 'needs_attention', error: 'The batch could not complete.',
      assistant: { ...saved.assistant, generation: { requestId: 'request-1', status: 'failed', readyCount: 1, totalQuestions: 2, reusedQuestions: 1,
        items: [{ index: 0, status: 'ready' }, { index: 1, status: 'failed', reason: 'INSTRUCTION_MISMATCH', message: 'The draft did not follow the instructions for this question.' }] } } } } });
    mount('task1');
    const issues = await screen.findByRole('region', { name: 'Questions needing attention' });
    expect(issues).toHaveTextContent('Question 2');
    expect(issues).toHaveTextContent('did not follow the instructions');
    expect(issues).not.toHaveTextContent('Question 1:');
    expect(screen.getByText('1 prepared question reused from the previous attempt.')).toBeVisible();
  });
  it('recovers a failed status read without starting another paid command', async () => {
    vi.useFakeTimers();
    mocks.get.mockRejectedValueOnce(new Error('Temporary offline'));
    mount('task1');
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('Temporary offline');
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByRole('button', { name: /Accept plan & generate/ })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('opens real tools from the composer and uploads a chosen file into the selected course', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tools and materials' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Upload files/ }));
    const document = new File(['lecture content'], 'Lecture.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Upload course materials'), { target: { files: [document] } });
    await waitFor(() => expect(mocks.uploadFiles).toHaveBeenCalledWith('course1', [document], expect.any(Function)));
    await waitFor(() => expect(screen.getByRole('button', { name: '1 material attached' })).toBeVisible());
    expect(screen.getByLabelText('Upload course materials')).toHaveClass('authoring-file-input');
  });
  it('holds dropped files until a course is chosen, then uploads automatically', async () => {
    mount(undefined, '');
    await screen.findByRole('button', { name: 'Add tools and materials' });
    const document = new File(['lecture content'], 'Lecture.pdf', { type: 'application/pdf' });
    fireEvent.drop(screen.getByRole('region', { name: 'Studio AI workspace' }), { dataTransfer: { types: ['Files'], files: [document] } });
    expect(await screen.findByText('Files waiting for a course')).toBeVisible();
    expect(mocks.uploadFiles).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Course' }), { target: { value: 'course1' } });
    await waitFor(() => expect(mocks.uploadFiles).toHaveBeenCalledWith('course1', [document], expect.any(Function)));
    await waitFor(() => expect(screen.queryByText('Files waiting for a course')).not.toBeInTheDocument());
  });
  it('keeps a saved task unchanged when files are dropped and asks to start a new activity', async () => {
    mount('task1');
    await screen.findByRole('button', { name: /Accept plan & generate/ });
    const document = new File(['new notes'], 'New notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.drop(screen.getByRole('region', { name: 'Studio AI workspace' }), { dataTransfer: { types: ['Files'], files: [document] } });
    expect(await screen.findByText('Files for a new activity')).toBeVisible();
    expect(mocks.uploadFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Start new activity with these files/ }));
    await waitFor(() => expect(mocks.session).toHaveBeenCalledWith(null));
    await waitFor(() => expect(mocks.uploadFiles).toHaveBeenCalledWith('course1', [document], expect.any(Function)));
  });
  it('searches saved conversation history and switches tasks', async () => {
    mocks.list.mockResolvedValue({ data: { sessions: [{ id: 'task1', title: 'Water activity', status: 'awaiting_approval', updatedAt: '2026-09-27' }, { id: 'task2', title: 'Cell biology', status: 'ready', updatedAt: '2026-09-26' }] } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Task history' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search task history' }), { target: { value: 'cell' } });
    expect(screen.getByRole('button', { name: /Cell biology/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Water activity/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cell biology/ }));
    expect(mocks.session).toHaveBeenCalledWith('task2');
  });
  it('starts from materials with an optional brief and persists the returned task URL', async () => {
    mocks.create.mockResolvedValue({ data: { session: { ...saved, status: 'planning' } } });
    mount();
    expect(await screen.findByText(/What will your students/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add course materials' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Water.pdf/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start learning activity' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'course1', materialIds: ['material1'], instructions: '', autoApprove: false })));
    await waitFor(() => expect(mocks.session).toHaveBeenCalledWith('task1'));
  });
  it('restores a plan without generating and binds approval to its current revision', async () => {
    mount('task1');
    const approve = await screen.findByRole('button', { name: /Accept plan & generate/ });
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'approve', expect.objectContaining({ revision: 4, planRevision: 2 })));
  });
  it('blocks approval while objective edits are unsaved', async () => {
    mount('task1');
    const objective = await screen.findByRole('textbox', { name: 'Learning objective 1' });
    fireEvent.change(objective, { target: { value: 'Explain condensation.' } });
    expect(screen.getByRole('button', { name: /Accept plan & generate/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
  });
  it('keeps a failed message for explicit retry with the same request ID', async () => {
    mocks.command.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ data: { session: saved } });
    mount('task1');
    const input = await screen.findByRole('textbox', { name: 'Message Studio AI' });
    await screen.findByRole('button', { name: /Accept plan & generate/ });
    fireEvent.change(input, { target: { value: 'Use four questions.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same request' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[0]).toEqual(mocks.command.mock.calls[1]);
  });
  it('shows a candidate separately and rejects it without selecting another version', async () => {
    const version = { id: 'v1', number: 1, parentId: null, restoredFromId: null, contentId: 'content1', title: 'Activity', summary: 'First version', changes: [], representation: 'course-linked', state: 'accepted', createdAt: '2026-09-27', questions: [] };
    mocks.get.mockResolvedValue({ data: { session: { ...saved, status: 'ready', currentVersionId: 'v1', candidateVersionId: 'v2',
      versions: [version, { ...version, id: 'v2', number: 2, contentId: 'content2', parentId: 'v1', state: 'candidate', changes: ['Only question 1 changed'] }] } } });
    mount('task1');
    expect(await screen.findByTestId('preview')).toHaveTextContent('content2');
    fireEvent.click(screen.getByRole('button', { name: 'Keep current' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'reject', expect.objectContaining({ versionId: 'v2' })));
  });
});
