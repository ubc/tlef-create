import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StudioQuestionGenerationItem } from '../../../services/api';
import QuestionFailureSummary from './QuestionFailureSummary';

const evidenceFailure = (index: number): StudioQuestionGenerationItem => ({
  index, status: 'failed', attempts: 0,
  failure: { code: 'RAG_UNAVAILABLE', stage: 'evidence', message: 'Source evidence could not be retrieved. Question generation has not started.',
    recovery: 'Restore the source search service, then resume this saved plan.', retryable: true }
});

describe('QuestionFailureSummary', () => {
  it('groups a shared failure and explains the stage and recovery without claiming an answer was rejected', () => {
    render(<QuestionFailureSummary items={Array.from({ length: 15 }, (_, index) => evidenceFailure(index))} />);
    expect(screen.getByText('15 questions affected')).toBeVisible();
    expect(screen.getByText('Retrieve source evidence')).toBeVisible();
    expect(screen.getAllByText(/Question generation has not started/)).toHaveLength(1);
    expect(screen.getByText(/Restore the source search service/)).toBeVisible();
    expect(screen.getByText('Error code: RAG_UNAVAILABLE')).toBeVisible();
    expect(screen.queryByText(/rejected|older attempt/i)).not.toBeInTheDocument();
  });

  it('keeps distinct causes separate and omits ready questions', () => {
    render(<QuestionFailureSummary items={[evidenceFailure(0), { index: 1, status: 'ready' },
      { index: 2, status: 'failed', phase: 'generate_and_review', code: 'ANSWER_INVALID', message: 'The answer was ambiguous.' }]} />);
    expect(screen.getAllByText('1 question affected')).toHaveLength(2);
    expect(screen.getByText('The answer was ambiguous.')).toBeVisible();
    expect(screen.getByText('Generate and check the question')).toBeVisible();
  });

  it('admits when an older saved record has no detailed cause', () => {
    render(<QuestionFailureSummary items={[{ index: 0, status: 'failed' }]} />);
    expect(screen.getByText('Not recorded')).toBeVisible();
    expect(screen.getByText('No detailed failure reason was saved for this attempt.')).toBeVisible();
    expect(screen.queryByText(/Next step/)).not.toBeInTheDocument();
  });

  it('does not claim the whole task stopped while other questions are still running', () => {
    render(<QuestionFailureSummary working items={[evidenceFailure(0)]} />);
    expect(screen.getByRole('heading', { name: 'Why a question needs attention' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Why generation stopped' })).not.toBeInTheDocument();
    expect(screen.getByText('Retrieve source evidence')).toBeVisible();
    expect(screen.getByText('Error code: RAG_UNAVAILABLE')).toBeVisible();
    expect(screen.queryByText(/Restore the source search service/)).not.toBeInTheDocument();
    expect(screen.queryByText('Next step:')).not.toBeInTheDocument();
  });
});
