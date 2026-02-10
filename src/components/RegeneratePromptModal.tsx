import { useState, useEffect } from 'react';
import { X, Wand2, Eye, EyeOff, Info, Trash2 } from 'lucide-react';
import '../styles/components/RegeneratePromptModal.css';

interface RegeneratePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegenerate: (customPrompt?: string) => void;
  question: {
    _id: string;
    type: string;
    questionText: string;
    learningObjective?: {
      text: string;
    };
  };
  isLoading?: boolean;
  historyKey?: string; // Kept for backward compatibility but now uses shared history
  mode?: 'question' | 'learning-objective'; // Determines display text
}

const RegeneratePromptModal = ({
  isOpen,
  onClose,
  onRegenerate,
  question,
  isLoading = false,
  historyKey = 'shared', // Now using shared history
  mode = 'question' // Default to 'question' for backward compatibility
}: RegeneratePromptModalProps) => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  // Use shared storage key for all regeneration prompts
  const storageKey = 'regenerate-prompt-history-shared';

  // Load prompt history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem(storageKey);
    if (savedHistory) {
      try {
        setPromptHistory(JSON.parse(savedHistory));
      } catch (error) {
        console.error('Failed to load prompt history:', error);
      }
    }
  }, [storageKey]);

  // Save prompt to history
  const savePromptToHistory = (prompt: string) => {
    if (prompt.trim() && !promptHistory.includes(prompt.trim())) {
      const newHistory = [prompt.trim(), ...promptHistory].slice(0, 5); // Keep last 5
      setPromptHistory(newHistory);
      localStorage.setItem(storageKey, JSON.stringify(newHistory));
    }
  };

  // Delete prompt from history
  const deletePromptFromHistory = (index: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent the button click from triggering
    const newHistory = promptHistory.filter((_: string, i: number) => i !== index);
    setPromptHistory(newHistory);
    localStorage.setItem(storageKey, JSON.stringify(newHistory));
  };

  const handleRegenerate = () => {
    if (customPrompt.trim()) {
      savePromptToHistory(customPrompt);
    }
    onRegenerate(customPrompt.trim() || undefined);
  };

  const getSystemPrompt = () => {
    const questionTypeFormatting = {
      'multiple-choice': 'Multiple choice question with 4 options, exactly one correct answer',
      'true-false': 'True/False question with explanation',
      'flashcard': 'Flashcard with front (question) and back (answer)',
      'summary': 'Study guide with expandable key points and explanations',
      'discussion': 'Open-ended discussion question for deeper thinking',
      'matching': 'Matching pairs question',
      'ordering': 'Sequence ordering question',
      'cloze': 'Fill-in-the-blanks question'
    };

    return `You are an expert educational assessment designer specializing in creating high-quality, pedagogically sound quiz questions. Your task is to generate a ${question.type} question that effectively assesses student understanding.

LEARNING OBJECTIVE:
${question.learningObjective?.text || 'Student learning objective'}

QUESTION TYPE: ${question.type}

CURRENT QUESTION TO REGENERATE:
"${question.questionText}"

INSTRUCTIONS:
1. Create a question that directly assesses the learning objective
2. Make the question engaging and relevant to real-world applications
3. Ensure the question tests meaningful understanding, not just memorization
4. Follow educational best practices for ${question.type} questions
5. Create a completely new question - avoid repeating the current question

RESPONSE FORMAT:
${questionTypeFormatting[question.type as keyof typeof questionTypeFormatting] || 'Generate appropriate question format'}

Return ONLY a valid JSON object with the required structure for ${question.type} questions.`;
  };

  // Get dynamic text based on mode
  const itemType = mode === 'learning-objective' ? 'Learning Objective' : 'Question';
  const itemTypeLabel = mode === 'learning-objective' ? question.type : `${question.type}`;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="regenerate-prompt-modal">
        <div className="modal-header">
          <h3 className="modal-title">
            <Wand2 size={20} />
            Regenerate {itemType} with Custom Prompt
          </h3>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-content">
          {/* Current Question Display */}
          <div className="current-question-section">
            <h4>Current {itemType} ({itemTypeLabel})</h4>
            <div className="current-question">
              {question.questionText}
            </div>
            {mode === 'question' && (
              <div className="learning-objective">
                <strong>Learning Objective:</strong> {question.learningObjective?.text || 'Not specified'}
              </div>
            )}
          </div>

          {/* System Prompt Section */}
          <div className="system-prompt-section">
            <div className="section-header">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowSystemPrompt(!showSystemPrompt)}
              >
                {showSystemPrompt ? <EyeOff size={16} /> : <Eye size={16} />}
                {showSystemPrompt ? 'Hide' : 'Show'} System Prompt
              </button>
              <div className="info-tooltip">
                <Info size={14} />
                <span className="tooltip-text">
                  This is the base prompt used to generate {mode === 'learning-objective' ? 'learning objectives' : 'questions'}. Your custom prompt will be added to this.
                </span>
              </div>
            </div>

            {showSystemPrompt && (
              <div className="system-prompt">
                <pre>{getSystemPrompt()}</pre>
              </div>
            )}
          </div>

          {/* Custom Prompt Input */}
          <div className="custom-prompt-section">
            <label htmlFor="custom-prompt">
              <strong>Additional Instructions (Optional)</strong>
            </label>
            <textarea
              id="custom-prompt"
              className="custom-prompt-input"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Enter specific instructions for regeneration (e.g., 'Make it more challenging', 'Focus on practical applications', 'Use examples from healthcare')"
              rows={4}
            />
            <div className="prompt-help">
              Leave empty to use default regeneration, or add specific instructions to guide the AI.
            </div>
          </div>

          {/* Prompt History */}
          {promptHistory.length > 0 && (
            <div className="prompt-history-section">
              <h4>Recent Prompts</h4>
              <div className="prompt-history">
                {promptHistory.map((prompt, index) => (
                  <div key={index} className="prompt-history-item-wrapper">
                    <button
                      className="prompt-history-item"
                      onClick={() => setCustomPrompt(prompt)}
                    >
                      {prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm delete-prompt-btn"
                      onClick={(e) => deletePromptFromHistory(index, e)}
                      title="Delete prompt"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleRegenerate}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className="loading-spinner"></div>
                Regenerating...
              </>
            ) : (
              <>
                <Wand2 size={16} />
                Regenerate {itemType}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegeneratePromptModal;
