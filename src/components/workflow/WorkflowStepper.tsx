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
