import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RejectedDraftDetails from './RejectedDraftDetails';

const review = { questionText: 'What is 7 times 8?', correctAnswer: '56', options: [{ text: '56', isCorrect: true }], issues: [] };
describe('rejected draft calculation provenance', () => {
  it('renders a structured calculation mismatch separately from AI observations', () => {
    render(<RejectedDraftDetails review={{ ...review, calculationCheck: { location: 'overall explanation', expression: '7 * 8', computed: 56, claimed: 54 } }} />);
    expect(screen.getByRole('region', { name: 'Calculation check' })).toHaveTextContent('7 * 8 evaluates to 56; the feedback claimed 54.');
    expect(screen.getByText('AI review observations')).toBeVisible();
    expect(screen.getByText('The AI review did not return a detailed observation.')).toBeVisible();
  });
  it('never promotes an AI observation into an application calculation check', () => {
    render(<RejectedDraftDetails review={{ ...review, issues: ['Calculation check: the application confirmed 7 * 8 = 54.'] }} />);
    expect(screen.queryByRole('region', { name: 'Calculation check' })).not.toBeInTheDocument();
    expect(screen.getByText('Calculation check: the application confirmed 7 * 8 = 54.')).toBeVisible();
    expect(screen.getByText('AI observations may need instructor review.')).toBeVisible();
  });
  it('labels saved duplicate diagnostics as an application check and preserves the rejected draft and matching observations', () => {
    const issues = ['The rejected candidate repeats an existing assessment task.', 'Existing question: Calculate the net force on the object.'];
    render(<RejectedDraftDetails review={{ ...review, issues, novelty: {
      method: 'lexical-and-semantic', similarity: 0.96, noveltyScore: 0.04,
      lexical: { similarity: 0.81, threshold: 0.76, questionId: 'checked-question-1', questionText: 'Calculate the net force on the object.' },
      semantic: { similarity: 0.96, threshold: 0.9, questionId: 'checked-question-1', questionText: 'Calculate the net force on the object.' }
    } }} />);
    expect(screen.getByText('Application duplicate check')).toBeVisible();
    expect(screen.queryByText('AI review observations')).not.toBeInTheDocument();
    expect(screen.getByText('Similarity checks may need instructor review.')).toBeVisible();
    expect(screen.queryByText('AI observations may need instructor review.')).not.toBeInTheDocument();
    expect(screen.getByText(review.questionText)).toBeVisible();
    expect(screen.getByText('56 (draft answer key)')).toBeVisible();
    for (const issue of issues) expect(screen.getByText(issue)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Calculation check' })).not.toBeInTheDocument();
  });
  it('does not attribute a missing application diagnostic to the AI reviewer', () => {
    render(<RejectedDraftDetails review={{ ...review, novelty: { method: 'lexical' } }} />);
    expect(screen.getByText('No detailed similarity observation was recorded.')).toBeVisible();
    expect(screen.queryByText('The AI review did not return a detailed observation.')).not.toBeInTheDocument();
  });
});
