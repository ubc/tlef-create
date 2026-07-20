import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CoursePromptSettings from './CoursePromptSettings';

const mocks = vi.hoisted(() => ({
  getPrompt: vi.fn(),
  getHistory: vi.fn(),
  getLibrary: vi.fn(),
  validatePrompt: vi.fn(),
  savePrompt: vi.fn(),
  resetPrompt: vi.fn(),
  applyPrompt: vi.fn()
}));

vi.mock('../services/api', () => ({
  coursePromptsApi: mocks
}));

const originalPrompt = 'Use clear language and keep each question focused on one assessable concept.';
const revisedPrompt = 'Use concise, clear language and keep each question focused on one assessable concept from the approved Blueprint row.';

describe('CoursePromptSettings validation fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrompt.mockResolvedValue({
      prompt: {
        promptType: 'question-generation',
        approach: 'support',
        source: 'system',
        innerPrompt: originalPrompt,
        editablePrompt: originalPrompt,
        lockedPrompt: 'Follow the approved Blueprint row and retrieved evidence.',
        lockedGuardrails: ['The output schema is injected at runtime.'],
        hasDynamicRuntimeContext: true,
        outerPrompt: '',
        systemDefault: originalPrompt,
        systemDefaultEditablePrompt: originalPrompt
      }
    });
    mocks.getHistory.mockResolvedValue({ history: [] });
    mocks.getLibrary.mockResolvedValue({ library: [] });
  });

  it('applies an AI revision to the draft without saving it', async () => {
    mocks.validatePrompt.mockResolvedValue({
      validation: {
        status: 'warning',
        errors: [],
        warnings: ['The preferred wording is ambiguous.'],
        suggestions: ['Request concise wording.'],
        suggestedPrompt: revisedPrompt,
        changeSummary: ['Clarified the wording while preserving the Blueprint constraint.'],
        aiReview: { attempted: true, available: true, model: 'test-model' }
      }
    });

    render(<CoursePromptSettings courseId="course-1" defaultPromptType="question-generation" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Prompts' }));
    const editor = await screen.findByLabelText('Editable course prompt instructions');

    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply Changes' }));

    expect(editor).toHaveValue(revisedPrompt);
    expect(mocks.savePrompt).not.toHaveBeenCalled();
    expect(screen.getByText(/applied to the draft/i)).toBeInTheDocument();
    expect(screen.queryByText('Validation: warning')).not.toBeInTheDocument();
  });

  it('shows an unchanged system default as valid without an Apply Changes action', async () => {
    mocks.validatePrompt.mockResolvedValue({
      validation: {
        status: 'valid',
        errors: [],
        warnings: [],
        suggestions: [],
        isSystemDefault: true,
        aiReview: { attempted: false, available: false }
      }
    });

    render(<CoursePromptSettings courseId="course-1" defaultPromptType="question-generation" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Prompts' }));
    await screen.findByLabelText('Editable course prompt instructions');
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));

    await waitFor(() => expect(screen.getByText('Validation: valid')).toBeInTheDocument());
    expect(screen.getByText(/unchanged CREATE system default/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).not.toBeInTheDocument();
  });
});
