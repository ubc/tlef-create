import { useState, useEffect } from 'react';
import { X, Wand2, Eye, EyeOff, Info } from 'lucide-react';
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
}

const RegeneratePromptModal = ({ 
  isOpen, 
  onClose, 
  onRegenerate, 
  question,
  isLoading = false
}: RegeneratePromptModalProps) => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  // Load prompt history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('regenerate-prompt-history');
    if (savedHistory) {
      try {
        setPromptHistory(JSON.parse(savedHistory));
      } catch (error) {
        console.error('Failed to load prompt history:', error);
      }
    }
  }, []);

  // Save prompt to history
  const savePromptToHistory = (prompt: string) => {
    if (prompt.trim() && !promptHistory.includes(prompt.trim())) {
      const newHistory = [prompt.trim(), ...promptHistory].slice(0, 10); // Keep last 10
      setPromptHistory(newHistory);
      localStorage.setItem('regenerate-prompt-history', JSON.stringify(newHistory));
    }
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="regenerate-prompt-modal">
        <div className="modal-header">
          <h3 className="modal-title">
            <Wand2 size={20} />
            Regenerate Question with Custom Prompt
          </h3>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-content">
          {/* Current Question Display */}
          <div className="current-question-section">
            <h4>Current Question ({question.type})</h4>
            <div className="current-question">
              {question.questionText}
            </div>
            <div className="learning-objective">
              <strong>Learning Objective:</strong> {question.learningObjective?.text || 'Not specified'}
            </div>
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
                  This is the base prompt used to generate questions. Your custom prompt will be added to this.
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
                  <button
                    key={index}
                    className="prompt-history-item"
                    onClick={() => setCustomPrompt(prompt)}
                  >
                    {prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt}
                  </button>
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
                Regenerate Question
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegeneratePromptModal;