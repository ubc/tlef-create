import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ManualQuestionForm from './ManualQuestionForm';
import { GenerationOutcomeUnconfirmedError } from '../../utils/questionGenerationOutcome';

vi.mock('../../services/api', () => ({ questionsApi: {} }));

describe('AI addition outcome messages', () => {
  it.each([
    [new GenerationOutcomeUnconfirmedError(), 'warning', 'Generation Result Unconfirmed'],
    [new Error('Feedback review rejected the draft.'), 'error', 'Generation Failed']
  ])('distinguishes %s and retains the instructions', async (error, tone, title) => {
    const notify = vi.fn();
    const close = vi.fn();
    const generate = vi.fn().mockRejectedValue(error);
    render(<ManualQuestionForm isOpen onClose={close} quizId="quiz1" learningObjectives={[]}
      availableQuestionTypes={[{ value: 'multiple-choice', label: 'Multiple Choice' }]}
      onQuestionAdded={vi.fn()} onGenerateAI={generate} showNotification={notify} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Generate' }));
    const instructions = screen.getByPlaceholderText('Describe what you want the question to be about... (required)');
    fireEvent.change(instructions, { target: { value: 'Create a water cycle question.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Question' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(tone, title, error.message));
    expect(instructions).toHaveValue('Create a water cycle question.');
    expect(close).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledOnce();
  });
});
