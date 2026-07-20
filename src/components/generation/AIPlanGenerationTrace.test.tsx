import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AIPlanGenerationTrace from './AIPlanGenerationTrace';
import {
  buildPublicWorkflowLog,
  formatPublicTraceMetadata,
} from './generationTraceLog';

describe('AIPlanGenerationTrace', () => {
  it('shows useful preparation events before the model starts streaming', () => {
    const { container } = render(
      <AIPlanGenerationTrace
        isGenerating
        steps={[
          {
            status: 'inventory-complete',
            message: 'Source inventory ready.',
            metadata: {
              sections: 12,
              majorSections: 4,
              chunks: 38,
              privatePrompt: 'do not expose this',
            },
          },
          {
            status: 'profile-started',
            message: 'Grouping source sections into instructional clusters...',
          },
        ]}
        streamedText=""
        eyebrow="AI Learning Objectives"
      />
    );

    expect(screen.getByText('Live generation log')).toBeInTheDocument();

    const output = container.querySelector('.plan-trace-output');
    expect(output).toHaveTextContent('[DONE] Source inventory ready.');
    expect(output).toHaveTextContent('12 source sections · 4 major sections · 38 content chunks');
    expect(output).toHaveTextContent('[NOW] Grouping source sections into instructional clusters...');
    expect(output).toHaveTextContent('Combining related source sections into teachable topic and skill clusters.');
    expect(output).not.toHaveTextContent('do not expose this');
  });

  it('keeps the public workflow log visible when live model output arrives', () => {
    const { container } = render(
      <AIPlanGenerationTrace
        isGenerating
        steps={[{
          status: 'draft-started',
          message: 'Calling test-model to draft the learning objectives...',
        }]}
        streamedText={'{"learningObjectives": ['}
        model="test-model"
      />
    );

    const output = container.querySelector('.plan-trace-output');
    expect(output).toHaveTextContent('[NOW] Calling test-model to draft the learning objectives...');
    expect(output).toHaveTextContent('LIVE MODEL DRAFT');
    expect(output).toHaveTextContent('{"learningObjectives": [');
  });

  it('shows the model draft area as soon as the model call starts', () => {
    const { container } = render(
      <AIPlanGenerationTrace
        isGenerating
        steps={[{
          status: 'draft-started',
          message: 'Calling test-model to draft the learning objectives...',
        }]}
        streamedText=""
      />
    );

    const output = container.querySelector('.plan-trace-output');
    expect(output).toHaveTextContent('LIVE MODEL DRAFT');
    expect(output).toHaveTextContent('Waiting for the first model token...');
  });

  it('hides and restores the combined log without losing its events', () => {
    const { container } = render(
      <AIPlanGenerationTrace
        isGenerating
        steps={[{ status: 'started', message: 'Preparing generation...' }]}
        streamedText=""
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide log' }));
    expect(container.querySelector('.plan-trace-output')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show log' }));
    expect(container.querySelector('.plan-trace-output')).toHaveTextContent('Preparing generation...');
  });
});

describe('public generation log formatting', () => {
  it('renders only allowlisted aggregate metadata', () => {
    expect(formatPublicTraceMetadata({
      coveredSections: 7,
      requiredSections: 8,
      repairApplied: true,
      apiKey: 'secret-key',
      sourceText: 'private course content',
    })).toBe('7/8 required sections covered · coverage repair applied');
  });

  it('shows a useful waiting state when no SSE event has arrived', () => {
    expect(buildPublicWorkflowLog([], true, 'Preparing source inventory...'))
      .toBe('[WAIT] Preparing source inventory...');
  });

  it('explains the bounded output-budget retry without exposing request internals', () => {
    const log = buildPublicWorkflowLog([{
      status: 'draft-retry',
      message: 'The model used its output budget. Retrying once...',
    }], true, 'Preparing source inventory...');

    expect(log).toContain('retrying once with a larger output budget');
    expect(log).not.toContain('24000');
  });
});
