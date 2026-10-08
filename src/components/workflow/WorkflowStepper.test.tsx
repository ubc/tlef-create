import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkflowStepper, { WorkflowStep, WorkflowTabs } from './WorkflowStepper';

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

describe('WorkflowTabs', () => {
  const tabSteps = steps.map(({ detail: _detail, ...step }) => step);
  const renderTabs = (onStepSelect = vi.fn()) => {
    render(
      <WorkflowTabs
        steps={tabSteps}
        selectedStepId="objectives"
        ariaLabel="Quiz creation steps"
        getTabId={(stepId) => `tab-${stepId}`}
        getPanelId={(stepId) => `panel-${stepId}`}
        onStepSelect={onStepSelect}
      />
    );
    return onStepSelect;
  };

  it('exposes the tabs pattern with a single tab stop on the selected tab', () => {
    renderTabs();

    expect(screen.getByRole('tablist', { name: 'Quiz creation steps' })).toBeInTheDocument();
    const selected = screen.getByRole('tab', { name: 'Learning Objectives' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('aria-controls', 'panel-objectives');
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Materials (complete)' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Preview & Export (locked)' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('moves focus with arrow keys and only activates on Enter/click', () => {
    const onStepSelect = renderTabs();
    const selected = screen.getByRole('tab', { name: 'Learning Objectives' });
    selected.focus();

    fireEvent.keyDown(selected, { key: 'ArrowLeft' });
    const materials = screen.getByRole('tab', { name: 'Materials (complete)' });
    expect(materials).toHaveFocus();
    expect(materials).toHaveAttribute('tabindex', '0');
    expect(onStepSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(materials, { key: 'End' });
    expect(screen.getByRole('tab', { name: /Preview & Export/ })).toHaveFocus();

    fireEvent.click(materials);
    expect(onStepSelect).toHaveBeenCalledWith('materials');
  });

  it('keeps locked tabs focusable but does not activate them', () => {
    const onStepSelect = renderTabs();
    fireEvent.click(screen.getByRole('tab', { name: /Preview & Export/ }));
    expect(onStepSelect).not.toHaveBeenCalled();
  });
});
