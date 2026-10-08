import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, Check, LockKeyhole } from 'lucide-react';
import '../../styles/components/WorkflowStepper.css';

export type WorkflowStepState = 'complete' | 'current' | 'available' | 'blocked' | 'attention';

export interface WorkflowStep {
  id: string;
  label: string;
  state: WorkflowStepState;
  disabled?: boolean;
}

interface WorkflowStepperProps {
  steps: WorkflowStep[];
  activeStepId: string;
  ariaLabel: string;
  /** In-page link target for a step, e.g. `#course-materials`. */
  getHref: (stepId: string) => string;
  onStepSelect?: (stepId: string) => void;
  compact?: boolean;
}

const STEP_STATUS_TEXT: Partial<Record<WorkflowStepState, string>> = {
  complete: 'complete',
  blocked: 'locked',
  attention: 'needs attention'
};

const StepLabel = ({ step }: { step: WorkflowStep }) => {
  const statusText = STEP_STATUS_TEXT[step.state];
  return (
    <span className="workflow-step-copy">
      <strong>{step.label}</strong>
      {statusText && <span className="workflow-step-status"> ({statusText})</span>}
    </span>
  );
};

const StepIcon = ({ step, index, isActive }: { step: WorkflowStep; index: number; isActive: boolean }) => (
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
  steps: WorkflowStep[];
  /** Selected tab; pass null when the visible panel isn't owned by any tab. */
  selectedStepId: string | null;
  ariaLabel: string;
  getTabId: (stepId: string) => string;
  /** Return undefined for a tab whose panel isn't rendered, so aria-controls never points at a missing id. */
  getPanelId: (stepId: string) => string | undefined;
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
            <StepLabel step={step} />
          </button>
        );
      })}
    </div>
  );
};

/**
 * In-page navigation for pages that keep every section visible. Each step is a
 * link to its section; the browser moves focus to the target on activation.
 */
const WorkflowStepper = ({
  steps,
  activeStepId,
  ariaLabel,
  getHref,
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

        return (
          <li key={step.id}>
            <a
              href={getHref(step.id)}
              className="workflow-step-button"
              data-state={isActive ? 'current' : step.state}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => onStepSelect?.(step.id)}
            >
              <StepIcon step={step} index={index} isActive={isActive} />
              <StepLabel step={step} />
            </a>
          </li>
        );
      })}
    </ol>
  </nav>
);

export default WorkflowStepper;
