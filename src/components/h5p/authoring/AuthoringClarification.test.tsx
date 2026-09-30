import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuthoringClarification from './AuthoringClarification';

const questions = [{ question: 'How many questions?', options: ['One', 'Five'] },
  { question: 'What should improve?', options: ['Feedback', 'Scenario'] }];
describe('selectable clarification replies', () => {
  it('composes only explicitly selected answers without submitting them', () => {
    const useAnswers = vi.fn();
    render(<AuthoringClarification messageId="message1" questions={questions} disabled={false} onUseAnswers={useAnswers} />);
    expect(screen.getByRole('button', { name: 'Use selected answers' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Five' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Scenario' }));
    expect(useAnswers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use selected answers' }));
    expect(useAnswers).toHaveBeenCalledWith(expect.stringContaining('How many questions? Five'));
    expect(useAnswers).toHaveBeenCalledWith(expect.stringContaining('What should improve? Scenario'));
    expect(useAnswers.mock.calls[0][0]).not.toContain('Feedback');
  });
  it('lets a teacher change their selection before composing the reply', () => {
    const useAnswers = vi.fn();
    render(<AuthoringClarification messageId="message1" questions={questions} disabled={false} onUseAnswers={useAnswers} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Five' }));
    fireEvent.click(screen.getByRole('radio', { name: 'One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use selected answers' }));
    expect(useAnswers.mock.calls[0][0]).toContain('How many questions? One');
    expect(useAnswers.mock.calls[0][0]).not.toContain('Five');
  });
  it('keeps superseded choices visible and unavailable', () => {
    render(<AuthoringClarification messageId="old" questions={questions} disabled onUseAnswers={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'One' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Use selected answers' })).not.toBeInTheDocument();
  });
});
