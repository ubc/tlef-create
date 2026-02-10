import { useState, useEffect } from 'react';
import { Sparkles, Target, Trophy } from 'lucide-react';
import { AIConfig, LearningObjectiveData } from './generationTypes';

interface AIConfigPanelProps {
  aiConfig: AIConfig;
  onConfigChange: (config: AIConfig) => void;
  onGeneratePlan: () => void;
  isGenerating: boolean;
  learningObjectives: LearningObjectiveData[];
}

const APPROACH_CARDS = [
  {
    value: 'support' as const,
    label: 'Support Learning',
    icon: Sparkles,
    description: 'Emphasize flashcards and summaries to help students memorize and understand key concepts',
    color: '#3b82f6'
  },
  {
    value: 'assess' as const,
    label: 'Assess Understanding',
    icon: Target,
    description: 'Emphasize multiple-choice and discussion questions to evaluate comprehension',
    color: '#8b5cf6'
  },
  {
    value: 'gamify' as const,
    label: 'Gamify Learning',
    icon: Trophy,
    description: 'Emphasize matching and ordering questions to create engaging, game-like experiences',
    color: '#f59e0b'
  }
];

export default function AIConfigPanel({
  aiConfig,
  onConfigChange,
  onGeneratePlan,
  isGenerating,
  learningObjectives
}: AIConfigPanelProps) {
  const [inputValue, setInputValue] = useState(aiConfig.totalQuestions.toString());
  const minQuestions = learningObjectives.length; // At least 1 per LO
  const maxQuestions = 100;

  // Sync input value when aiConfig changes externally
  useEffect(() => {
    setInputValue(aiConfig.totalQuestions.toString());
  }, [aiConfig.totalQuestions]);

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

  const handleApproachSelect = (approach: 'support' | 'assess' | 'gamify') => {
    onConfigChange({ ...aiConfig, approach });
  };

  const handleInstructionsChange = (value: string) => {
    onConfigChange({ ...aiConfig, additionalInstructions: value });
  };

  return (
    <div className="ai-config-panel">
      <div className="ai-config-header">
        <h3>AI Plan Configuration</h3>
        <p className="ai-config-subtitle">
          Configure how the AI should generate your question distribution plan
        </p>
      </div>

      <div className="ai-config-section">
        <label className="ai-config-label">
          How many questions do you want to generate?
        </label>
        <div className="total-questions-input">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={inputValue}
            onChange={(e) => handleTotalChange(e.target.value)}
            onBlur={() => {
              // On blur, ensure value is valid
              if (inputValue === '' || isNaN(parseInt(inputValue, 10))) {
                setInputValue(minQuestions.toString());
                onConfigChange({ ...aiConfig, totalQuestions: minQuestions });
              }
            }}
            disabled={isGenerating}
            className="question-count-input"
            placeholder={`${minQuestions}-${maxQuestions}`}
          />
          <span className="input-hint">questions ({minQuestions}-{maxQuestions})</span>
        </div>
        {minQuestions > 1 && (
          <div className="input-hint" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
            Minimum is {minQuestions} (at least 1 question per learning objective)
          </div>
        )}
      </div>

      <div className="ai-config-section">
        <label className="ai-config-label">
          What pedagogical approach should the AI use?
        </label>
        <div className="approach-cards">
          {APPROACH_CARDS.map(card => {
            const Icon = card.icon;
            const isSelected = aiConfig.approach === card.value;

            return (
              <button
                key={card.value}
                className={`approach-card ${isSelected ? 'selected' : ''}`}
                onClick={() => handleApproachSelect(card.value)}
                disabled={isGenerating}
                style={{
                  borderColor: isSelected ? card.color : undefined,
                  backgroundColor: isSelected ? `${card.color}10` : undefined
                }}
              >
                <div className="approach-card-icon" style={{ color: card.color }}>
                  <Icon size={24} />
                </div>
                <div className="approach-card-content">
                  <h4 className="approach-card-title">{card.label}</h4>
                  <p className="approach-card-description">{card.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ai-config-section">
        <label className="ai-config-label">
          Additional Instructions (Optional)
        </label>
        <textarea
          value={aiConfig.additionalInstructions || ''}
          onChange={(e) => handleInstructionsChange(e.target.value)}
          disabled={isGenerating}
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
          disabled={isGenerating}
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
