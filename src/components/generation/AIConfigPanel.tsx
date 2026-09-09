import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { AIConfig, LearningObjectiveData } from './generationTypes';

interface AIConfigPanelProps {
  aiConfig: AIConfig;
  onConfigChange: (config: AIConfig) => void;
  onGeneratePlan: () => void;
  isGenerating: boolean;
  disabled?: boolean;
  learningObjectives: LearningObjectiveData[];
}

export default function AIConfigPanel({
  aiConfig,
  onConfigChange,
  onGeneratePlan,
  isGenerating,
  disabled = false,
  learningObjectives
}: AIConfigPanelProps) {
  const [inputValue, setInputValue] = useState(aiConfig.totalQuestions.toString());
  const minQuestions = learningObjectives.length; // At least 1 per LO
  const maxQuestions = 100;
  const isBusy = isGenerating || disabled;

  // Sync input value when aiConfig changes externally
  useEffect(() => {
    setInputValue(aiConfig.autoRecommendTotalQuestions ? 'Auto' : aiConfig.totalQuestions.toString());
  }, [aiConfig.totalQuestions, aiConfig.autoRecommendTotalQuestions]);

  const handleTotalChange = (value: string) => {
    // Allow empty input for manual typing
    setInputValue(value);

    if (value === '') {
      return; // Don't update aiConfig yet
    }

    const num = parseInt(value, 10);

    // Ignore invalid numbers
    if (isNaN(num)) {
      return;
    }

    // Only update if within valid range
    if (num >= minQuestions && num <= maxQuestions) {
      onConfigChange({ ...aiConfig, totalQuestions: num });
    }
  };

  const handleInstructionsChange = (value: string) => {
    onConfigChange({ ...aiConfig, additionalInstructions: value });
  };

  return (
    <div className="ai-config-panel">
      <div className="ai-config-header">
        <h3>Set quiz length and instructions</h3>
        <p className="ai-config-subtitle">
          Generate an editable Blueprint using the teaching purpose and layout above. Existing questions are not changed by generating a plan.
        </p>
      </div>

      <div className="ai-config-section">
        <label className="ai-config-label" htmlFor="ai-question-count">
          How many questions do you want to generate?
        </label>
        <label className="auto-count-toggle">
          <input
            type="checkbox"
            checked={!!aiConfig.autoRecommendTotalQuestions}
            onChange={(e) => onConfigChange({
              ...aiConfig,
              autoRecommendTotalQuestions: e.target.checked,
              autoRecommendTotalQuestionsUserSet: true
            })}
            disabled={isBusy}
          />
          Let CREATE recommend the quiz length based on LO complexity and materials
        </label>
        <div className="total-questions-input">
          <input
            id="ai-question-count"
            type="text"
            inputMode={aiConfig.autoRecommendTotalQuestions ? 'text' : 'numeric'}
            pattern={aiConfig.autoRecommendTotalQuestions ? undefined : '[0-9]*'}
            value={aiConfig.autoRecommendTotalQuestions ? 'Auto' : inputValue}
            onChange={(e) => handleTotalChange(e.target.value)}
            onBlur={() => {
              if (aiConfig.autoRecommendTotalQuestions) {
                return;
              }
              // On blur, ensure value is valid
              if (inputValue === '' || isNaN(parseInt(inputValue, 10))) {
                setInputValue(minQuestions.toString());
                onConfigChange({ ...aiConfig, totalQuestions: minQuestions });
              }
            }}
            disabled={isBusy || aiConfig.autoRecommendTotalQuestions}
            className={`question-count-input ${aiConfig.autoRecommendTotalQuestions ? 'auto-value' : ''}`}
            placeholder={`${minQuestions}-${maxQuestions}`}
          />
          <span className="input-hint">
            {aiConfig.autoRecommendTotalQuestions
              ? 'CREATE will recommend a total'
              : `questions (${minQuestions}-${maxQuestions})`}
          </span>
        </div>
        {!aiConfig.autoRecommendTotalQuestions && minQuestions > 1 && (
          <div className="input-hint" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
            Minimum is {minQuestions} (at least 1 question per learning objective)
          </div>
        )}
      </div>

      <div className="ai-config-section">
        <label className="ai-config-label" htmlFor="ai-plan-instructions">
          Additional Instructions (Optional)
        </label>
        <textarea
          id="ai-plan-instructions"
          value={aiConfig.additionalInstructions || ''}
          onChange={(e) => handleInstructionsChange(e.target.value)}
          disabled={isBusy}
          className="additional-instructions-textarea"
          placeholder="e.g., Focus more on LO3, include more matching questions, avoid true/false..."
          rows={4}
          maxLength={1000}
        />
        <div className="textarea-hint">
          {(aiConfig.additionalInstructions || '').length}/1000 characters
        </div>
      </div>

      <div className="ai-config-action">
        <button
          onClick={onGeneratePlan}
          disabled={isBusy}
          className="btn btn-primary generate-plan-btn"
        >
          {isGenerating ? (
            <>
              <span className="spinner"></span>
              Generating Plan...
            </>
          ) : (
            <>
              <Sparkles size={18} />
              Generate Plan
            </>
          )}
        </button>
      </div>
    </div>
  );
}
