import { useState, useEffect } from 'react';
import { X, Plus, Minus } from 'lucide-react';
import '../styles/components/AdvancedEditModal.css';

interface QuestionTypeConfig {
  type: string;
  count: number;
  percentage: number;
  scope: 'per-lo' | 'whole-quiz';
  editMode: 'count' | 'percentage';
}

interface CustomFormula {
  questionTypes: QuestionTypeConfig[];
  totalQuestions: number;
  totalPerLO: number;
  totalWholeQuiz: number;
}

interface AdvancedEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  customFormula: CustomFormula;
  onFormulaChange: (formula: CustomFormula) => void;
  approach: string;
  learningObjectivesCount: number;
  onSave: () => void;
}

const AdvancedEditModal = ({
  isOpen,
  onClose,
  customFormula,
  onFormulaChange,
  approach,
  learningObjectivesCount,
  onSave
}: AdvancedEditModalProps) => {
  const [localFormula, setLocalFormula] = useState<CustomFormula>(customFormula);

  useEffect(() => {
    setLocalFormula(customFormula);
  }, [customFormula, isOpen]);

  const availableQuestionTypes = [
    { value: 'multiple-choice', label: 'Multiple Choice' },
    { value: 'true-false', label: 'True/False' },
    { value: 'flashcard', label: 'Flashcard' },
    { value: 'summary', label: 'Summary' },
    { value: 'discussion', label: 'Discussion' },
    { value: 'matching', label: 'Matching' },
    { value: 'ordering', label: 'Ordering' },
    { value: 'cloze', label: 'Fill in the Blank' }
  ];

  const addQuestionType = () => {
    const usedTypes = localFormula.questionTypes.map(qt => qt.type);
    const availableType = availableQuestionTypes.find(qt => !usedTypes.includes(qt.value));
    
    if (availableType) {
      const newQuestionType: QuestionTypeConfig = {
        type: availableType.value,
        count: 1,
        percentage: 0,
        scope: 'per-lo',
        editMode: 'count'
      };
      
      const newTypes = [...localFormula.questionTypes, newQuestionType];
      const updatedFormula = { ...localFormula, questionTypes: newTypes };
      updateTotals(updatedFormula);
    }
  };

  const removeQuestionType = (index: number) => {
    const newTypes = localFormula.questionTypes.filter((_, i) => i !== index);
    const updatedFormula = { ...localFormula, questionTypes: newTypes };
    updateTotals(updatedFormula);
  };

  const updateQuestionType = (index: number, field: 'type' | 'count' | 'percentage' | 'scope' | 'editMode', value: string | number) => {
    const newTypes = localFormula.questionTypes.map((qt, i) => {
      if (i !== index) return { ...qt };
      
      const updatedType = { ...qt };
      
      if (field === 'type') {
        updatedType.type = value as string;
      } else if (field === 'count') {
        updatedType.count = Math.max(0, value as number);
      } else if (field === 'percentage') {
        updatedType.percentage = Math.max(0, Math.min(100, value as number));
        if (updatedType.editMode === 'percentage') {
          const perLoTypes = localFormula.questionTypes.filter(qt => qt.scope === 'per-lo');
          const totalPerLoPercentage = perLoTypes.reduce((sum, qt) => sum + qt.percentage, 0);
          if (totalPerLoPercentage > 0) {
            updatedType.count = Math.round((updatedType.percentage / 100) * localFormula.totalPerLO);
          }
        }
      } else if (field === 'scope') {
        updatedType.scope = value as 'per-lo' | 'whole-quiz';
      } else if (field === 'editMode') {
        updatedType.editMode = value as 'count' | 'percentage';
      }
      
      return updatedType;
    });
    
    const updatedFormula = { ...localFormula, questionTypes: newTypes };
    updateTotals(updatedFormula);
  };

  const updateTotals = (formula: CustomFormula) => {
    const perLoTypes = formula.questionTypes.filter(qt => qt.scope === 'per-lo');
    const wholeQuizTypes = formula.questionTypes.filter(qt => qt.scope === 'whole-quiz');
    
    const totalPerLO = perLoTypes.reduce((sum, qt) => sum + qt.count, 0);
    const totalWholeQuiz = wholeQuizTypes.reduce((sum, qt) => sum + qt.count, 0);
    const totalQuestions = totalPerLO;
    
    const updatedTypes = formula.questionTypes.map(qt => {
      if (qt.scope === 'per-lo' && qt.editMode === 'count') {
        return {
          ...qt,
          percentage: totalPerLO > 0 ? Math.round((qt.count / totalPerLO) * 100) : 0
        };
      } else if (qt.scope === 'whole-quiz') {
        return {
          ...qt,
          percentage: 0
        };
      }
      return qt;
    });
    
    const finalFormula = {
      ...formula,
      questionTypes: updatedTypes,
      totalQuestions,
      totalPerLO,
      totalWholeQuiz
    };

    setLocalFormula(finalFormula);
  };

  const handleSave = () => {
    onFormulaChange(localFormula);
    onSave();
    onClose();
  };

  const handleCancel = () => {
    setLocalFormula(customFormula); // Reset to original
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Question Formula Editor</h2>
            <p>
              {approach === 'custom' 
                ? 'Define your own mix of question types and quantities.'
                : `Customize the default ${approach} approach with your preferred question distribution.`
              }
            </p>
          </div>
          <button
            className="modal-close-btn"
            onClick={handleCancel}
            aria-label="Close modal"
          >
            <X size={24} />
          </button>
        </div>

        <div className="modal-body">
          {/* Question Types Configuration */}
          <div className="question-types-config">
            <div className="config-header">
              <h3>Question Type Configuration</h3>
              <p>Define how many questions of each type to generate per learning objective</p>
            </div>
            
            {localFormula.questionTypes.map((questionType, index) => (
              <div key={index} className="question-type-row">
                <div className="question-type-select">
                  <select
                    className="select-input"
                    value={questionType.type}
                    onChange={(e) => updateQuestionType(index, 'type', e.target.value)}
                  >
                    {availableQuestionTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                {/* Edit Mode Toggle */}
                <div className="edit-mode-toggle">
                  <button
                    className={`btn btn-sm ${questionType.editMode === 'count' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => updateQuestionType(index, 'editMode', 'count')}
                  >
                    #
                  </button>
                  <button
                    className={`btn btn-sm ${questionType.editMode === 'percentage' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => updateQuestionType(index, 'editMode', 'percentage')}
                  >
                    %
                  </button>
                </div>
                
                {/* Count/Percentage Input */}
                {questionType.editMode === 'count' ? (
                  <div className="count-input">
                    <button
                      className="btn btn-outline btn-sm counter-btn"
                      onClick={() => updateQuestionType(index, 'count', questionType.count - 1)}
                      disabled={questionType.count <= 0}
                    >
                      <Minus size={14} />
                    </button>
                    <span className="counter-value">{questionType.count}</span>
                    <button
                      className="btn btn-outline btn-sm counter-btn"
                      onClick={() => updateQuestionType(index, 'count', questionType.count + 1)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="percentage-input">
                    <input
                      type="number"
                      className="input-sm"
                      value={questionType.percentage}
                      onChange={(e) => updateQuestionType(index, 'percentage', parseInt(e.target.value) || 0)}
                      min="0"
                      max="100"
                    />
                    <span>%</span>
                  </div>
                )}

                {/* Scope Toggle */}
                <div className="scope-toggle">
                  <button
                    className={`btn btn-sm ${questionType.scope === 'per-lo' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => updateQuestionType(index, 'scope', 'per-lo')}
                    title="Per Learning Objective"
                  >
                    LO
                  </button>
                  <button
                    className={`btn btn-sm ${questionType.scope === 'whole-quiz' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => updateQuestionType(index, 'scope', 'whole-quiz')}
                    title="Whole Quiz"
                  >
                    Quiz
                  </button>
                </div>
                
                {localFormula.questionTypes.length > 1 && (
                  <button
                    className="btn btn-outline btn-sm remove-btn"
                    onClick={() => removeQuestionType(index)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            
            {localFormula.questionTypes.length < availableQuestionTypes.length && (
              <button
                className="btn btn-outline add-question-type-btn"
                onClick={addQuestionType}
              >
                <Plus size={16} />
                Add Question Type
              </button>
            )}
          </div>

          {/* Live Preview */}
          <div className="distribution-preview">
            <h3>Live Preview</h3>
            
            {/* Per-LO Questions */}
            {localFormula.questionTypes.filter(qt => qt.scope === 'per-lo').length > 0 && (
              <div className="preview-section">
                <h4>Per Learning Objective ({localFormula.totalPerLO} questions each)</h4>
                <div className="preview-grid">
                  {localFormula.questionTypes.filter(qt => qt.scope === 'per-lo').map((qt, index) => (
                    <div key={index} className="preview-item">
                      <span className="question-type-label">
                        {availableQuestionTypes.find(t => t.value === qt.type)?.label || qt.type}
                      </span>
                      <span className="question-count">{qt.count} questions</span>
                      <span className="question-source">({qt.percentage}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Whole Quiz Questions */}
            {localFormula.questionTypes.filter(qt => qt.scope === 'whole-quiz').length > 0 && (
              <div className="preview-section">
                <h4>Whole Quiz ({localFormula.totalWholeQuiz} questions total)</h4>
                <div className="preview-grid">
                  {localFormula.questionTypes.filter(qt => qt.scope === 'whole-quiz').map((qt, index) => (
                    <div key={index} className="preview-item">
                      <span className="question-type-label">
                        {availableQuestionTypes.find(t => t.value === qt.type)?.label || qt.type}
                      </span>
                      <span className="question-count">{qt.count} questions</span>
                      <span className="question-source">(whole quiz)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="total-summary">
              <p><strong>Per Learning Objective:</strong> {localFormula.totalPerLO} questions</p>
              <p><strong>Whole Quiz:</strong> {localFormula.totalWholeQuiz} questions</p>
              <p><strong>Total Quiz Questions:</strong> {(learningObjectivesCount * localFormula.totalPerLO) + localFormula.totalWholeQuiz}</p>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-outline"
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdvancedEditModal;