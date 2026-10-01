import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthoringWorkspace from './AuthoringWorkspace';
import type { AuthoringSession } from '../../../services/api';

const mocks = vi.hoisted(() => ({ context: vi.fn(), draftCourse: vi.fn(), stream: vi.fn(), folders: vi.fn(), materials: vi.fn(), uploadFiles: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), command: vi.fn(), cancel: vi.fn(), savePlan: vi.fn(), publish: vi.fn(), confirm: vi.fn(), session: vi.fn(), open: vi.fn() }));
vi.mock('../../../services/api', () => ({ ApiError: class ApiError extends Error { status = 0; }, foldersApi: { getFolders: mocks.folders }, materialsApi: { getMaterials: mocks.materials, uploadFiles: mocks.uploadFiles },
  studioAuthoringApi: { context: mocks.context, draftCourse: mocks.draftCourse, eventsUrl: (id: string) => `/events/${id}`, list: mocks.list, get: mocks.get, create: mocks.create, command: mocks.command, cancel: mocks.cancel },
  studioAssistantApi: { previewUrl: (id: string, version: number) => `/preview/${id}?v=${version}`, savePlan: mocks.savePlan }, h5pEditorApi: {} }));
vi.mock('../../../hooks/useSSE', () => ({ useSSE: mocks.stream }));
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
  mocks.stream.mockReturnValue({ connectionStatus: 'connected' });
  mocks.folders.mockResolvedValue({ folders: [{ _id: 'course1', name: 'Water science', quizzes: [] }] });
  mocks.materials.mockResolvedValue({ materials: [{ _id: 'material1', name: 'Water.pdf', processingStatus: 'completed' }] });
  mocks.uploadFiles.mockResolvedValue({ materials: [{ _id: 'material2', name: 'Lecture.pdf', processingStatus: 'processing' }] });
  mocks.context.mockResolvedValue({ data: { courses: [{ id: 'course1', name: 'Water science', description: 'Water course' }], materials: [{ id: 'material1', name: 'Water.pdf', status: 'completed', preview: 'Water evaporates.' }, { id: 'material2', name: 'Lecture.pdf', status: 'processing', preview: '' }], objectives: [{ id: 'lo1', name: 'Explain evaporation.', quizId: 'quiz1', quizName: 'Water activity', sourceReferences: [] }] } });
  mocks.draftCourse.mockResolvedValue({ data: { courseId: 'course1', name: 'Studio drafts' } });
  mocks.list.mockResolvedValue({ data: { sessions: [] } });
  mocks.get.mockResolvedValue({ data: { session: structuredClone(saved) } });
  mocks.command.mockResolvedValue({ data: { session: { ...saved, status: 'working', run: { id: 'run2', status: 'queued', checkpoint: 'start' } } } });
});
afterEach(() => { vi.useRealTimers(); });
describe('Studio AI workspace', () => {
  it('receives a live partial result over SSE, opens its preview, and never resubmits generation', async () => {
    mount('task1');
    await screen.findByRole('button', { name: /Accept plan & generate/ });
    const callback = mocks.stream.mock.calls.at(-1)![1].onAuthoringSnapshot;
    const next = { ...saved, revision: 5, status: 'needs_attention',
      assistant: { ...saved.assistant, status: 'failed', phase: 'generating', errorCode: 'ASSISTANT_QUESTION_BATCH_FAILED',
        generation: { requestId: 'live-receipt', readyCount: 1, totalQuestions: 2, published: true,
          items: [{ index: 0, status: 'ready' }, { index: 1, status: 'failed', attempts: 2, message: 'Answer ambiguous.' }] } } };
    act(() => callback(next));
    expect(screen.queryByTitle('Checked question set preview')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Question set preview/ }));
    expect(await screen.findByTitle('Checked question set preview')).toHaveAttribute('sandbox', 'allow-scripts');
    expect(screen.getByText('These questions are saved in your course. Unfinished questions are excluded; you can use the checked questions now.')).toBeInTheDocument();
    expect(screen.getByText('Automatic rework used (1 of 1)')).toBeInTheDocument();
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
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
            review: { questionText: 'A rejected water draft.', correctAnswer: 'Rock', options: [{ text: 'Rock', isCorrect: true }], issues: ['Water changes phase, not rock.'], calculationCheck: { location: 'option 1 feedback', expression: '7 * 8', computed: 56, claimed: 54 } } }] } } } } });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: /Question set preview/ }));
    await screen.findByTitle('Checked question set preview');
    fireEvent.click(screen.getByRole('tab', { name: 'Teaching plan' }));
    const instructions = await screen.findByRole('textbox', { name: 'Question instructions for plan row 1' });
    expect(instructions).toBeEnabled();
    fireEvent.change(instructions, { target: { value: 'Ask about condensation, with one answer.' } });
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Accept plan & generate/ })).not.toBeInTheDocument();
    expect(screen.getByText('Water changes phase, not rock.')).toBeInTheDocument();
    expect(screen.getByText('Failure details')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Calculation check' })).toHaveTextContent('7 * 8 evaluates to 56; the feedback claimed 54.');
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
    fireEvent.click(screen.getByRole('option', { name: /Upload files/ }));
    const document = new File(['lecture content'], 'Lecture.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Upload course materials'), { target: { files: [document] } });
    await waitFor(() => expect(mocks.uploadFiles).toHaveBeenCalledWith('course1', [document], expect.any(Function)));
    await waitFor(() => expect(screen.getByTitle('Preview Lecture.pdf')).toBeVisible());
    expect(screen.getByLabelText('Upload course materials')).toHaveClass('authoring-file-input');
  });
  it('uploads dropped files without requiring a course selection', async () => {
    mount(undefined, '');
    await screen.findByRole('button', { name: 'Add tools and materials' });
    const document = new File(['lecture'], 'Lecture.pdf', { type: 'application/pdf' });
    fireEvent.drop(screen.getByRole('region', { name: 'Studio AI workspace' }), { dataTransfer: { types: ['Files'], files: [document] } });
    await waitFor(() => expect(mocks.draftCourse).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.uploadFiles).toHaveBeenCalledWith('course1', [document], expect.any(Function)));
  });
  it('adds files to the ongoing conversation and submits updated context explicitly', async () => {
    mount('task1');
    await screen.findByRole('button', { name: /Accept plan & generate/ });
    const document = new File(['notes'], 'Lecture.pdf', { type: 'application/pdf' });
    fireEvent.drop(screen.getByRole('region', { name: 'Studio AI workspace' }), { dataTransfer: { types: ['Files'], files: [document] } });
    await waitFor(() => expect(mocks.uploadFiles).toHaveBeenCalledWith('course1', [document], expect.any(Function)));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
    expect(screen.getByRole('button', { name: /Accept plan & generate/ })).toBeDisabled();
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({ context: expect.objectContaining({ materialIds: ['material1', 'material2'] }) })));
  });
  it('starts from a text-only idea with no course, materials or objectives', async () => {
    mocks.create.mockResolvedValue({ data: { session: saved } });
    mount(undefined, '');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Studio AI' }), { target: { value: 'Brainstorm LOs for introductory mechanics.' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start learning activity' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Start learning activity' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ materialIds: [], objectiveIds: [], autoApprove: false, instructions: 'Brainstorm LOs for introductory mechanics.' })));
  });
  it('opens context tools beside an @ mention, attaches an LO, and previews it', async () => {
    mount();
    const input = screen.getByRole('textbox', { name: 'Message Studio AI' });
    fireEvent.change(input, { target: { value: 'Use @' } });
    expect(screen.getByRole('dialog', { name: 'Add context' })).toHaveClass('is-mention');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0]).toHaveFocus();
    fireEvent.click(screen.getByRole('option', { name: /Learning objectives/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Explain evaporation/ }));
    expect(input).toHaveValue('Use ');
    expect(screen.queryByRole('dialog', { name: 'Add context' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTitle('Preview Explain evaporation.'));
    expect(screen.getByRole('dialog', { name: 'Context preview' })).toHaveTextContent('From: Water activity');
    fireEvent.click(screen.getByRole('button', { name: 'Close context preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove context Explain evaporation.' }));
    expect(screen.queryByTitle('Preview Explain evaporation.')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Add tools and materials' }));
    fireEvent.click(screen.getByRole('option', { name: /^Materials/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Water.pdf/ }));
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
    fireEvent.click(await screen.findByRole('button', { name: /Learning objectives & teaching plan/ }));
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
    fireEvent.click(await screen.findByRole('button', { name: /Question set preview/ }));
    expect(await screen.findByTestId('preview')).toHaveTextContent('content2');
    fireEvent.click(screen.getByRole('button', { name: 'Keep current' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'reject', expect.objectContaining({ versionId: 'v2' })));
  });
});
