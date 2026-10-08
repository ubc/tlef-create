import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, Check, LockKeyhole } from 'lucide-react';
import '../../styles/components/WorkflowStepper.css';

export type WorkflowStepState = 'complete' | 'current' | 'available' | 'blocked' | 'attention';

export interface WorkflowStep {
  id: string;
  label: string;
  detail: string;
  state: WorkflowStepState;
  disabled?: boolean;
}

interface WorkflowStepperProps {
  steps: WorkflowStep[];
  activeStepId: string;
  ariaLabel: string;
  onStepSelect?: (stepId: string) => void;
  compact?: boolean;
}

const STEP_STATUS_TEXT: Partial<Record<WorkflowStepState, string>> = {
  complete: 'complete',
  blocked: 'locked',
  attention: 'needs attention'
};

type WorkflowTab = Omit<WorkflowStep, 'detail'>;

const StepIcon = ({ step, index, isActive }: { step: WorkflowTab; index: number; isActive: boolean }) => (
  <span className="workflow-step-number" aria-hidden="true">
    {step.state === 'complete' && !isActive ? (
      <Check size={15} strokeWidth={3} />
    ) : step.state === 'blocked' && !isActive ? (
      <LockKeyhole size={13} strokeWidth={2.4} />
    ) : step.state === 'attention' && !isActive ? (
      <AlertCircle size={15} strokeWidth={2.4} />
    ) : (
      index + 1
    )}
  </span>
);

interface WorkflowTabsProps {
  steps: WorkflowTab[];
  /** Selected tab; pass null when the visible panel isn't owned by any tab. */
  selectedStepId: string | null;
  ariaLabel: string;
  getTabId: (stepId: string) => string;
  getPanelId: (stepId: string) => string;
  onStepSelect: (stepId: string) => void;
}

/**
 * WAI-ARIA Tabs pattern with manual activation: arrow keys / Home / End move
 * focus, Enter or Space opens the tab. Locked tabs stay focusable (aria-disabled)
 * so keyboard and screen reader users can still discover them.
 */
export const WorkflowTabs = ({
  steps,
  selectedStepId,
  ariaLabel,
  getTabId,
  getPanelId,
  onStepSelect
}: WorkflowTabsProps) => {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = steps.findIndex(step => step.id === selectedStepId);
  const [focusIndex, setFocusIndex] = useState(Math.max(selectedIndex, 0));

  useEffect(() => {
    if (selectedIndex >= 0) setFocusIndex(selectedIndex);
  }, [selectedIndex]);

  const rovingIndex = Math.min(focusIndex, steps.length - 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % steps.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + steps.length) % steps.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = steps.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    setFocusIndex(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      className="workflow-stepper workflow-stepper-compact workflow-tabs"
      role="tablist"
      aria-label={ariaLabel}
    >
      {steps.map((step, index) => {
        const isSelected = index === selectedIndex;
        const isDisabled = Boolean(step.disabled);
        const statusText = STEP_STATUS_TEXT[step.state];

        return (
          <button
            key={step.id}
            ref={element => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={getTabId(step.id)}
            className="workflow-step-button"
            data-state={isSelected ? 'current' : step.state}
            aria-selected={isSelected}
            aria-controls={getPanelId(step.id)}
            aria-disabled={isDisabled || undefined}
            tabIndex={index === rovingIndex ? 0 : -1}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={event => handleKeyDown(event, index)}
            onClick={() => {
              if (!isDisabled) onStepSelect(step.id);
            }}
          >
            <StepIcon step={step} index={index} isActive={isSelected} />
            <span className="workflow-step-copy">
              <strong>{step.label}</strong>
              {statusText && <span className="workflow-tab-status"> ({statusText})</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const WorkflowStepper = ({
  steps,
  activeStepId,
  ariaLabel,
  onStepSelect,
  compact = false
}: WorkflowStepperProps) => (
  <nav
    className={`workflow-stepper ${compact ? 'workflow-stepper-compact' : ''}`}
    aria-label={ariaLabel}
  >
    <ol>
      {steps.map((step, index) => {
        const isActive = step.id === activeStepId;
        const isDisabled = Boolean(step.disabled);
        const state = isActive ? 'current' : step.state;

        return (
          <li key={step.id}>
            <button
              type="button"
              className="workflow-step-button"
              data-state={state}
              aria-current={isActive ? 'step' : undefined}
              aria-disabled={isDisabled}
              title={`Step ${index + 1}: ${step.label} — ${step.detail}`}
              disabled={isDisabled}
              onClick={() => onStepSelect?.(step.id)}
            >
              <StepIcon step={step} index={index} isActive={isActive} />
              <span className="workflow-step-copy">
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  </nav>
);

export default WorkflowStepper;
