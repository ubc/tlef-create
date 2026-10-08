import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkflowStepper, { WorkflowStep, WorkflowTabs } from './WorkflowStepper';

const steps: WorkflowStep[] = [
  { id: 'materials', label: 'Materials', state: 'complete' },
  { id: 'objectives', label: 'Learning Objectives', state: 'available' },
  { id: 'preview', label: 'Preview & Export', state: 'blocked', disabled: true }
];

describe('WorkflowStepper', () => {
  it('renders in-page links, marks the current step, and reports selection', () => {
    const onStepSelect = vi.fn();
    render(
      <WorkflowStepper
        steps={steps}
        activeStepId="objectives"
        ariaLabel="Course setup steps"
        getHref={(stepId) => `#section-${stepId}`}
        onStepSelect={onStepSelect}
      />
    );

    expect(screen.getByRole('navigation', { name: 'Course setup steps' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Learning Objectives' })).toHaveAttribute('aria-current', 'step');

    const materials = screen.getByRole('link', { name: 'Materials (complete)' });
    expect(materials).toHaveAttribute('href', '#section-materials');
    fireEvent.click(materials);
    expect(onStepSelect).toHaveBeenCalledWith('materials');
  });
});

describe('WorkflowTabs', () => {
  const renderTabs = (onStepSelect = vi.fn()) => {
    render(
      <WorkflowTabs
        steps={steps}
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
