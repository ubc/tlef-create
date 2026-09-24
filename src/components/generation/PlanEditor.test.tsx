import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlanEditor from './PlanEditor';

describe('PlanEditor list keys', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders objective options without React key warnings while data is reconciling', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <PlanEditor
        planItems={[{
          id: 'plan-row-1',
          type: 'multiple-choice',
          learningObjectiveId: 'objective-1',
          count: 1,
          difficulty: 'moderate'
        }]}
        learningObjectives={[
          { _id: 'objective-1', text: 'First objective payload', order: 0 },
          { _id: 'objective-1', text: 'Reconciled objective payload', order: 0 }
        ]}
        onPlanItemsChange={vi.fn()}
        targetFormat="column"
      />
    );

    const keyWarnings = consoleError.mock.calls.filter(call =>
      String(call[0]).includes('Each child in a list should have a unique "key" prop')
    );
    expect(keyWarnings).toHaveLength(0);
  });

  it('gives documentation prompts an expanded editor and labels count controls', () => {
    const { container } = render(
      <PlanEditor
        planItems={[{
          id: 'documentation-row',
          type: 'documentation-tool',
          learningObjectiveId: 'objective-1',
          count: 1,
          difficulty: 'moderate',
          customPrompt: 'Document a lab reflection.'
        }]}
        learningObjectives={[{ _id: 'objective-1', text: 'Reflect on lab evidence', order: 0 }]}
        onPlanItemsChange={vi.fn()}
        targetFormat="standalone"
      />
    );

    expect(container.querySelector('.plan-custom-prompt-documentation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Describe the documentation tool topic and purpose/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase count' })).toHaveAttribute('title', 'Increase count');
  });
  it('labels remaining objectives by the current list position after deletions', () => {
    render(<PlanEditor
      planItems={[{ id: 'row', type: 'multiple-choice', learningObjectiveId: 'lo-b', count: 1 }]}
      learningObjectives={[
        { _id: 'lo-b', text: 'Condensation', order: 1 },
        { _id: 'lo-c', text: 'Evaporation', order: 2 }
      ]}
      onPlanItemsChange={vi.fn()} targetFormat="column" />);
    expect(screen.getByRole('option', { name: 'LO 1: Condensation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'LO 2: Evaporation' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /LO 3/ })).not.toBeInTheDocument();
  });

  it('lets one Branching Scenario cover additional objectives without adding another activity', () => {
    const onPlanItemsChange = vi.fn();
    render(<PlanEditor
      planItems={[{ id: 'branch', type: 'branching-scenario', learningObjectiveId: 'lo-a', count: 1 }]}
      learningObjectives={[
        { _id: 'lo-a', text: 'Agree on AI use', order: 0 },
        { _id: 'lo-b', text: 'Address integrity concerns', order: 1 }
      ]}
      onPlanItemsChange={onPlanItemsChange} targetFormat="standalone" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'LO 2: Address integrity concerns' }));
    expect(onPlanItemsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'branch', count: 1, supportingLearningObjectiveIds: ['lo-b'] })
    ]);
  });

});
