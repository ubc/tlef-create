import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthoringWorkspace from './AuthoringWorkspace';
import { ApiError, type AuthoringSession, type AuthoringTeachingBrief } from '../../../services/api';

const mocks = vi.hoisted(() => ({ context: vi.fn(), draftCourse: vi.fn(), stream: vi.fn(), folders: vi.fn(), materials: vi.fn(), uploadFiles: vi.fn(), reindexMaterial: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), command: vi.fn(), cancel: vi.fn(), savePlan: vi.fn(), publish: vi.fn(), confirm: vi.fn(), session: vi.fn(), open: vi.fn() }));
vi.mock('../../../services/api', () => ({ ApiError: class ApiError extends Error { status = 0; }, foldersApi: { getFolders: mocks.folders }, materialsApi: { getMaterials: mocks.materials, uploadFiles: mocks.uploadFiles, reindexMaterial: mocks.reindexMaterial },
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
  mocks.reindexMaterial.mockImplementation(async (materialId: string) => ({ processing: { materialId, chunksCount: 2, restored: true } }));
  mocks.context.mockResolvedValue({ data: { courses: [{ id: 'course1', name: 'Water science', description: 'Water course' }], materials: [{ id: 'material1', name: 'Water.pdf', status: 'completed', preview: 'Water evaporates.' }, { id: 'material2', name: 'Lecture.pdf', status: 'processing', preview: '' }], objectives: [{ id: 'lo1', name: 'Explain evaporation.', quizId: 'quiz1', quizName: 'Water activity', sourceReferences: [] }] } });
  mocks.draftCourse.mockResolvedValue({ data: { courseId: 'course1', name: 'Studio drafts' } });
  mocks.list.mockResolvedValue({ data: { sessions: [] } });
  mocks.get.mockResolvedValue({ data: { session: structuredClone(saved) } });
  mocks.command.mockResolvedValue({ data: { session: { ...saved, status: 'working', run: { id: 'run2', status: 'queued', checkpoint: 'start' } } } });
});

describe('material search recovery', () => {
  const failureSession = (materialIds = ['material1', 'material3'], code = 'MATERIAL_INDEX_MISSING'): AuthoringSession => ({
    ...saved, status: 'needs_attention', error: 'Material search is unavailable.', run: { ...saved.run!, status: 'failed' }, materialIds,
    assistant: { ...saved.assistant!, status: 'failed', phase: 'generating', errorCode: 'ASSISTANT_QUESTION_BATCH_FAILED',
      generation: { requestId: 'failed-index-batch', status: 'failed', readyCount: 0, totalQuestions: 2,
        items: [{ index: 0, status: 'failed', attempts: 0,
          failure: { code, stage: 'evidence', message: 'The approved material index is missing.',
            recovery: 'Restore material search, then Resume task.', retryable: true } }] } }
  });

  it('restores only the saved source IDs in sequence and leaves generation to explicit Resume task', async () => {
    const failed = failureSession();
    let finishFirst!: (value: { processing: { materialId: string; chunksCount: number; restored: true } }) => void;
    mocks.get.mockResolvedValue({ data: { session: failed } });
    mocks.reindexMaterial.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    mount('task1');
    const restore = await screen.findByRole('button', { name: 'Restore material search' });
    fireEvent.click(restore); fireEvent.click(restore);
    expect(mocks.reindexMaterial).toHaveBeenCalledTimes(1);
    expect(mocks.reindexMaterial).toHaveBeenCalledWith('material1');
    expect(screen.getByRole('button', { name: 'Restoring material search…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resume task' })).toBeDisabled();
    await act(async () => { finishFirst({ processing: { materialId: 'material1', chunksCount: 2, restored: true } }); });
    expect(await screen.findByText('Materials are searchable again. Choose Resume task to continue.')).toBeVisible();
    expect(mocks.reindexMaterial.mock.calls.map(([id]) => id)).toEqual(['material1', 'material3']);
    expect(screen.getByRole('button', { name: 'Restore material search' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resume task' })).toBeEnabled();
    expect(mocks.command).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.savePlan).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
    expect(failed.assistant!.plan).toEqual(saved.assistant!.plan);
    expect(failed.materialIds).toEqual(['material1', 'material3']);
  });

  it('shows a restoration failure and keeps Resume task explicit without changing the source or plan', async () => {
    mocks.get.mockResolvedValue({ data: { session: failureSession() } });
    mocks.reindexMaterial.mockImplementationOnce(async materialId => ({ processing: { materialId, restored: true } }))
      .mockRejectedValueOnce(new Error('The embedding service is unavailable.'));
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Restore material search' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The embedding service is unavailable.'));
    expect(screen.queryByText('Materials are searchable again. Choose Resume task to continue.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume task' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Restore material search' })).toBeEnabled();
    expect(mocks.reindexMaterial.mock.calls.map(([id]) => id)).toEqual(['material1', 'material3']);
    expect(mocks.command).not.toHaveBeenCalled(); expect(mocks.savePlan).not.toHaveBeenCalled();
  });

  it.each([
    { materialIds: ['material1'], code: 'RAG_UNAVAILABLE' },
    { materialIds: ['material1'], code: 'INSTRUCTION_MISMATCH' },
    { materialIds: [], code: 'MATERIAL_INDEX_MISSING' }
  ])('offers index restoration only for a missing index with saved material scope: %j', async ({ materialIds, code }) => {
    mocks.get.mockResolvedValue({ data: { session: failureSession(materialIds, code) } });
    mount('task1');
    await screen.findByRole('region', { name: 'Questions needing attention' });
    expect(screen.queryByRole('button', { name: 'Restore material search' })).not.toBeInTheDocument();
    expect(mocks.reindexMaterial).not.toHaveBeenCalled(); expect(mocks.command).not.toHaveBeenCalled();
  });

  it('resets the success notice when the saved task changes', async () => {
    mocks.get.mockResolvedValue({ data: { session: failureSession() } });
    const view = mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Restore material search' }));
    await screen.findByText('Materials are searchable again. Choose Resume task to continue.');
    mocks.get.mockResolvedValue({ data: { session: { ...failureSession(['material4']), id: 'task2' } } });
    view.rerender(<MemoryRouter><AuthoringWorkspace ownerId="owner1" sessionId="task2"
      onSessionChange={mocks.session} onOpenActivity={mocks.open} onAdvanced={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore material search' })).toBeEnabled());
    expect(screen.queryByText('Materials are searchable again. Choose Resume task to continue.')).not.toBeInTheDocument();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('stops restoring additional sources after the workspace is unmounted', async () => {
    let finishFirst!: (value: { processing: { materialId: string; restored: true } }) => void;
    mocks.get.mockResolvedValue({ data: { session: failureSession() } });
    mocks.reindexMaterial.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    const view = mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Restore material search' }));
    view.unmount();
    await act(async () => { finishFirst({ processing: { materialId: 'material1', restored: true } }); });
    expect(mocks.reindexMaterial).toHaveBeenCalledTimes(1);
    expect(mocks.command).not.toHaveBeenCalled();
  });
});

describe('confirmed clarification requests', () => {
  const clarified: AuthoringSession = { ...saved, mode: 'build', status: 'awaiting_requirements', assistant: null,
    messages: [{ id: 'current-choices', role: 'assistant', text: 'Choose the teaching scope.', createdAt: '2026-10-02',
      clarification: [{ question: 'Which topics?', options: ['Motion', 'Forces'], selectionMode: 'multiple' },
        { question: 'How many questions?', options: ['One', 'Five'], selectionMode: 'single' }] }] };
  const selectAnswers = () => {
    fireEvent.click(screen.getByRole('checkbox', { name: 'Motion' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Forces' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write my own answer' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer: Which topics?' }), { target: { value: '  Circular motion  ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Five' }));
  };
  const accepted: AuthoringSession = { ...clarified, revision: 5, status: 'working',
    run: { id: 'confirm-run', status: 'queued', checkpoint: 'start' } };

  it('requires every group, sends structured multi/custom answers once, and preserves a pending stage change', async () => {
    let finish!: (value: { data: { session: AuthoringSession } }) => void;
    mocks.get.mockResolvedValue({ data: { session: clarified } });
    mocks.command.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount('task1');
    const confirm = await screen.findByRole('button', { name: 'Confirm and continue' });
    const composer = screen.getByRole('textbox', { name: 'Message Studio AI' });
    fireEvent.change(composer, { target: { value: 'Draft a later revision.' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Conversation stage' }), { target: { value: 'explore' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Motion' }));
    expect(confirm).toBeDisabled(); expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Motion' }));
    selectAnswers();
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({
      revision: 4, clarificationAnswers: { messageId: 'current-choices', answers: [
        { questionIndex: 0, selectedOptions: ['Motion', 'Forces'], customAnswer: 'Circular motion' },
        { questionIndex: 1, selectedOptions: ['Five'] }
      ] }
    }));
    expect(mocks.command.mock.calls[0][2]).not.toHaveProperty('mode');
    expect(mocks.command.mock.calls[0][2].text).not.toContain('Draft a later revision.');
    mocks.get.mockResolvedValue({ data: { session: accepted } });
    await act(async () => { finish({ data: { session: accepted } }); });
    expect(composer).toHaveValue('Draft a later revision.');
    expect(screen.getByRole('combobox', { name: 'Conversation stage' })).toHaveValue('explore');
    expect(screen.getByText('The stage changes when your next message is processed.')).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('replays an uncertain confirmation with the exact same request and keeps the draft after recovery', async () => {
    mocks.get.mockResolvedValue({ data: { session: clarified } });
    mocks.command.mockRejectedValueOnce(new Error('Connection lost'))
      .mockImplementationOnce(async () => { mocks.get.mockResolvedValue({ data: { session: accepted } }); return { data: { session: accepted } }; });
    mount('task1');
    await screen.findByRole('button', { name: 'Confirm and continue' });
    const composer = screen.getByRole('textbox', { name: 'Message Studio AI' });
    fireEvent.change(composer, { target: { value: 'Keep this unsent draft.' } });
    selectAnswers();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    const retry = await screen.findByRole('button', { name: 'Retry same request' });
    expect(screen.queryByRole('button', { name: 'Confirm and continue' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Motion' })).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[1]).toEqual(mocks.command.mock.calls[0]);
    expect(composer).toHaveValue('Keep this unsent draft.');
    expect(mocks.savePlan).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('retains selected and custom answers after a definite rejection so they can be confirmed again', async () => {
    const rejected = Object.assign(new ApiError('Reloaded the task revision. Try confirming again.'), { status: 409 });
    const refreshed = { ...clarified, revision: 5 };
    mocks.get.mockResolvedValue({ data: { session: clarified } });
    mocks.command.mockImplementationOnce(async () => { mocks.get.mockResolvedValue({ data: { session: refreshed } }); throw rejected; })
      .mockImplementationOnce(async () => { mocks.get.mockResolvedValue({ data: { session: { ...accepted, revision: 6 } } }); return { data: { session: { ...accepted, revision: 6 } } }; });
    mount('task1');
    await screen.findByRole('button', { name: 'Confirm and continue' });
    selectAnswers();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Try confirming again.'));
    expect(screen.getByRole('checkbox', { name: 'Motion' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Five' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Your answer: Which topics?' })).toHaveValue('  Circular motion  ');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[1][2].clarificationAnswers).toEqual(mocks.command.mock.calls[0][2].clarificationAnswers);
    expect(mocks.command.mock.calls[1][2].requestId).not.toBe(mocks.command.mock.calls[0][2].requestId);
    expect(mocks.command.mock.calls[1][2].revision).toBe(5);
  });

  it('keeps superseded clarification cards disabled while allowing the latest card to be confirmed', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...clarified, messages: [
      { ...clarified.messages[0], id: 'old-choices' }, clarified.messages[0]
    ] } } });
    mount('task1');
    const motionChoices = await screen.findAllByRole('checkbox', { name: 'Motion' });
    expect(motionChoices[0]).toBeDisabled(); expect(motionChoices[1]).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Confirm and continue' })).toHaveLength(1);
    expect(mocks.command).not.toHaveBeenCalled();
  });
});

describe('teaching brief and objective edits', () => {
  const brief: AuthoringTeachingBrief = { version: 1, grounding: 'material-grounded', summary: 'Use a source-based motion activity.',
    materials: [{ id: 'material1', name: 'Motion lecture.pdf', format: 'pdf', classification: 'lecture-notes', basis: 'text-excerpts',
      readStatus: 'sampled', sourceCount: 2, sourceIds: ['material1'] },
      { id: 'material2', name: 'Unopened slides.pdf', format: 'pdf', classification: 'slides', basis: 'metadata', readStatus: 'not-read', sourceCount: 0, sourceIds: [] }],
    scope: { topics: ['Motion'], exclusions: ['Circular motion'], coverage: 'sampled' },
    objectives: [{ id: 'lo1', text: 'Explain evaporation.', sourceIds: ['material1'], grounding: 'material-grounded' }],
    assumptions: [{ key: 'audience', value: 'First-year students', reason: 'Level not supplied.', provenance: 'default' },
      { key: 'difficulty', value: 'moderate', reason: 'Use a practice task.', provenance: 'inferred' }], visualSupport: 'text-only' };
  const objectivesOnly: AuthoringSession = { ...saved, status: 'objectives_ready', teachingBrief: brief,
    workflow: { target: 'objectives', autoContinue: false }, assistant: { ...saved.assistant!, status: 'objectives_ready', plan: [], teachingBrief: brief } };
  const updated = (session: AuthoringSession, text = 'Explain condensation.') => ({ ...session, revision: session.revision + 1,
    teachingBrief: { ...brief, objectives: [{ ...brief.objectives[0], text }] },
    assistant: session.assistant ? { ...session.assistant, revision: session.assistant.revision + 1,
      objectives: session.assistant.objectives.map(item => ({ ...item, text })) } : null });

  it('shows inferred material judgments and actual sample coverage without treating unopened sources as read', async () => {
    mocks.get.mockResolvedValue({ data: { session: objectivesOnly } });
    mount('task1');
    const card = await screen.findByRole('region', { name: 'Task teaching brief' });
    expect(card).toHaveTextContent('Coverage: Sampled source excerpts');
    expect(card).toHaveTextContent('Excluded: Circular motion');
    fireEvent.click(within(card).getByText('Material review · 2 materials'));
    const materials = within(card).getAllByRole('listitem');
    expect(materials.find(item => item.textContent?.includes('Motion lecture.pdf'))).toHaveTextContent('Inferred from sampled text · 2 source excerpts sampled');
    expect(materials.find(item => item.textContent?.includes('Unopened slides.pdf'))).toHaveTextContent('Inferred from file details · Source text not read');
    expect(screen.queryByRole('button', { name: /Accept plan & generate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Question set preview/ })).not.toBeInTheDocument();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('shows early objectives without an apparent zero-question plan, then presents the completed real allocation', async () => {
    const preparing: AuthoringSession = { ...objectivesOnly, status: 'planning', workflow: { target: 'questions', autoContinue: true },
      instructions: 'Create 15 questions.', assistant: { ...objectivesOnly.assistant!, status: 'planning' },
      run: { id: 'planning-batch', status: 'waiting', checkpoint: 'dispatch_planning' } };
    mocks.get.mockResolvedValue({ data: { session: preparing } });
    mount('task1');
    const early = await screen.findByRole('button', { name: 'Learning objectives 1 objectives' });
    expect(early.querySelector('small')).toHaveTextContent(/^1 objectives$/);
    expect(screen.queryByRole('button', { name: /Learning objectives & teaching plan/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Task teaching brief' })).toHaveTextContent('Explain evaporation.');
    const planned: AuthoringSession = { ...preparing, revision: 5, status: 'awaiting_approval',
      assistant: { ...preparing.assistant!, status: 'awaiting_approval', plan: [{ ...saved.assistant!.plan[0], count: 15 }] },
      run: { ...preparing.run!, status: 'succeeded' } };
    await act(async () => { mocks.stream.mock.calls.at(-1)![1].onAuthoringSnapshot(planned); });
    expect(screen.getByRole('button', { name: /Learning objectives & teaching plan 1 objectives · 15 planned questions/ })).toBeVisible();
    expect(screen.queryByText(/0 planned questions/)).not.toBeInTheDocument();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('edits and saves LO-only text directly while keeping the unsent message and without generation approval', async () => {
    mocks.get.mockResolvedValue({ data: { session: objectivesOnly } });
    mocks.command.mockImplementation(async () => { const next = updated(objectivesOnly); mocks.get.mockResolvedValue({ data: { session: next } }); return { data: { session: next } }; });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit learning objectives' }));
    const input = screen.getByRole('textbox', { name: 'Edit learning objective 1' });
    expect(screen.getByRole('button', { name: 'Save objectives' })).toBeDisabled();
    fireEvent.change(input, { target: { value: ' Explain evaporation. ' } });
    expect(screen.getByRole('button', { name: 'Save objectives' })).toBeDisabled();
    const composer = screen.getByRole('textbox', { name: 'Message Studio AI' });
    fireEvent.change(composer, { target: { value: 'My unsent teaching question.' } });
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save objectives' })).toBeDisabled();
    fireEvent.change(input, { target: { value: ' Explain condensation. ' } });
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save objectives' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'save_objectives', expect.objectContaining({
      revision: 4, assistantRevision: 2, objectives: [{ id: 'lo1', text: 'Explain condensation.' }]
    })));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit learning objective 1' })).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Task teaching brief' })).toHaveTextContent('Explain condensation.');
    expect(composer).toHaveValue('My unsent teaching question.');
    expect(mocks.command).toHaveBeenCalledTimes(1); expect(mocks.cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Accept plan & generate/ })).not.toBeInTheDocument();
  });

  it.each(['objectives', 'assumptions'] as const)('keeps unsaved %s when New task, History, or Advanced would leave the task', async editor => {
    const advanced = vi.fn();
    mocks.get.mockResolvedValue({ data: { session: objectivesOnly } });
    mocks.list.mockResolvedValue({ data: { sessions: [{ ...saved, id: 'task2', title: 'Other saved task', status: 'ready' }] } });
    render(<MemoryRouter><AuthoringWorkspace ownerId="owner1" sessionId="task1"
      onSessionChange={mocks.session} onOpenActivity={mocks.open} onAdvanced={advanced} /></MemoryRouter>);
    const card = await screen.findByRole('region', { name: 'Task teaching brief' });
    if (editor === 'assumptions') fireEvent.click(within(card).getByText('Teaching assumptions · 2'));
    fireEvent.click(within(card).getByRole('button', { name: editor === 'objectives' ? 'Edit learning objectives' : 'Edit teaching assumptions' }));
    const input = screen.getByRole('textbox', { name: editor === 'objectives' ? 'Edit learning objective 1' : 'Edit teaching assumption audience' });
    const changed = editor === 'objectives' ? 'Explain condensation.' : 'Advanced students';
    fireEvent.change(input, { target: { value: changed } });

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(mocks.session).not.toHaveBeenCalled();
    expect(screen.getByText('Save or cancel your teaching brief edits before leaving this task.')).toBeVisible();
    expect(input).toHaveValue(changed);

    fireEvent.click(screen.getByRole('button', { name: 'Task history' }));
    fireEvent.click(await screen.findByRole('button', { name: /Other saved task/ }));
    expect(mocks.session).not.toHaveBeenCalled();
    expect(input).toHaveValue(changed);

    fireEvent.click(screen.getByRole('button', { name: 'More Studio actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced types' }));
    expect(advanced).not.toHaveBeenCalled();
    expect(input).toHaveValue(changed);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Studio actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced types' }));
    expect(advanced).toHaveBeenCalledTimes(1);
  });

  it('allows navigation when learning objective text is reverted to the saved value', async () => {
    mocks.get.mockResolvedValue({ data: { session: objectivesOnly } });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit learning objectives' }));
    const input = screen.getByRole('textbox', { name: 'Edit learning objective 1' });
    fireEvent.change(input, { target: { value: 'Explain condensation.' } });
    fireEvent.change(input, { target: { value: ' Explain evaporation. ' } });
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    await waitFor(() => expect(mocks.session).toHaveBeenCalledWith(null));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('waits for Pause and edit to stop the live task before enabling objective edits and saving', async () => {
    const active: AuthoringSession = { ...objectivesOnly, workflow: { target: 'questions', autoContinue: true }, status: 'generating',
      run: { id: 'running-batch', status: 'running', checkpoint: 'dispatch_approval' } };
    const stopped: AuthoringSession = { ...active, revision: 5, status: 'cancelled', run: { ...active.run!, status: 'cancelled' } };
    let stop!: (value: { data: { session: AuthoringSession } }) => void;
    mocks.get.mockResolvedValue({ data: { session: active } });
    mocks.cancel.mockImplementationOnce(() => new Promise(resolve => { stop = resolve; }));
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Pause and edit' }));
    expect(mocks.cancel).toHaveBeenCalledWith('task1', 4);
    expect(screen.queryByRole('textbox', { name: 'Edit learning objective 1' })).not.toBeInTheDocument();
    expect(mocks.command).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ data: { session: stopped } });
    await act(async () => { stop({ data: { session: stopped } }); });
    const objective = await screen.findByRole('textbox', { name: 'Edit learning objective 1' });
    expect(objective).toBeEnabled();
    fireEvent.change(objective, { target: { value: 'Compare evaporation and condensation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save objectives' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'save_objectives', expect.objectContaining({ revision: 5,
      objectives: [{ id: 'lo1', text: 'Compare evaporation and condensation.' }] })));
    expect(mocks.command.mock.calls[0][1]).not.toBe('approve');
  });

  it('opens objective edits only after the stop acknowledgement reaches a terminal snapshot, without queuing more work', async () => {
    const active: AuthoringSession = { ...objectivesOnly, workflow: { target: 'questions', autoContinue: true }, status: 'generating',
      run: { id: 'running-batch', status: 'running', checkpoint: 'dispatch_approval' },
      queuedMessages: [{ id: 'pending-message', text: 'Use four questions.', createdAt: '2026-10-02', status: 'queued' }] };
    const stopping: AuthoringSession = { ...active, revision: 5,
      queuedMessages: active.queuedMessages!.map(message => ({ ...message, status: 'cancelled' })) };
    const stopped: AuthoringSession = { ...stopping, revision: 6, status: 'cancelled', error: 'Stopped. Your saved versions are preserved.', run: { ...active.run!, status: 'cancelled' } };
    mocks.get.mockResolvedValue({ data: { session: active } });
    mocks.cancel.mockImplementation(async () => { mocks.get.mockResolvedValue({ data: { session: stopping } }); return { data: { session: stopping } }; });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Pause and edit' }));
    await screen.findByText('Stopping the task before opening learning objective edits…');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('textbox', { name: 'Edit learning objective 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Queued messages' })).toHaveTextContent('Cancelled');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Studio AI' }), { target: { value: 'My next unsent request.' } });
    expect(screen.getByRole('button', { name: 'Queue message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Queue message' }));
    expect(mocks.command).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ data: { session: stopped } });
    await act(async () => { mocks.stream.mock.calls.at(-1)![1].onAuthoringSnapshot(stopped); });
    expect(await screen.findByRole('textbox', { name: 'Edit learning objective 1' })).toBeEnabled();
    expect(screen.queryByText('Stopping the task before opening learning objective edits…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume task' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Message Studio AI' })).toHaveValue('My next unsent request.');
    expect(mocks.cancel).toHaveBeenCalledTimes(1); expect(mocks.command).not.toHaveBeenCalled();
  });

  it('keeps inline objective edits distinct from another form or approving the previous plan', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, teachingBrief: brief } } });
    mount('task1');
    const approve = await screen.findByRole('button', { name: /Accept plan & generate/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit learning objectives' }));
    const objective = screen.getByRole('textbox', { name: 'Edit learning objective 1' });
    fireEvent.change(objective, { target: { value: 'Explain condensation.' } });
    expect(approve).toBeDisabled();
    const card = screen.getByRole('region', { name: 'Task teaching brief' });
    fireEvent.click(within(card).getByText('Teaching assumptions · 2'));
    expect(within(card).getByRole('button', { name: 'Edit teaching assumptions' })).toBeDisabled();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit teaching assumptions' }));
    expect(objective).toHaveValue('Explain condensation.');
    fireEvent.click(screen.getByRole('button', { name: /Learning objectives & teaching plan/ }));
    expect(screen.getByRole('textbox', { name: 'Learning objective 1' })).toBeDisabled();
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel edits' }));
    expect(approve).toBeEnabled();
  });

  it('replays an uncertain objective save and keeps its edited text until the save is accepted', async () => {
    const next = updated(objectivesOnly);
    mocks.get.mockResolvedValue({ data: { session: objectivesOnly } });
    mocks.command.mockRejectedValueOnce(new Error('Save response lost'))
      .mockImplementationOnce(async () => { mocks.get.mockResolvedValue({ data: { session: next } }); return { data: { session: next } }; });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit learning objectives' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit learning objective 1' }), { target: { value: 'Explain condensation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save objectives' }));
    const retry = await screen.findByRole('button', { name: 'Retry same request' });
    expect(screen.getByRole('textbox', { name: 'Edit learning objective 1' })).toHaveValue('Explain condensation.');
    expect(screen.getByRole('button', { name: 'Save objectives' })).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[0]).toEqual(mocks.command.mock.calls[1]);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit learning objective 1' })).not.toBeInTheDocument());
  });

  it('keeps edits after a rejected reservation and saves again with the refreshed unchanged assistant revision', async () => {
    const reserved: AuthoringSession = { ...objectivesOnly, revision: 5, assistant: { ...objectivesOnly.assistant!, revision: 3 } };
    const next = updated(reserved);
    mocks.get.mockResolvedValue({ data: { session: objectivesOnly } });
    mocks.command.mockImplementationOnce(async () => {
      mocks.get.mockResolvedValue({ data: { session: reserved } });
      throw Object.assign(new ApiError('The save was rejected. Try again.'), { status: 409 });
    }).mockImplementationOnce(async () => { mocks.get.mockResolvedValue({ data: { session: next } }); return { data: { session: next } }; });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit learning objectives' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit learning objective 1' }), { target: { value: 'Explain condensation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save objectives' }));
    await screen.findByText('The save was rejected. Try again.');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('textbox', { name: 'Edit learning objective 1' })).toHaveValue('Explain condensation.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save objectives' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save objectives' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[1][2]).toMatchObject({ revision: 5, assistantRevision: 3, objectives: [{ id: 'lo1', text: 'Explain condensation.' }] });
    expect(mocks.command.mock.calls[1][2].requestId).not.toBe(mocks.command.mock.calls[0][2].requestId);
  });

  it('preserves local edits but blocks saving over objectives changed in another task view', async () => {
    mocks.get.mockResolvedValue({ data: { session: objectivesOnly } });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit learning objectives' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit learning objective 1' }), { target: { value: 'Explain condensation.' } });
    const changed = updated(objectivesOnly, 'Compare phase changes.');
    await act(async () => { mocks.stream.mock.calls.at(-1)![1].onAuthoringSnapshot(changed); });
    expect(screen.getByRole('textbox', { name: 'Edit learning objective 1' })).toHaveValue('Explain condensation.');
    expect(screen.getByRole('region', { name: 'Task teaching brief' })).toHaveTextContent('The saved objectives changed while you were editing.');
    expect(screen.getByRole('button', { name: 'Save objectives' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel edits' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save objectives' }));
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('shows actual per-question focus as a collapsed list without internal guidance or raw source IDs', async () => {
    const session: AuthoringSession = { ...saved, assistant: { ...saved.assistant!, plan: [{ ...saved.assistant!.plan[0], questionTasks: [
      { id: 'task-a', focus: 'Predict evaporation when water warms.', instructions: 'PRIVATE TASK GUIDANCE A', sourceIds: ['private-source-id-a'], visualRequirement: 'none' },
      { id: 'task-b', focus: 'Explain condensation when vapour cools.', instructions: 'PRIVATE TASK GUIDANCE B', sourceIds: ['private-source-id-b'], visualRequirement: 'none' }
    ] }] } };
    mocks.get.mockResolvedValue({ data: { session } });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: /Learning objectives & teaching plan/ }));
    const details = screen.getByLabelText('Question focus for Check evaporation');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(within(details).getByText('Question focus · 2 questions'));
    expect(within(details).getAllByRole('listitem')).toHaveLength(2);
    expect(within(details).getByText('Predict evaporation when water warms.')).toBeVisible();
    expect(within(details).getByText('Explain condensation when vapour cools.')).toBeVisible();
    expect(screen.queryByText(/PRIVATE TASK GUIDANCE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/private-source-id/)).not.toBeInTheDocument();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('revises accepted objectives through a candidate without replacing the current version or auto-accepting', async () => {
    const current: AuthoringSession['versions'][number] = { id: 'current1', number: 1, parentId: null, restoredFromId: null,
      contentId: 'accepted-content', title: 'Motion', summary: 'Saved activity', changes: [], representation: 'course-linked',
      state: 'accepted', createdAt: '2026-10-02', questions: [], teachingPlan: {
        objectives: [{ id: 'accepted-lo', text: 'Explain uniform motion.' }], plan: [] } };
    const accepted: AuthoringSession = { ...objectivesOnly, workflow: { target: 'questions', autoContinue: true }, status: 'ready',
      currentVersionId: current.id, versions: [current] };
    const candidate: AuthoringSession['versions'][number] = { ...current, id: 'candidate2', number: 2, parentId: current.id,
      contentId: 'candidate-content', state: 'candidate', teachingPlan: { objectives: [{ id: 'accepted-lo', text: 'Apply uniform motion.' }], plan: [] } };
    const next: AuthoringSession = { ...accepted, revision: 5, candidateVersionId: candidate.id, versions: [current, candidate] };
    mocks.get.mockResolvedValue({ data: { session: accepted } });
    mocks.command.mockImplementation(async () => { mocks.get.mockResolvedValue({ data: { session: next } }); return { data: { session: next } }; });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit learning objectives' }));
    expect(screen.getByRole('textbox', { name: 'Edit learning objective 1' })).toHaveValue('Explain uniform motion.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit learning objective 1' }), { target: { value: 'Apply uniform motion.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save objectives' }));
    await screen.findByRole('button', { name: 'Accept changes' });
    expect(mocks.command).toHaveBeenCalledWith('task1', 'save_objectives', expect.objectContaining({ objectives: [{ id: 'accepted-lo', text: 'Apply uniform motion.' }] }));
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Task teaching brief' })).toHaveTextContent('Apply uniform motion.');
    expect(current.teachingPlan!.objectives[0].text).toBe('Explain uniform motion.');
    expect(next.currentVersionId).toBe(current.id);
  });

  it('edits the accepted native version’s objectives and shows its candidate brief without overwriting accepted text', async () => {
    const nativeBrief: AuthoringTeachingBrief = { ...brief, summary: 'Interpret a supplied bar chart.',
      objectives: [{ id: 'native-accepted-lo', text: 'Compare the three experimental durations.', sourceIds: [], grounding: 'instructor-brief' }] };
    const current: AuthoringSession['versions'][number] = { id: 'native-current', number: 1, parentId: null, restoredFromId: null,
      contentId: 'native-accepted-content', title: 'Chart', summary: 'Saved chart', changes: [], representation: 'native-fork',
      state: 'accepted', createdAt: '2026-10-02', questions: [], teachingPlan: null, teachingBrief: nativeBrief };
    const accepted: AuthoringSession = { ...objectivesOnly, status: 'ready', workflow: { target: 'native', autoContinue: true },
      currentVersionId: current.id, versions: [current] };
    const candidateBrief: AuthoringTeachingBrief = { ...nativeBrief, objectives: [{ ...nativeBrief.objectives[0], text: 'Explain the difference between experimental durations.' }] };
    const candidate: AuthoringSession['versions'][number] = { ...current, id: 'native-candidate', number: 2, parentId: current.id,
      contentId: 'native-candidate-content', state: 'candidate', teachingBrief: candidateBrief };
    const next: AuthoringSession = { ...accepted, revision: 5, candidateVersionId: candidate.id, versions: [current, candidate] };
    mocks.get.mockResolvedValue({ data: { session: accepted } });
    mocks.command.mockImplementation(async () => { mocks.get.mockResolvedValue({ data: { session: next } }); return { data: { session: next } }; });
    mount('task1');
    expect(await screen.findByRole('region', { name: 'Task teaching brief' })).toHaveTextContent('Interpret a supplied bar chart.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit learning objectives' }));
    const input = screen.getByRole('textbox', { name: 'Edit learning objective 1' });
    expect(input).toHaveValue('Compare the three experimental durations.');
    fireEvent.change(input, { target: { value: 'Explain the difference between experimental durations.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save objectives' }));
    await screen.findByRole('button', { name: 'Accept changes' });
    expect(mocks.command).toHaveBeenCalledWith('task1', 'save_objectives', expect.objectContaining({ objectives: [{ id: 'native-accepted-lo', text: 'Explain the difference between experimental durations.' }] }));
    expect(mocks.command.mock.calls[0][2]).not.toHaveProperty('assistantRevision');
    expect(screen.getByRole('region', { name: 'Task teaching brief' })).toHaveTextContent('Explain the difference between experimental durations.');
    expect(screen.getByRole('button', { name: 'Edit learning objectives' })).toBeDisabled();
    expect(current.teachingBrief?.objectives[0].text).toBe('Compare the three experimental durations.');
    expect(accepted.teachingBrief?.objectives[0].text).toBe('Explain evaporation.');
    expect(mocks.command).toHaveBeenCalledTimes(1);
  });

  it('edits assumptions in a form and sends their actual values without copying or clearing the composer', async () => {
    mocks.get.mockResolvedValue({ data: { session: objectivesOnly } });
    mocks.command.mockResolvedValue({ data: { session: objectivesOnly } });
    mount('task1');
    const card = await screen.findByRole('region', { name: 'Task teaching brief' });
    const composer = screen.getByRole('textbox', { name: 'Message Studio AI' });
    fireEvent.change(composer, { target: { value: 'Keep my unsent draft.' } });
    fireEvent.click(within(card).getByText('Teaching assumptions · 2'));
    fireEvent.click(within(card).getByRole('button', { name: 'Edit teaching assumptions' }));
    expect(screen.getByRole('button', { name: 'Save teaching assumptions' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit teaching assumption audience' }), { target: { value: 'Advanced students' } });
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save teaching assumptions' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({ text: expect.stringContaining('Audience: Advanced students') })));
    expect(mocks.command.mock.calls[0][2].text).not.toContain('Keep my unsent draft.');
    expect(composer).toHaveValue('Keep my unsent draft.');
  });
});
afterEach(() => { vi.useRealTimers(); });
describe('Studio AI workspace', () => {
  it('reviews and explicitly approves a native activity plan without a course question blueprint', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, assistant: null, quizId: null,
      nativePlan: { version: 1, revision: 7, status: 'awaiting_approval', library: 'H5P.Chart 1.2', title: 'Chart',
        brief: 'Compare supplied population values.', materialIds: [], objectiveIds: [] } } } });
    mount('task1');
    const approve = await screen.findByRole('button', { name: /Accept plan & generate/ });
    expect(approve).toBeEnabled();
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Native activity plan/ }));
    expect(screen.getByText('Compare supplied population values.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Question count for plan row 1' })).not.toBeInTheDocument();
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'approve', expect.objectContaining({ planRevision: 7 })));
  });

  it('labels an independent native result as an activity without inventing a checked-question count', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, assistant: null, status: 'ready', quizId: null,
      currentVersionId: 'native1', versions: [{ id: 'native1', number: 1, parentId: null, restoredFromId: null,
        contentId: 'chart1', title: 'Chart', summary: 'Created Chart.', changes: [], representation: 'native-fork',
        state: 'accepted', createdAt: '2026-10-01', questions: [] }] } } });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: /Activity preview/ }));
    expect(screen.getByTestId('preview')).toHaveTextContent('chart1');
    expect(screen.queryByText(/0 checked questions/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open course workspace' })).not.toBeInTheDocument();
  });
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
  it('does not label a manual native version with its earlier course plan', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, status: 'ready', currentVersionId: 'manual2',
      versions: [{ id: 'manual2', number: 2, parentId: 'linked1', restoredFromId: null,
        contentId: 'manual-content', title: 'Water', summary: 'Saved editor changes.', changes: [],
        representation: 'native-fork', state: 'accepted', createdAt: '2026-10-01', questions: [] }] } } });
    mount('task1');
    expect(await screen.findByRole('button', { name: /Activity preview/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Learning objectives & teaching plan/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/2 planned questions/)).not.toBeInTheDocument();
  });
  it('shows the proposed question count and current operations rather than the initial completed batch', async () => {
    const version = { id: 'v2', number: 2, parentId: 'v1', restoredFromId: null, contentId: 'content2', title: 'Water',
      summary: '', changes: [], representation: 'course-linked' as const, state: 'candidate' as const, createdAt: '2026-10-01',
      questions: [1, 2].map(index => ({ id: `q${index}`, index, type: 'multiple-choice', text: 'Water?', sourceReferences: [] })) };
    mocks.get.mockResolvedValue({ data: { session: { ...saved, currentVersionId: 'v1', candidateVersionId: 'v2',
      status: 'working', versions: [version], run: { id: 'run2', status: 'running', checkpoint: 'committing', startedAt: '2026-10-01' },
      assistant: { ...saved.assistant, events: [{ stage: 'completed', message: 'Old batch complete.', createdAt: '2026-09-27' }],
        generation: { requestId: 'old-batch', readyCount: 3, totalQuestions: 3, items: [{ index: 0, status: 'ready' }] } } } } });
    mount('task1');
    expect(await screen.findByRole('button', { name: /Question set preview 2 checked questions/ })).toBeInTheDocument();
    expect(screen.queryByText('Old batch complete.')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Questions prepared' })).not.toBeInTheDocument();
    expect(screen.queryByText('3/3 questions checked')).not.toBeInTheDocument();
  });
  it('reviews the selected version plan after an objective merge instead of the original assistant plan', async () => {
    const version = { id: 'v2', number: 2, parentId: 'v1', restoredFromId: null, contentId: 'content2', title: 'Water',
      summary: 'Merged objectives.', changes: [], representation: 'course-linked' as const, state: 'candidate' as const,
      createdAt: '2026-10-01', questions: [], teachingPlan: {
        objectives: [{ id: 'merged', text: 'Compare evaporation and condensation.', sourceReferences: [] }],
        plan: [{ id: 'merged-row', title: 'Compare both processes', questionType: 'multiple-choice', count: 1,
          objectiveIds: ['merged'], instructions: 'Assess both processes in one question.' }]
      } };
    mocks.get.mockResolvedValue({ data: { session: { ...saved, status: 'ready', currentVersionId: 'v1', candidateVersionId: 'v2', versions: [version] } } });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: /Learning objectives & teaching plan 1 objectives · 1 planned questions/ }));
    expect(screen.getByRole('textbox', { name: 'Learning objective 1' })).toHaveValue('Compare evaporation and condensation.');
    expect(screen.getByRole('textbox', { name: 'Learning objective 1' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Question instructions for plan row 1' })).toHaveValue('Assess both processes in one question.');
    expect(screen.queryByDisplayValue('Explain evaporation.')).not.toBeInTheDocument();
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
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({
      clarificationAnswers: { messageId: 'intake1', answers: [{ questionIndex: 0, selectedOptions: ['One'] }] }
    })));
    expect(screen.getByRole('textbox', { name: 'Message Studio AI' })).toHaveValue('');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('confirms clarification directly and preserves the unsent composer draft', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, messages: [{ id: 'clarify1', role: 'assistant', text: 'Choose your intended count.', createdAt: '2026-09-30',
      clarification: [{ question: 'How many questions?', options: ['One', 'Five'] }] }] } } });
    mount('task1');
    fireEvent.click(await screen.findByRole('radio', { name: 'One' }));
    const composer = screen.getByRole('textbox', { name: 'Message Studio AI' });
    fireEvent.change(composer, { target: { value: 'Unsent draft: change a later activity.' } });
    expect(composer).toHaveValue('Unsent draft: change a later activity.');
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Five' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({
      text: expect.stringContaining('How many questions? Five'),
      clarificationAnswers: { messageId: 'clarify1', answers: [{ questionIndex: 0, selectedOptions: ['Five'] }] }
    })));
    expect(mocks.command.mock.calls[0][2].text).not.toContain('Unsent draft');
    expect(composer).toHaveValue('Unsent draft: change a later activity.');
    expect(mocks.command).toHaveBeenCalledTimes(1);
  });
  it('shows live failure observations while work continues and offers manual recovery only after the task stops', async () => {
    const recovery = 'Inspect the saved review observations and refine the instructions before explicitly retrying.';
    const items: NonNullable<NonNullable<AuthoringSession['assistant']>['generation']>['items'] = Array.from({ length: 15 }, (_, index) =>
      index === 8 || index === 11 ? { index, status: 'failed', reason: 'ANSWER_INVALID',
        failure: { code: 'QUESTION_QUALITY_REVIEW', stage: 'review', message: 'This question did not pass its quality check.', recovery, retryable: true },
        review: { questionText: `Rejected question ${index + 1}.`, correctAnswer: 'An ambiguous draft answer.', options: [], issues: ['The draft answer needs checking.'] } }
        : { index, status: 'ready' });
    const active: AuthoringSession = { ...saved, status: 'generating', workflow: { target: 'questions', autoContinue: true },
      run: { id: 'repair-run', status: 'running', checkpoint: 'continue_recovery' }, assistant: { ...saved.assistant!, status: 'generating',
        plan: [{ ...saved.assistant!.plan[0], count: 15 }], generation: { requestId: 'repair-batch', status: 'running',
          readyCount: 13, totalQuestions: 15, published: true, items } } };
    mocks.get.mockResolvedValue({ data: { session: active } });
    mount('task1');
    const card = await screen.findByRole('region', { name: 'Questions needing attention' });
    expect(card).toHaveTextContent('13 of 15 questions checked. Task is still running.');
    expect(within(card).getByRole('heading', { name: 'Why a question needs attention' })).toBeVisible();
    expect(card).toHaveTextContent('See Task steps for the current generation and repair actions.');
    fireEvent.click(within(card).getByText('Question 9', { selector: 'strong' }));
    expect(within(card).getByText('Rejected question 9.')).toBeVisible();
    expect(card).toHaveTextContent('Error code: QUESTION_QUALITY_REVIEW');
    expect(within(card).queryByText(recovery)).not.toBeInTheDocument();
    expect(within(card).queryByText('Next step:')).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent('Resume task retries');
    expect(screen.queryByRole('button', { name: 'Resume task' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Discuss the failure' })).toBeDisabled();
    const stopped: AuthoringSession = { ...active, revision: 5, status: 'needs_attention', error: 'One question remains unfinished.',
      run: { ...active.run!, status: 'failed' }, assistant: { ...active.assistant!, status: 'failed', phase: 'generating',
        errorCode: 'ASSISTANT_QUESTION_BATCH_FAILED', generation: { ...active.assistant!.generation!, status: 'failed', readyCount: 14,
          items: items.map(item => item.index === 8 ? { index: item.index, status: 'ready' } : item) } } };
    await act(async () => { mocks.stream.mock.calls.at(-1)![1].onAuthoringSnapshot(stopped); });
    expect(card).toHaveTextContent('14 of 15 questions checked.');
    expect(within(card).getByRole('heading', { name: 'Why generation stopped' })).toBeVisible();
    expect(within(screen.getByLabelText('Generation failure reasons')).getByText(recovery)).toBeVisible();
    expect(card).toHaveTextContent('Resume task retries only the unfinished questions.');
    expect(card).toHaveTextContent('If the updated plan awaits review, choose Accept plan & generate.');
    expect(card).not.toHaveTextContent('See Task steps for the current generation and repair actions.');
    expect(screen.getByRole('button', { name: 'Resume task' })).toBeEnabled();
    expect(mocks.command).not.toHaveBeenCalled();
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
  it('shows a zero-ready retrieval failure without offering a nonexistent preview or starting another request', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, status: 'needs_attention', error: 'Source search unavailable.',
      assistant: { ...saved.assistant, generation: { requestId: 'request-1', status: 'failed', readyCount: 0, totalQuestions: 15,
        items: Array.from({ length: 15 }, (_, index) => ({ index, status: 'failed', attempts: 0,
          failure: { code: 'RAG_UNAVAILABLE', stage: 'evidence', message: 'Source evidence could not be retrieved. Question generation has not started.',
            recovery: 'Restore source search, then resume the saved plan.', retryable: true } })) } } } } });
    mount('task1');
    const issues = await screen.findByRole('region', { name: 'Questions needing attention' });
    expect(issues).toHaveTextContent('No questions were prepared. The teaching plan is saved');
    expect(issues).toHaveTextContent('15 questions affected');
    expect(issues).toHaveTextContent('Retrieve source evidence');
    expect(screen.queryByRole('button', { name: /Question set preview/ })).not.toBeInTheDocument();
    expect(mocks.command).not.toHaveBeenCalled();
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start teaching discussion' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Start teaching discussion' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'explore', materialIds: [], objectiveIds: [], autoApprove: false, instructions: 'Brainstorm LOs for introductory mechanics.' })));
  });
  it('opens context tools beside an @ mention, attaches an LO, and previews it', async () => {
    mount();
    const input = screen.getByRole('textbox', { name: 'Message Studio AI' });
    fireEvent.change(input, { target: { value: 'Use @' } });
    expect(screen.getByRole('dialog', { name: 'Add context' })).toHaveClass('is-mention');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(screen.getByRole('dialog', { name: 'Add context' })).getAllByRole('option')[0]).toHaveFocus();
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
  it('explains course material and objective access alongside an existing course description', async () => {
    mount();
    fireEvent.click(await screen.findByTitle('Preview Water science'));
    const preview = screen.getByRole('dialog', { name: 'Context preview' });
    expect(preview).toHaveTextContent('Water course');
    expect(preview).toHaveTextContent('CREATE can read your materials and learning objectives in this course');
    expect(preview).toHaveTextContent('select ready materials for an initial proposal');
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.command).not.toHaveBeenCalled();
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Conversation stage' }), { target: { value: 'build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start learning activity' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'build', courseId: 'course1', materialIds: ['material1'], instructions: '', autoApprove: false })));
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
  it('queues a message during generation while keeping Stop task available', async () => {
    const active: AuthoringSession = { ...saved, mode: 'build', status: 'generating', run: { id: 'run1', status: 'running', checkpoint: 'dispatch_approval' } };
    const queued: AuthoringSession = { ...active, revision: 5, queuedMessages: [{ id: 'queued1', text: 'Use ten questions and omit condensation.', createdAt: '2026-10-01T10:00:00Z', status: 'queued' }] };
    mocks.get.mockResolvedValue({ data: { session: active } });
    mocks.command.mockImplementation(async () => { mocks.get.mockResolvedValue({ data: { session: queued } }); return { data: { session: queued } }; });
    mount('task1');
    const stop = await screen.findByRole('button', { name: 'Stop task' });
    const input = screen.getByRole('textbox', { name: 'Message Studio AI' });
    expect(input).toBeEnabled();
    expect(stop).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Queue message' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Use ten questions and omit condensation.' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({ revision: 4, delivery: 'queue', text: 'Use ten questions and omit condensation.' })));
    expect(await screen.findByRole('region', { name: 'Queued messages' })).toHaveTextContent('Waiting for the current task');
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Stop task' })).toBeEnabled();
    expect(screen.getByText(/The current generation keeps its approved requirements/)).toBeVisible();
  });
  it('stops the active task and shows the cancelled queued message from the server', async () => {
    const active: AuthoringSession = { ...saved, status: 'generating', run: { id: 'run1', status: 'running', checkpoint: 'dispatch_approval' },
      queuedMessages: [{ id: 'queued1', text: 'Change the difficulty.', createdAt: '2026-10-01T10:00:00Z', status: 'queued' }] };
    const stopped: AuthoringSession = { ...active, revision: 5, status: 'cancelled', run: { ...active.run!, status: 'cancelled' }, queuedMessages: active.queuedMessages!.map(message => ({ ...message, status: 'cancelled' })) };
    mocks.get.mockResolvedValue({ data: { session: active } });
    mocks.cancel.mockImplementation(async () => { mocks.get.mockResolvedValue({ data: { session: stopped } }); return { data: { session: stopped } }; });
    mount('task1');
    fireEvent.click(await screen.findByRole('button', { name: 'Stop task' }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('task1', 4));
    expect(await screen.findByRole('region', { name: 'Queued messages' })).toHaveTextContent('Cancelled');
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('queues a count clarification without capturing the currently displayed exploration stage', async () => {
    const active: AuthoringSession = { ...saved, mode: 'explore', status: 'working', assistant: null,
      run: { id: 'run1', status: 'running', checkpoint: 'start' } };
    mocks.get.mockResolvedValue({ data: { session: active } });
    mocks.command.mockResolvedValue({ data: { session: active } });
    mount('task1');
    const stage = await screen.findByRole('combobox', { name: 'Conversation stage' });
    await waitFor(() => expect(stage).toHaveValue('explore'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Studio AI' }), { target: { value: '将总题数改为3道题。' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue message' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({ delivery: 'queue', text: '将总题数改为3道题。' })));
    expect(mocks.command.mock.calls[0][2]).not.toHaveProperty('mode');
  });
  it('sends an explicit exploration stage choice together with the next typed message', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, mode: 'build', status: 'awaiting_approval' } } });
    mount('task1');
    const stage = await screen.findByRole('combobox', { name: 'Conversation stage' });
    await waitFor(() => expect(stage).toHaveValue('build'));
    fireEvent.change(stage, { target: { value: 'explore' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Studio AI' }), { target: { value: 'Discuss whether to create five questions.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({ mode: 'explore', text: 'Discuss whether to create five questions.' })));
  });
  it('sends a stage change with the next message without creating a new conversation', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, mode: 'explore', status: 'exploring', assistant: null } } });
    mount('task1');
    const stage = await screen.findByRole('combobox', { name: 'Conversation stage' });
    await waitFor(() => expect(stage).toHaveValue('explore'));
    fireEvent.change(stage, { target: { value: 'build' } });
    expect(screen.getByText('The stage changes when your next message is processed.')).toBeVisible();
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task1', 'message', expect.objectContaining({ mode: 'build', text: 'Build a learning activity from our teaching discussion.' })));
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('shows a recorded operation result when its row is expanded', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, operations: [{ id: 'operation1', runId: 'run1', name: 'inspect_course', label: 'Inspect course context', status: 'completed', startedAt: '2026-10-01T10:00:00Z', durationMs: 500,
      summary: 'Found three processed materials and two saved learning objectives.' }] } } });
    mount('task1');
    fireEvent.click((await screen.findByLabelText('Task steps')).querySelector('summary')!);
    fireEvent.click(await screen.findByText('Inspect course context'));
    expect(screen.getByText('Found three processed materials and two saved learning objectives.')).toBeVisible();
  });
  it('shows work duration without counting time spent waiting in the message queue', async () => {
    mocks.get.mockResolvedValue({ data: { session: { ...saved, run: { ...saved.run!,
      createdAt: '2026-10-01T10:00:00Z', startedAt: '2026-10-01T10:25:00Z', updatedAt: '2026-10-01T10:25:48Z' } } } });
    mount('task1');
    const steps = await screen.findByLabelText('Task steps');
    expect(steps).toHaveTextContent('Worked for 48s');
    expect(steps).not.toHaveTextContent('25m');
  });
});
