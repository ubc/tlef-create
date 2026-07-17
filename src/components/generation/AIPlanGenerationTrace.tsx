import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Sparkles } from 'lucide-react';
import '../../styles/components/QuestionGeneration.css';

type TraceStep = {
  status: string;
  message: string;
  metadata?: Record<string, unknown>;
};

type AIPlanGenerationTraceProps = {
  isGenerating: boolean;
  steps: TraceStep[];
  streamedText: string;
  model?: string | null;
  eyebrow?: string;
  activeTitle?: string;
  completeTitle?: string;
  errorTitle?: string;
  emptyOutputText?: string;
};

function extractGenerationSummary(streamedText: string) {
  const summaryStart = streamedText.indexOf('"generationSummary"');
  if (summaryStart < 0) return [];

  const arrayStart = streamedText.indexOf('[', summaryStart);
  if (arrayStart < 0) return [];

  const arrayEnd = streamedText.indexOf(']', arrayStart);
  const summarySection = streamedText.slice(
    arrayStart + 1,
    arrayEnd > arrayStart ? arrayEnd : undefined
  );
  const strings = summarySection.match(/"(?:\\.|[^"\\])*"/g) || [];

  return strings.flatMap(value => {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'string' && parsed.trim() ? [parsed.trim()] : [];
    } catch {
      return [];
    }
  }).slice(0, 6);
}

export default function AIPlanGenerationTrace({
  isGenerating,
  steps,
  streamedText,
  model,
  eyebrow = 'AI Blueprint',
  activeTitle = 'Building your quiz plan',
  completeTitle = 'Blueprint generation complete',
  errorTitle = 'Blueprint generation stopped',
  emptyOutputText = 'Preparing the learning-objective and material context...'
}: AIPlanGenerationTraceProps) {
  const [showRawOutput, setShowRawOutput] = useState(true);
  const outputRef = useRef<HTMLPreElement>(null);
  const summaries = useMemo(() => extractGenerationSummary(streamedText), [streamedText]);
  const latestStep = steps.at(-1);
  const hasError = steps.some(step => step.status === 'error');

  useEffect(() => {
    if (isGenerating) setShowRawOutput(true);
  }, [isGenerating]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamedText]);

  return (
    <section className={`plan-trace ${hasError ? 'plan-trace-error' : ''}`} aria-live="polite">
      <header className="plan-trace-header">
        <div className="plan-trace-heading">
          <span className="plan-trace-icon" aria-hidden="true">
            {isGenerating ? <Loader2 size={20} className="spinning" /> : <Check size={20} />}
          </span>
          <div>
            <span className="plan-trace-kicker">{eyebrow}</span>
            <h3>{isGenerating ? activeTitle : hasError ? errorTitle : completeTitle}</h3>
          </div>
        </div>
        {model && <span className="plan-trace-model">{model}</span>}
      </header>

      <div className="plan-trace-body">
        <div className="plan-trace-activity">
          <span className="plan-trace-section-label">Generation activity</span>
          <div className="plan-trace-timeline">
            {steps.length === 0 && (
              <div className="plan-trace-step plan-trace-step-active">
                <span className="plan-trace-step-marker" />
                <span>Connecting to the generation workflow...</span>
              </div>
            )}
            {steps.map((step, index) => {
              const isLatest = index === steps.length - 1 && isGenerating;
              return (
                <div
                  key={`${step.status}-${index}`}
                  className={`plan-trace-step ${isLatest ? 'plan-trace-step-active' : ''} ${step.status === 'error' ? 'plan-trace-step-error' : ''}`}
                >
                  <span className="plan-trace-step-marker" />
                  <span>{step.message}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="plan-trace-draft">
          <div className="plan-trace-draft-header">
            <span className="plan-trace-section-label">
              <Sparkles size={14} aria-hidden="true" />
              Live model draft
            </span>
            <button
              type="button"
              className="plan-trace-toggle"
              onClick={() => setShowRawOutput(value => !value)}
              aria-expanded={showRawOutput}
            >
              {showRawOutput ? 'Hide' : 'Show'} output
              <ChevronDown size={16} className={showRawOutput ? 'is-open' : ''} />
            </button>
          </div>

          {summaries.length > 0 && (
            <div className="plan-trace-decisions">
              {summaries.map((summary, index) => (
                <div key={`${summary}-${index}`} className="plan-trace-decision">
                  <span>{index + 1}</span>
                  <p>{summary}</p>
                </div>
              ))}
            </div>
          )}

          {showRawOutput && (
            <pre ref={outputRef} className="plan-trace-output">
              {streamedText || (latestStep?.status === 'llm-started'
                ? 'Waiting for the first model token...'
                : emptyOutputText)}
              {isGenerating && streamedText && <span className="plan-trace-caret" aria-hidden="true" />}
            </pre>
          )}
          <p className="plan-trace-note">
            Shows the model's generated blueprint and public decision summary, not private hidden reasoning.
          </p>
        </div>
      </div>
    </section>
  );
}
