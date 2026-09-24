import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudioAIComposer from './StudioAIComposer';
import { MemoryRouter } from 'react-router-dom';
import { studioBriefKey } from '../../utils/studioBrief';
import type { H5PStudioContent } from '../../services/api';

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), generate: vi.fn(), status: vi.fn(), prepare: vi.fn(), plan: vi.fn(), suggest: vi.fn(), folders: vi.fn(), quizzes: vi.fn(), materials: vi.fn(), objectives: vi.fn(), createCourse: vi.fn(), createQuiz: vi.fn(), upload: vi.fn(), assign: vi.fn(), generateObjectives: vi.fn(), getQuiz: vi.fn() }));
vi.mock('../../services/api', () => ({ ApiError: class extends Error {}, h5pEditorApi: { getActivityCatalog: mocks.catalog, startGeneration: mocks.generate, getGeneration: mocks.status, prepareTemplate: mocks.prepare, planActivity: mocks.plan, suggestPrompt: mocks.suggest }, foldersApi: { getFolders: mocks.folders, createFolder: mocks.createCourse }, quizApi: { getQuizzes: mocks.quizzes, createQuiz: mocks.createQuiz, assignMaterials: mocks.assign, getQuiz: mocks.getQuiz }, materialsApi: { getMaterials: mocks.materials, uploadFiles: mocks.upload }, objectivesApi: { getObjectives: mocks.objectives, generateObjectives: mocks.generateObjectives } }));
const types = [
  { library: 'H5P.Chart 1.2', machineName: 'H5P.Chart', title: 'Chart', version: '1.2.22', category: 'Questions & text activities', mode: 'generate', guidance: 'Describe your data.' },
  { library: 'H5P.MemoryGame 1.3', machineName: 'H5P.MemoryGame', title: 'Memory Game', version: '1.3.29', category: 'Media activities', mode: 'template', guidance: 'Prepare real images first.' },
  { library: 'H5P.Dictation 1.4', machineName: 'H5P.Dictation', title: 'Dictation', version: '1.4.0', category: 'Media activities', mode: 'unavailable', guidance: 'Needs a newer runtime.' },
  { library: 'H5P.DocumentationTool 1.8', machineName: 'H5P.DocumentationTool', title: 'Documentation Tool', version: '1.8.27', category: 'Questions & text activities', mode: 'generate', guidance: 'Write pages and export responses.' },
  { library: 'H5P.MultiChoice 1.16', machineName: 'H5P.MultiChoice', title: 'Multiple Choice', version: '1.16.0', category: 'Questions & text activities', mode: 'generate', guidance: 'Choose answers.', questionTypes: [{ type: 'multiple-choice', title: 'Multiple Choice', containers: ['column', 'question-set', 'interactive-book'] }] },
  { library: 'H5P.TrueFalse 1.8', machineName: 'H5P.TrueFalse', title: 'True/False', version: '1.8.0', category: 'Questions & text activities', mode: 'generate', guidance: 'Decide true or false.', questionTypes: [{ type: 'true-false', title: 'True/False', containers: ['column', 'question-set', 'interactive-book'] }] },
  { library: 'H5P.Column 1.20', machineName: 'H5P.Column', title: 'Column', version: '1.20.0', category: 'Lessons & collections', mode: 'generate' },
  { library: 'H5P.QuestionSet 1.21', machineName: 'H5P.QuestionSet', title: 'Question Set', version: '1.21.0', category: 'Lessons & collections', mode: 'generate' },
  { library: 'H5P.InteractiveBook 1.11', machineName: 'H5P.InteractiveBook', title: 'Interactive Book', version: '1.11.0', category: 'Lessons & collections', mode: 'generate' }
];
const onGenerated = vi.fn();
const onBusyChange = vi.fn();
const renderComposer = () => render(<StudioAIComposer contents={[]} quizId="quiz-1" onGenerated={onGenerated} onBusyChange={onBusyChange} />);

describe('Studio AI guided creation', () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); mocks.catalog.mockResolvedValue({ data: { types } }); mocks.folders.mockResolvedValue({ folders: [] }); mocks.quizzes.mockResolvedValue({ quizzes: [] }); mocks.materials.mockResolvedValue({ materials: [] }); mocks.objectives.mockResolvedValue({ objectives: [] }); });

  it('blocks unavailable/media types with an actionable explanation', async () => {
    renderComposer();
    const selector = await screen.findByLabelText('Activity type');
    fireEvent.change(selector, { target: { value: 'H5P.MemoryGame 1.3' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Create a memory game for biology.' } });
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeDisabled();
    mocks.prepare.mockResolvedValue({ data: { content: { contentId: 'template' } } });
    fireEvent.click(screen.getByRole('button', { name: /Prepare a template/ }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith({ contentId: 'template' }));
    expect(mocks.prepare).toHaveBeenCalledWith('H5P.MemoryGame 1.3');
    fireEvent.change(selector, { target: { value: 'H5P.Dictation 1.4' } });
    expect(screen.getByText('Needs a newer runtime.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeDisabled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('explains why Documentation Tool cannot satisfy the photographed multiple-choice and Word-export brief', async () => {
    renderComposer();
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.DocumentationTool 1.8' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: "Read a resource, define its themes, answer 4 multiple-choice questions, then export all answers to a Word doc." } });
    expect(screen.getByRole('alert')).toHaveTextContent('Documentation Tool cannot contain multiple-choice questions');
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeDisabled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('passes the chosen type without course evidence, then opens the saved draft', async () => {
    mocks.generate.mockResolvedValue({ data: { job: { status: 'running' } } });
    mocks.status.mockResolvedValue({ data: { job: { status: 'succeeded' }, content: { contentId: 'new-draft' } } });
    renderComposer();
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.Chart 1.2' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Chart oaks 12 and pines 8.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith({ contentId: 'new-draft' }), { timeout: 3000 });
    expect(mocks.generate).toHaveBeenCalledWith({ requestId: expect.any(String), library: 'H5P.Chart 1.2', instructions: 'Chart oaks 12 and pines 8.', quizId: undefined, templateContentId: undefined });
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('preserves the brief on failure so the teacher can retry', async () => {
    mocks.generate.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { job: { status: 'failed', message: 'No content was saved. Please use a shorter brief.' } } });
    renderComposer();
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.Chart 1.2' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Chart oaks 12 and pines 8.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('No content was saved');
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('Chart oaks 12 and pines 8.');
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeEnabled();
  });

  it('recovers a saved receipt without submitting another generation', async () => {
    sessionStorage.setItem('create-studio-generation-receipt', 'existing-request');
    mocks.status.mockResolvedValue({ data: { job: { status: 'succeeded' }, content: { contentId: 'recovered' } } });
    renderComposer();
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith({ contentId: 'recovered' }), { timeout: 3000 });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('create-studio-generation-receipt')).toBeNull();
  });

  it('restores instructions and the selected type after leaving and remounting the composer', async () => {
    const first = renderComposer();
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.Chart 1.2' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Chart oaks 12 and pines 8.' } });
    first.unmount();
    renderComposer();
    expect(await screen.findByLabelText('Activity type')).toHaveValue('H5P.Chart 1.2');
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('Chart oaks 12 and pines 8.');
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('restores a generated activity brief and uses its saved content for refinement', async () => {
    const content = { contentId: 'generated', mainLibrary: 'H5P.Chart', title: 'Tree survey' } as H5PStudioContent;
    mocks.generate.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { job: { status: 'succeeded' }, content } });
    const first = renderComposer();
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.Chart 1.2' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Chart oaks 12 and pines 8.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(content), { timeout: 3000 });
    first.unmount();
    render(<StudioAIComposer contents={[content]} currentContent={content} quizId="quiz-1" onGenerated={onGenerated} onBusyChange={onBusyChange} />);
    expect(await screen.findByLabelText('Activity type')).toHaveValue('H5P.Chart 1.2');
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('Chart oaks 12 and pines 8.');
    expect(screen.getByLabelText('Start from a saved activity (optional)')).toHaveValue('generated');
  });

  it('selects the existing activity type even when no historical brief is available', async () => {
    const content = { contentId: 'older', mainLibrary: 'H5P.Chart', title: 'Older chart' } as H5PStudioContent;
    render(<StudioAIComposer contents={[content]} currentContent={content} onGenerated={onGenerated} onBusyChange={onBusyChange} />);
    expect(await screen.findByLabelText('Activity type')).toHaveValue('H5P.Chart 1.2');
    expect(screen.getByLabelText('Start from a saved activity (optional)')).toHaveValue('older');
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('');
  });

  it('keeps an explicitly cleared template empty when restoring a different activity type', async () => {
    const content = { contentId: 'older', mainLibrary: 'H5P.MemoryGame', title: 'Older game' } as H5PStudioContent;
    sessionStorage.setItem(studioBriefKey('', undefined, 'older'), JSON.stringify({
      library: 'H5P.Chart 1.2', instructions: 'Chart oaks 12 and pines 8.', templateContentId: '', query: ''
    }));
    mocks.generate.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { job: { status: 'failed', message: 'Test complete' } } });
    const compatible = { contentId: 'chart-template', mainLibrary: 'H5P.Chart', title: 'Existing chart' } as H5PStudioContent;
    render(<StudioAIComposer contents={[content, compatible]} currentContent={content} onGenerated={onGenerated} onBusyChange={onBusyChange} />);
    expect(await screen.findByLabelText('Activity type')).toHaveValue('H5P.Chart 1.2');
    expect(screen.getByLabelText('Start from a saved activity (optional)')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      library: 'H5P.Chart 1.2', templateContentId: undefined
    })));
  });

  it('does not submit a previous collection as an invisible Documentation Tool template', async () => {
    const previous = { contentId: 'question-set', mainLibrary: 'H5P.QuestionSet', title: 'Previous quiz' } as H5PStudioContent;
    const compatible = { contentId: 'documentation', mainLibrary: 'H5P.DocumentationTool', title: 'Existing documentation' } as H5PStudioContent;
    sessionStorage.setItem(studioBriefKey('', undefined, previous.contentId), JSON.stringify({
      library: 'H5P.DocumentationTool 1.8', kind: 'single', instructions: 'Write response pages and export to Word.',
      templateContentId: previous.contentId, query: '', sourceMode: 'none'
    }));
    mocks.generate.mockResolvedValue({ data: { job: { status: 'running' } } });
    render(<StudioAIComposer contents={[previous, compatible]} currentContent={previous} onGenerated={onGenerated} onBusyChange={onBusyChange} />);
    expect(await screen.findByLabelText('Start from a saved activity (optional)')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      library: 'H5P.DocumentationTool 1.8', templateContentId: undefined
    })));
  });

  it('does not expose another author’s brief', async () => {
    sessionStorage.setItem(studioBriefKey('author-a'), JSON.stringify({ library: 'H5P.Chart 1.2', instructions: 'Private teaching notes', templateContentId: '', query: '' }));
    render(<StudioAIComposer ownerId="author-b" contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} />);
    expect(await screen.findByLabelText('Teaching instructions')).toHaveValue('');
  });

  it('ignores a stale saved course while course evidence is turned off', async () => {
    sessionStorage.setItem(studioBriefKey('', 'quiz-1'), JSON.stringify({ library: '', instructions: '', templateContentId: '', query: '', sourceMode: 'none', courseId: 'deleted-course', sourceQuizId: 'invalid-quiz' }));
    renderComposer();
    await screen.findByLabelText('Activity type');
    await waitFor(() => expect(mocks.folders).toHaveBeenCalled());
    expect(mocks.quizzes).not.toHaveBeenCalled();
    expect(mocks.objectives).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps an uncertain request recoverable and only retries the status lookup', async () => {
    sessionStorage.setItem('create-studio-generation-receipt', 'existing-request');
    mocks.status.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ data: { job: { status: 'succeeded' }, content: { contentId: 'recovered' } } });
    renderComposer();
    fireEvent.click(await screen.findByRole('button', { name: 'Check generation status' }, { timeout: 3000 }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith({ contentId: 'recovered' }), { timeout: 3000 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('reviews and edits the AI quantity plan before creating a collection', async () => {
    mocks.plan.mockResolvedValue({ data: { plan: [{ questionType: 'multiple-choice', title: 'Multiple Choice', count: 4 }] } });
    render(<MemoryRouter><StudioAIComposer contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Question collection/ }));
    fireEvent.click(screen.getByRole('button', { name: /Multiple Choice.*Questions & text activities/ }));
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Write four multiple-choice questions about cell organelles.' } });
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Propose types and quantities/ }));
    expect(await screen.findByText(/AI proposed 4 items/)).toBeInTheDocument();
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'collection', selectedQuestionTypes: ['multiple-choice'] }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      library: 'H5P.Column 1.20', questionPlan: [{ questionType: 'multiple-choice', count: 3 }]
    })));
  });

  it('lets instructors select several types and review a mixed plan', async () => {
    mocks.plan.mockResolvedValue({ data: { plan: [
      { questionType: 'multiple-choice', count: 2 }, { questionType: 'true-false', count: 1 }
    ] } });
    render(<MemoryRouter><StudioAIComposer contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Question collection/ }));
    fireEvent.click(screen.getByRole('button', { name: /Multiple Choice.*Questions & text activities/ }));
    fireEvent.click(screen.getByRole('button', { name: /True\/False.*Questions & text activities/ }));
    expect(screen.getByText('2 types selected. AI will propose the quantity for each.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Create three questions about the water cycle.' } });
    fireEvent.click(screen.getByRole('button', { name: /Propose types and quantities/ }));
    await screen.findByText(/AI proposed 3 items/);
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'collection', selectedQuestionTypes: ['multiple-choice', 'true-false'] }));
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ questionPlan: [
      { questionType: 'multiple-choice', count: 2 }, { questionType: 'true-false', count: 1 }
    ] })));
  });

  it('allows an AI-chosen type mix when no cards are selected', async () => {
    mocks.plan.mockResolvedValue({ data: { plan: [{ questionType: 'true-false', count: 3 }] } });
    render(<MemoryRouter><StudioAIComposer contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Question collection/ }));
    expect(screen.getByText('No types selected. AI will choose compatible types and quantities.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Create three questions about the water cycle.' } });
    fireEvent.click(screen.getByRole('button', { name: /Propose types and quantities/ }));
    await screen.findByText(/AI proposed 3 items/);
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'collection', selectedQuestionTypes: [] }));
  });

  it('restores old same-type drafts as a collection with that type selected', async () => {
    sessionStorage.setItem(studioBriefKey('', 'quiz-1'), JSON.stringify({
      library: '', templateContentId: '', query: '', instructions: 'Write four questions about cells.',
      kind: 'same-type', layout: 'column', questionType: 'multiple-choice', sourceMode: 'none'
    }));
    render(<MemoryRouter><StudioAIComposer contents={[]} quizId="quiz-1" onGenerated={onGenerated} onBusyChange={onBusyChange} /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /Question collection/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Multiple Choice.*Questions & text activities/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('Write four questions about cells.');
  });

  it('includes only selected course materials and multiple learning objectives in a one-question brief', async () => {
    mocks.folders.mockResolvedValue({ folders: [{ _id: 'course-1', name: 'Physics' }] });
    mocks.quizzes.mockResolvedValue({ quizzes: [{ _id: 'quiz-1', name: 'Forces' }] });
    mocks.materials.mockResolvedValue({ materials: [{ _id: 'material-1', name: 'Notes.pdf', processingStatus: 'completed' }] });
    mocks.objectives.mockResolvedValue({ objectives: [{ _id: 'lo-1', text: 'Explain net force' }, { _id: 'lo-2', text: 'Apply vector addition' }] });
    render(<MemoryRouter><StudioAIComposer contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.MultiChoice 1.16' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Combine vector addition with net force in one question.' } });
    fireEvent.click(screen.getByRole('button', { name: /Use a course/ }));
    fireEvent.change(screen.getByLabelText('Course'), { target: { value: 'course-1' } });
    await screen.findByText('Notes.pdf');
    fireEvent.click(screen.getByLabelText(/Notes\.pdf/));
    fireEvent.click(await screen.findByLabelText('Explain net force'));
    fireEvent.click(screen.getByLabelText('Apply vector addition'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      quizId: 'quiz-1', objectiveIds: ['lo-1', 'lo-2'], materialIds: ['material-1']
    })));
  });

  it('hands the selected course, material and teaching task to the linked question workflow', async () => {
    const onBuildCourseQuestions = vi.fn();
    mocks.folders.mockResolvedValue({ folders: [{ _id: 'course-1', name: 'Physics' }] });
    mocks.quizzes.mockResolvedValue({ quizzes: [{ _id: 'quiz-1', name: 'Forces' }] });
    mocks.materials.mockResolvedValue({ materials: [{ _id: 'material-1', name: 'Notes.pdf', processingStatus: 'completed' }] });
    render(<StudioAIComposer contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} onBuildCourseQuestions={onBuildCourseQuestions} />);
    fireEvent.change(await screen.findByLabelText('Teaching instructions'), { target: { value: 'Create four questions about forces.' } });
    fireEvent.click(screen.getByRole('button', { name: /Use a course/ }));
    fireEvent.change(screen.getByLabelText('Course'), { target: { value: 'course-1' } });
    await screen.findByText('Notes.pdf');
    fireEvent.click(screen.getByLabelText(/Notes\.pdf/));
    fireEvent.click(screen.getByRole('button', { name: /Build linked course questions/ }));
    expect(onBuildCourseQuestions).toHaveBeenCalledWith({ courseId: 'course-1', quizId: 'quiz-1', materialIds: ['material-1'], instructions: 'Create four questions about forces.' });
  });

  it('explains disabled actions and lets the prompt helper build, copy, and apply a brief through conversation', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    mocks.suggest.mockResolvedValueOnce({ data: { reply: 'I can see the selected Multiple Choice type, but no course evidence. What audience is this for?', nextStep: 'continue', draft: '' } })
      .mockResolvedValueOnce({ data: { reply: 'That gives me enough context.', nextStep: 'offer', draft: '' } })
      .mockResolvedValueOnce({ data: { reply: 'Here is a first-year version.', nextStep: 'draft', draft: 'Create one multiple-choice question about net force for first-year physics students with useful feedback.' } });
    render(<MemoryRouter><StudioAIComposer contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.MultiChoice 1.16' } });
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeDisabled();
    expect(screen.getByText(/Write at least 10 characters in Teaching instructions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prompt helper' }));
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Do you have knowledge or context about current work?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to prompt helper' }));
    expect(await screen.findByText(/I can see the selected Multiple Choice type/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Suggested prompt')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'First-year physics students should understand net force.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to prompt helper' }));
    await screen.findByText('That gives me enough context.');
    expect(screen.getByRole('button', { name: 'Yes, generate prompt' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Suggested prompt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('button', { name: 'Yes, generate prompt' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Please write the prompt now.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to prompt helper' }));
    await screen.findByText('Here is a first-year version.');
    expect(mocks.suggest).toHaveBeenLastCalledWith(expect.objectContaining({ generateNow: false,
      messages: expect.arrayContaining([{ role: 'user', content: 'Do you have knowledge or context about current work?' }, { role: 'user', content: 'Please write the prompt now.' }]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('Create one multiple-choice question about net force for first-year physics students with useful feedback.'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Use this prompt' }));
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('Create one multiple-choice question about net force for first-year physics students with useful feedback.');
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeEnabled();
  });

  it('accepts empty instructions with selected ready course evidence and keeps helper context in a collection', async () => {
    mocks.folders.mockResolvedValue({ folders: [{ _id: 'course-1', name: 'Physics' }] });
    mocks.quizzes.mockResolvedValue({ quizzes: [{ _id: 'quiz-1', name: 'Forces' }] });
    mocks.materials.mockResolvedValue({ materials: [{ _id: 'material-1', name: 'Notes.pdf', processingStatus: 'completed' }] });
    mocks.objectives.mockResolvedValue({ objectives: [{ _id: 'lo-1', text: 'Explain net force' }] });
    mocks.plan.mockResolvedValue({ data: { plan: [{ questionType: 'multiple-choice', count: 1 }] } });
    mocks.suggest.mockResolvedValue({ data: { reply: 'I can see your selected objective. What audience should I target?', nextStep: 'continue', draft: '' } });
    render(<MemoryRouter><StudioAIComposer contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Question collection/ }));
    fireEvent.click(screen.getByRole('button', { name: /Multiple Choice.*Questions & text activities/ }));
    fireEvent.click(screen.getByRole('button', { name: /Use a course/ }));
    fireEvent.change(screen.getByLabelText('Course'), { target: { value: 'course-1' } });
    fireEvent.click(await screen.findByLabelText('Explain net force'));
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Propose types and quantities/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Prompt helper' }));
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Help me check force concepts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to prompt helper' }));
    await screen.findByText('I can see your selected objective. What audience should I target?');
    expect(mocks.suggest).toHaveBeenCalledWith(expect.objectContaining({ kind: 'collection', quizId: 'quiz-1', objectiveIds: ['lo-1'], materialIds: [] }));
    expect(screen.queryByLabelText('Suggested prompt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close prompt helper' }));
    fireEvent.click(screen.getByRole('button', { name: /Propose types and quantities/ }));
    await screen.findByText(/AI proposed 1 items/);
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ quizId: 'quiz-1', objectiveIds: ['lo-1'], instructions: expect.stringContaining('selected course materials') }));
  });

  it('restores the prompt helper conversation and latest suggestion after leaving the form', async () => {
    mocks.suggest.mockResolvedValue({ data: { reply: 'Here is your prompt.', nextStep: 'draft', draft: 'Create a question about energy with concise feedback.' } });
    const first = renderComposer();
    await screen.findByLabelText('Activity type');
    fireEvent.click(screen.getByRole('button', { name: 'Prompt helper' }));
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Write a prompt about energy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to prompt helper' }));
    await screen.findByText('Here is your prompt.');
    first.unmount();
    renderComposer();
    fireEvent.click(await screen.findByRole('button', { name: 'Prompt helper' }));
    expect(screen.getByText('Write a prompt about energy')).toBeInTheDocument();
    expect(screen.getByLabelText('Suggested prompt')).toHaveValue('Create a question about energy with concise feedback.');
  });

  it('generates only after Yes and ignores drafts saved by the older auto-generate helper', async () => {
    sessionStorage.setItem(studioBriefKey('', 'quiz-1'), JSON.stringify({
      library: '', templateContentId: '', instructions: '', query: '', promptSuggestion: 'Old automatic prompt'
    }));
    mocks.suggest.mockResolvedValueOnce({ data: { reply: 'I can use those goals. Want a prompt?', nextStep: 'offer', draft: '' } })
      .mockResolvedValueOnce({ data: { reply: 'Here is the prompt.', nextStep: 'draft', draft: 'Create one question about evaporation for first-year learners.' } });
    renderComposer();
    await screen.findByLabelText('Activity type');
    fireEvent.click(screen.getByRole('button', { name: 'Prompt helper' }));
    expect(screen.queryByLabelText('Suggested prompt')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'I want to teach evaporation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to prompt helper' }));
    await screen.findByText('I can use those goals. Want a prompt?');
    expect(screen.queryByLabelText('Suggested prompt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, generate prompt' }));
    await screen.findByText('Here is the prompt.');
    expect(mocks.suggest).toHaveBeenLastCalledWith(expect.objectContaining({ generateNow: true,
      messages: [{ role: 'user', content: 'I want to teach evaporation.' }, { role: 'assistant', content: 'I can use those goals. Want a prompt?' }] }));
    expect(screen.getByLabelText('Suggested prompt')).toHaveValue('Create one question about evaporation for first-year learners.');
  });

  it('keeps the floating launcher off editor and preview pages while the composer remains mounted', async () => {
    const view = render(<StudioAIComposer active={false} contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} />);
    await screen.findByLabelText('Activity type');
    expect(screen.queryByRole('button', { name: 'Prompt helper' })).not.toBeInTheDocument();
    view.rerender(<StudioAIComposer active contents={[]} onGenerated={onGenerated} onBusyChange={onBusyChange} />);
    expect(screen.getByRole('button', { name: 'Prompt helper' })).toBeInTheDocument();
  });
});
