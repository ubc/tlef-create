import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudioAIComposer from './StudioAIComposer';

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), generate: vi.fn(), prepare: vi.fn() }));
vi.mock('../../services/api', () => ({ h5pEditorApi: { getActivityCatalog: mocks.catalog, generateActivity: mocks.generate, prepareTemplate: mocks.prepare } }));
const types = [
  { library: 'H5P.Chart 1.2', machineName: 'H5P.Chart', title: 'Chart', version: '1.2.22', category: 'Questions & text activities', mode: 'generate', guidance: 'Describe your data.' },
  { library: 'H5P.MemoryGame 1.3', machineName: 'H5P.MemoryGame', title: 'Memory Game', version: '1.3.29', category: 'Media activities', mode: 'template', guidance: 'Prepare real images first.' },
  { library: 'H5P.Dictation 1.4', machineName: 'H5P.Dictation', title: 'Dictation', version: '1.4.0', category: 'Media activities', mode: 'unavailable', guidance: 'Needs a newer runtime.' }
];
const onGenerated = vi.fn();
const onBusyChange = vi.fn();
const renderComposer = () => render(<StudioAIComposer contents={[]} quizId="quiz-1" onGenerated={onGenerated} onBusyChange={onBusyChange} />);

describe('Studio AI guided creation', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.catalog.mockResolvedValue({ data: { types } }); });

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

  it('passes the chosen type and explicit Quiz context, then opens the saved draft', async () => {
    mocks.generate.mockResolvedValue({ data: { content: { contentId: 'new-draft' } } });
    renderComposer();
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.Chart 1.2' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Chart oaks 12 and pines 8.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith({ contentId: 'new-draft' }));
    expect(mocks.generate).toHaveBeenCalledWith({ library: 'H5P.Chart 1.2', instructions: 'Chart oaks 12 and pines 8.', quizId: 'quiz-1', templateContentId: undefined });
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it('preserves the brief on failure so the teacher can retry', async () => {
    mocks.generate.mockRejectedValue(new Error('No content was saved. Please use a shorter brief.'));
    renderComposer();
    fireEvent.change(await screen.findByLabelText('Activity type'), { target: { value: 'H5P.Chart 1.2' } });
    fireEvent.change(screen.getByLabelText('Teaching instructions'), { target: { value: 'Chart oaks 12 and pines 8.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No content was saved');
    expect(screen.getByLabelText('Teaching instructions')).toHaveValue('Chart oaks 12 and pines 8.');
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeEnabled();
  });
});
