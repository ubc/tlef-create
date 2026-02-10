import { useState } from 'react';
import { Plus, Minus, X } from 'lucide-react';
import { PlanItem, LearningObjectiveData } from './generationTypes';

interface PlanEditorProps {
  planItems: PlanItem[];
  learningObjectives: LearningObjectiveData[];
  onPlanItemsChange: (items: PlanItem[]) => void;
  readOnly?: boolean;
}

const QUESTION_TYPES = [
  { value: 'multiple-choice', label: 'Multiple Choice' },
  { value: 'true-false', label: 'True/False' },
  { value: 'flashcard', label: 'Flashcard' },
  { value: 'summary', label: 'Summary' },
  { value: 'discussion', label: 'Discussion' },
  { value: 'matching', label: 'Matching' },
  { value: 'ordering', label: 'Ordering' },
  { value: 'cloze', label: 'Fill in the Blank' }
];

export default function PlanEditor({
  planItems,
  learningObjectives,
  onPlanItemsChange,
  readOnly = false
}: PlanEditorProps) {
  const [expandedSummary, setExpandedSummary] = useState(false);

  const handleAddRow = () => {
    const newItem: PlanItem = {
      id: crypto.randomUUID(),
      type: QUESTION_TYPES[0].value,
      learningObjectiveId: learningObjectives[0]?._id || '',
      count: 1
    };
    onPlanItemsChange([...planItems, newItem]);
  };

  const handleRemoveRow = (id: string) => {
    if (planItems.length <= 1) return;
    onPlanItemsChange(planItems.filter(item => item.id !== id));
  };

  const handleUpdateItem = (id: string, updates: Partial<PlanItem>) => {
    onPlanItemsChange(
      planItems.map(item =>
        item.id === id ? { ...item, ...updates } : item
      )
    );
  };

  const handleCountChange = (id: string, delta: number) => {
    onPlanItemsChange(
      planItems.map(item => {
        if (item.id === id) {
          const newCount = Math.max(1, item.count + delta);
          return { ...item, count: newCount };
        }
        return item;
      })
    );
  };

  // Calculate summary stats
  const totalQuestions = planItems.reduce((sum, item) => sum + item.count, 0);

  const typeDistribution = planItems.reduce((acc, item) => {
    const typeName = QUESTION_TYPES.find(t => t.value === item.type)?.label || item.type;
    acc[typeName] = (acc[typeName] || 0) + item.count;
    return acc;
  }, {} as Record<string, number>);

  const loDistribution = planItems.reduce((acc, item) => {
    const lo = learningObjectives.find(lo => lo._id === item.learningObjectiveId);
    if (lo) {
      const loLabel = `LO ${lo.order + 1}`;
      acc[loLabel] = (acc[loLabel] || 0) + item.count;
    }
    return acc;
  }, {} as Record<string, number>);

  const truncateText = (text: string | undefined, maxLength: number) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (learningObjectives.length === 0) {
    return (
      <div className="plan-editor-empty">
        <p>No learning objectives available. Please add learning objectives first.</p>
      </div>
    );
  }

  return (
    <div className="plan-editor">
      <div className="plan-editor-header">
        <h3>Question Plan</h3>
        <p className="plan-editor-subtitle">
          Specify the question types and learning objectives for your quiz
        </p>
      </div>

      <div className="plan-editor-table">
        <div className="plan-editor-table-header">
          <div className="plan-col-type">Question Type</div>
          <div className="plan-col-lo">Learning Objective</div>
          <div className="plan-col-count">Count</div>
          <div className="plan-col-actions">Actions</div>
        </div>

        <div className="plan-editor-rows">
          {planItems.map((item) => {
            const lo = learningObjectives.find(lo => lo._id === item.learningObjectiveId);
            const loLabel = lo ? `LO ${lo.order + 1}: ${truncateText(lo.text, 50)}` : 'Unknown';

            return (
              <div key={item.id} className="plan-editor-row">
                <div className="plan-col-type">
                  <select
                    value={item.type}
                    onChange={(e) => handleUpdateItem(item.id, { type: e.target.value })}
                    disabled={readOnly}
                    className="plan-select"
                  >
                    {QUESTION_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="plan-col-lo">
                  <select
                    value={item.learningObjectiveId}
                    onChange={(e) => handleUpdateItem(item.id, { learningObjectiveId: e.target.value })}
                    disabled={readOnly}
                    className="plan-select"
                    title={lo?.text}
                  >
                    {learningObjectives.map(lo => (
                      <option key={lo._id} value={lo._id}>
                        LO {lo.order + 1}: {truncateText(lo.text, 50)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="plan-col-count">
                  <div className="count-stepper">
                    <button
                      onClick={() => handleCountChange(item.id, -1)}
                      disabled={readOnly || item.count <= 1 || (planItems.length === 1 && item.count <= 1)}
                      className="count-btn"
                      aria-label="Decrease count"
                      title={planItems.length === 1 && item.count <= 1 ? "Cannot reduce below 1 when only one item" : "Decrease count"}
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={item.count}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val >= 1) {
                          handleUpdateItem(item.id, { count: val });
                        }
                      }}
                      disabled={readOnly}
                      className="count-input"
                      style={{ width: '50px', textAlign: 'center', border: 'none', background: 'transparent' }}
                    />
                    <button
                      onClick={() => handleCountChange(item.id, 1)}
                      disabled={readOnly}
                      className="count-btn"
                      aria-label="Increase count"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                <div className="plan-col-actions">
                  <button
                    onClick={() => handleRemoveRow(item.id)}
                    disabled={readOnly || planItems.length <= 1}
                    className="remove-btn"
                    aria-label="Remove row"
                    title="Remove this row"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {!readOnly && (
          <div className="plan-editor-add-row">
            <button onClick={handleAddRow} className="add-row-btn">
              <Plus size={16} />
              Add Row
            </button>
          </div>
        )}
      </div>

      <div className="plan-summary">
        <div className="plan-summary-header">
          <h4>Plan Summary</h4>
          <button
            className="toggle-summary-btn"
            onClick={() => setExpandedSummary(!expandedSummary)}
          >
            {expandedSummary ? 'Hide Details' : 'Show Details'}
          </button>
        </div>

        <div className="plan-summary-total">
          <strong>Total Questions:</strong> {totalQuestions}
        </div>

        {expandedSummary && (
          <>
            <div className="plan-summary-section">
              <strong>By Question Type:</strong>
              <div className="plan-summary-items">
                {Object.entries(typeDistribution).map(([type, count]) => (
                  <div key={type} className="plan-summary-item">
                    <span className="plan-summary-label">{type}:</span>
                    <span className="plan-summary-value">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="plan-summary-section">
              <strong>By Learning Objective:</strong>
              <div className="plan-summary-items">
                {Object.entries(loDistribution).map(([lo, count]) => (
                  <div key={lo} className="plan-summary-item">
                    <span className="plan-summary-label">{lo}:</span>
                    <span className="plan-summary-value">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
