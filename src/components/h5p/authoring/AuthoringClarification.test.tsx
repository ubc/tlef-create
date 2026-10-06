import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AuthoringClarification from './AuthoringClarification';

const questions = [{ question: 'How many questions?', options: ['One', 'Five'] },
  { question: 'What should improve?', options: ['Feedback', 'Scenario'] }];
describe('selectable clarification replies', () => {
  it('requires each answer and confirms only the selected answers after the button is pressed', () => {
    const useAnswers = vi.fn();
    render(<AuthoringClarification messageId="message1" questions={questions} disabled={false} onConfirmAnswers={useAnswers} />);
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Five' }));
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Scenario' }));
    expect(useAnswers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(useAnswers).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('How many questions? Five'));
    expect(useAnswers).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('What should improve? Scenario'));
    expect(useAnswers.mock.calls[0][1]).not.toContain('Feedback');
  });
  it('lets a teacher change their selection before composing the reply', () => {
    const useAnswers = vi.fn();
    render(<AuthoringClarification messageId="message1" questions={questions} disabled={false} onConfirmAnswers={useAnswers} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Five' }));
    fireEvent.click(screen.getByRole('radio', { name: 'One' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Scenario' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(useAnswers.mock.calls[0][1]).toContain('How many questions? One');
    expect(useAnswers.mock.calls[0][1]).not.toContain('Five');
  });
  it('keeps superseded choices visible and unavailable', () => {
    render(<AuthoringClarification messageId="old" questions={questions} disabled onConfirmAnswers={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'One' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Confirm and continue' })).not.toBeInTheDocument();
  });

  it.each(['Which topics should we cover?', '希望覆盖哪些主题？'])('allows several legacy topic choices and a custom topic: %s', async question => {
    const useAnswers = vi.fn();
    const user = userEvent.setup();
    render(<AuthoringClarification messageId="topics" questions={[{ question, options: ['Motion', 'Forces', 'Energy'] }]}
      disabled={false} onConfirmAnswers={useAnswers} />);
    await user.click(screen.getByRole('checkbox', { name: 'Energy' }));
    await user.click(screen.getByRole('checkbox', { name: 'Motion' }));
    await user.click(screen.getByRole('checkbox', { name: 'Write my own answer' }));
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: `Your answer: ${question}` }), '  Circular motion  ');
    expect(useAnswers).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(useAnswers).toHaveBeenCalledTimes(1);
    expect(useAnswers.mock.calls[0][0]).toEqual({ messageId: 'topics', answers: [{ questionIndex: 0, selectedOptions: ['Motion', 'Energy'], customAnswer: 'Circular motion' }] });
    expect(useAnswers).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining(`${question} Motion; Energy; Circular motion`));
    expect(useAnswers.mock.calls[0][1]).not.toContain('Forces');
  });

  it('removes unchecked topics and does not require a custom answer after it is unselected', async () => {
    const user = userEvent.setup(); const useAnswers = vi.fn();
    render(<AuthoringClarification messageId="topic-choice" questions={[{ question: 'Teaching focus?', options: ['Motion', 'Energy'], selectionMode: 'multiple' }]}
      disabled={false} onConfirmAnswers={useAnswers} />);
    await user.click(screen.getByRole('checkbox', { name: 'Motion' }));
    await user.click(screen.getByRole('checkbox', { name: 'Energy' }));
    await user.click(screen.getByRole('checkbox', { name: 'Motion' }));
    await user.click(screen.getByRole('checkbox', { name: 'Write my own answer' }));
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Write my own answer' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(useAnswers).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('Teaching focus? Energy'));
    expect(useAnswers.mock.calls[0][1]).not.toContain('Motion');
  });

  it('honors an explicit single topic decision and makes its custom answer mutually exclusive', async () => {
    const user = userEvent.setup(); const useAnswers = vi.fn();
    render(<AuthoringClarification messageId="conflict" questions={[{ question: 'Which topic resolves the conflict?',
      options: ['Only motion', 'Only energy'], selectionMode: 'single', allowCustomInput: true }]}
      disabled={false} onConfirmAnswers={useAnswers} />);
    const motion = screen.getByRole('radio', { name: 'Only motion' });
    const energy = screen.getByRole('radio', { name: 'Only energy' });
    const custom = screen.getByRole('radio', { name: 'Write my own answer' });
    await user.click(motion); await user.click(energy);
    expect(motion).not.toBeChecked(); expect(energy).toBeChecked();
    await user.click(custom);
    expect(energy).not.toBeChecked(); expect(custom).toBeChecked();
    await user.type(screen.getByRole('textbox'), 'Discuss the tradeoff first');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(useAnswers).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('Discuss the tradeoff first'));
    expect(useAnswers.mock.calls[0][1]).not.toContain('Only energy');
    await user.click(motion);
    expect(custom).not.toBeChecked(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('supports a custom answer without selecting a predefined option', async () => {
    const user = userEvent.setup(); const useAnswers = vi.fn();
    render(<AuthoringClarification messageId="custom" questions={[questions[0]]} disabled={false} onConfirmAnswers={useAnswers} />);
    await user.click(screen.getByRole('radio', { name: 'Write my own answer' }));
    await user.type(screen.getByRole('textbox'), 'Seven questions');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(useAnswers).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('How many questions? Seven questions'));
  });

  it('limits listed answers to four while allowing a custom fifth answer and retaining selections for correction', async () => {
    const useAnswers = vi.fn();
    const options = ['Motion', 'Energy', 'Momentum', 'Forces', 'Waves'];
    render(<AuthoringClarification messageId="many-topics" questions={[{ question: 'Which topics?', options, selectionMode: 'multiple' }]}
      disabled={false} onConfirmAnswers={useAnswers} />);
    for (const option of options) fireEvent.click(screen.getByRole('checkbox', { name: option }));
    const confirm = screen.getByRole('button', { name: 'Confirm and continue' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write my own answer' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Thermodynamics' } });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('Select up to four listed answers; you can also write your own answer.')).toBeVisible();
    fireEvent.click(confirm); expect(useAnswers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Waves' }));
    expect(screen.getByRole('textbox')).toHaveValue('Thermodynamics');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(useAnswers).toHaveBeenCalledWith({ messageId: 'many-topics', answers: [{ questionIndex: 0,
      selectedOptions: ['Motion', 'Energy', 'Momentum', 'Forces'], customAnswer: 'Thermodynamics' }] }, expect.any(String));
  });

  it.each([
    { question: 'How many questions for this topic?', options: ['One', 'Five'] },
    { question: 'Which topics should we cover?', options: ['All topics', 'Only motion'] },
    { question: '该主题的题数是多少？', options: ['一题', '五题'] }
  ])('keeps historical quantity and exclusive scope alternatives single: $question', question => {
    render(<AuthoringClarification messageId="exclusive" questions={[question]} disabled={false} onConfirmAnswers={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    for (const option of question.options) expect(screen.getByRole('radio', { name: option })).toBeInTheDocument();
  });

  it('preserves in-progress choices across snapshot refreshes and resets them for a new message', async () => {
    const user = userEvent.setup(); const useAnswers = vi.fn();
    const { rerender } = render(<AuthoringClarification messageId="first" questions={[questions[0]]} disabled={false} onConfirmAnswers={useAnswers} />);
    await user.click(screen.getByRole('radio', { name: 'Five' }));
    rerender(<AuthoringClarification messageId="first" questions={[{ ...questions[0] }]} disabled={false} onConfirmAnswers={useAnswers} />);
    expect(screen.getByRole('radio', { name: 'Five' })).toBeChecked();
    rerender(<AuthoringClarification messageId="next" questions={[questions[0]]} disabled={false} onConfirmAnswers={useAnswers} />);
    expect(screen.getByRole('radio', { name: 'Five' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeDisabled();
  });

  it('disables all current choices and custom text while work runs, and can omit custom input for strict decisions', async () => {
    const user = userEvent.setup(); const useAnswers = vi.fn();
    const choices = [{ question: 'Which topics?', options: ['Motion', 'Energy'], selectionMode: 'multiple' as const },
      { ...questions[0], allowCustomInput: false }];
    const { rerender } = render(<AuthoringClarification messageId="working" questions={choices} disabled={false} onConfirmAnswers={useAnswers} />);
    const topic = screen.getByRole('group', { name: 'Which topics?' });
    expect(within(screen.getByRole('group', { name: 'How many questions?' })).queryByRole('radio', { name: 'Write my own answer' })).not.toBeInTheDocument();
    await user.click(within(topic).getByRole('checkbox', { name: 'Write my own answer' }));
    await user.type(screen.getByRole('textbox'), 'Momentum');
    rerender(<AuthoringClarification messageId="working" questions={choices} disabled onConfirmAnswers={useAnswers} />);
    for (const choice of screen.getAllByRole('checkbox')) expect(choice).toBeDisabled();
    for (const choice of screen.getAllByRole('radio')) expect(choice).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Confirm and continue' })).not.toBeInTheDocument();
    expect(useAnswers).not.toHaveBeenCalled();
  });
});
