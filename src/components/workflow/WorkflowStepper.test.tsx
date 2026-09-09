import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkflowStepper, { WorkflowStep } from './WorkflowStepper';

const steps: WorkflowStep[] = [
  { id: 'materials', label: 'Materials', detail: 'Ready · 2 assigned', state: 'complete' },
  { id: 'objectives', label: 'Learning Objectives', detail: 'Current', state: 'available' },
  { id: 'preview', label: 'Preview & Export', detail: 'Waiting for questions', state: 'blocked', disabled: true }
];

describe('WorkflowStepper', () => {
  it('announces the current step, supports navigation, and disables blocked steps', () => {
    const onStepSelect = vi.fn();
    render(
      <WorkflowStepper
        steps={steps}
        activeStepId="objectives"
        ariaLabel="Learning Object creation steps"
        onStepSelect={onStepSelect}
      />
    );

    const currentStep = screen.getByRole('button', { name: /Learning Objectives/ });
    expect(currentStep).toHaveAttribute('aria-current', 'step');

    fireEvent.click(screen.getByRole('button', { name: /Materials/ }));
    expect(onStepSelect).toHaveBeenCalledWith('materials');

    expect(screen.getByRole('button', { name: /Preview & Export/ })).toBeDisabled();
  });
});
