import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import H5PStudioDraftDialog from './H5PStudioDraftDialog';

const draft = {
  id: 'record-1',
  contentId: 'content-1',
  title: 'Week 1 activity',
  mainLibrary: 'H5P.Column',
  source: 'generated' as const,
  status: 'draft' as const,
  quizId: 'quiz-1',
  sourceQuizUpdatedAt: '2026-08-06T12:00:00.000Z',
  lastEditedAt: '2026-08-06T13:00:00.000Z',
  createdAt: '2026-08-06T12:00:00.000Z',
  updatedAt: '2026-08-06T13:00:00.000Z'
};

describe('H5PStudioDraftDialog', () => {
  it('explains an outdated draft and exposes three distinct actions', () => {
    const onOpenExisting = vi.fn();
    const onCreateFresh = vi.fn();
    const onCancel = vi.fn();
    render(
      <H5PStudioDraftDialog
        draft={draft}
        sourceOutdated
        loading={false}
        onOpenExisting={onOpenExisting}
        onCreateFresh={onCreateFresh}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Draft may be out of date')).toBeInTheDocument();
    expect(screen.getByText(/keeps this draft unchanged/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open existing draft/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create fresh draft/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenExisting).toHaveBeenCalledTimes(1);
    expect(onCreateFresh).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('reports when the saved source revision is current', () => {
    render(
      <H5PStudioDraftDialog
        draft={draft}
        sourceOutdated={false}
        loading={false}
        onOpenExisting={vi.fn()}
        onCreateFresh={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('No newer CREATE changes detected')).toBeInTheDocument();
  });

  it('makes the in-progress fresh-draft state explicit and disables every action', () => {
    render(
      <H5PStudioDraftDialog
        draft={draft}
        sourceOutdated={false}
        loading
        onOpenExisting={vi.fn()}
        onCreateFresh={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/cannot be cancelled after it starts/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Creating/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Open existing draft/i })).toBeDisabled();
  });
});
