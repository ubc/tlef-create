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
});
