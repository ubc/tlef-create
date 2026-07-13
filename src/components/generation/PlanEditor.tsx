import { useState } from 'react';
import { Plus, Minus, X } from 'lucide-react';
import { PlanItem, LearningObjectiveData } from './generationTypes';
import {
  TargetFormat,
  getFallbackQuestionType,
  getQuestionTypesForTarget
} from '../../constants/questionTypeCapabilities';

interface PlanEditorProps {
  planItems: PlanItem[];
  learningObjectives: LearningObjectiveData[];
  onPlanItemsChange: (items: PlanItem[]) => void;
  targetFormat: TargetFormat;
  readOnly?: boolean;
}

export default function PlanEditor({
  planItems,
  learningObjectives,
  onPlanItemsChange,
  targetFormat,
  readOnly = false
}: PlanEditorProps) {
  const [expandedSummary, setExpandedSummary] = useState(false);
  const questionTypes = getQuestionTypesForTarget(targetFormat);

  const handleAddRow = () => {
    const fallbackType = getFallbackQuestionType(targetFormat);
    const newItem: PlanItem = {
      id: crypto.randomUUID(),
      type: fallbackType,
      learningObjectiveId: learningObjectives[0]?._id || '',
      count: 1,
      ...(fallbackType === 'multiple-choice' && { selectionMode: 'single' as const })
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

  const handleTypeChange = (id: string, newType: string) => {
    const updates: Partial<PlanItem> = { type: newType };
    if (newType === 'multiple-choice') {
      updates.selectionMode = 'single';
    } else {
      updates.selectionMode = undefined;
    }
    if (newType === 'branching-scenario') {
      updates.count = 1;
      updates.branchingLayers = 2;
      updates.branchingChoices = 2;
    } else {
      updates.branchingLayers = undefined;
      updates.branchingChoices = undefined;
    }
    if (newType === 'documentation-tool') {
      updates.count = 1;
    }
    handleUpdateItem(id, updates);
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
    const typeName = questionTypes.find(t => t.value === item.type)?.label || item.type;
    acc[typeName] = (acc[typeName] || 0) + item.count;
    return acc;
  }, {} as Record<string, number>);

  const loDistribution = planItems.reduce((acc, item) => {
    const lo = learningObjectives.find(lo => lo._id === item.learningObjectiveId);
    const loLabel = lo ? `LO ${lo.order + 1}` : 'No LO (custom prompt)';
    acc[loLabel] = (acc[loLabel] || 0) + item.count;
    return acc;
  }, {} as Record<string, number>);

  const truncateText = (text: string | undefined, maxLength: number) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const getLearningObjectiveLabel = (lo: LearningObjectiveData) => {
    const trimmedText = lo.text?.trim();
    return trimmedText
      ? `LO ${lo.order + 1}: ${truncateText(trimmedText, 50)}`
      : `LO ${lo.order + 1}: (loading objective text...)`;
  };

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
            const showCustomPrompt = !item.learningObjectiveId || item.type === 'documentation-tool';
            const customPromptRequired = !item.learningObjectiveId;
            const customPromptError = customPromptRequired && !item.customPrompt?.trim();

            return (
              <div key={item.id} className="plan-editor-row" style={{ flexWrap: 'wrap' }}>
                <div className="plan-col-type">
                  <select
                    value={item.type}
                    onChange={(e) => handleTypeChange(item.id, e.target.value)}
                    disabled={readOnly}
                    className="plan-select"
                  >
                    {questionTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  {item.type === 'multiple-choice' && (
                    <div style={{ marginTop: 8 }}>
                      <label style={{ display: 'block', fontSize: '0.75rem', opacity: 0.7, marginBottom: 4 }}>
                        Answer Mode
                      </label>
                      <select
                        value={item.selectionMode || 'single'}
                        onChange={(e) => handleUpdateItem(item.id, { selectionMode: e.target.value as 'single' | 'multiple' })}
                        disabled={readOnly}
                        className="plan-select"
                      >
                        <option value="single">Single answer</option>
                        <option value="multiple">Multiple answers</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="plan-col-lo">
                  <select
                    value={item.learningObjectiveId}
                    onChange={(e) => handleUpdateItem(item.id, { learningObjectiveId: e.target.value })}
                    disabled={readOnly}
                    className="plan-select"
                    title={lo?.text}
                  >
                    <option value="">— No Learning Objective —</option>
                    {learningObjectives.map(lo => (
                      <option key={lo._id} value={lo._id}>
                        {getLearningObjectiveLabel(lo)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="plan-col-count">
                  {item.type === 'branching-scenario' ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Layers</span>
                        <select
                          className="plan-select"
                          style={{ width: 56 }}
                          value={item.branchingLayers ?? 2}
                          onChange={(e) => handleUpdateItem(item.id, { branchingLayers: Number(e.target.value) })}
                          disabled={readOnly}
                        >
                          {[2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Choices</span>
                        <select
                          className="plan-select"
                          style={{ width: 56 }}
                          value={item.branchingChoices ?? 2}
                          onChange={(e) => handleUpdateItem(item.id, { branchingChoices: Number(e.target.value) })}
                          disabled={readOnly}
                        >
                          {[2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                  ) : (
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
                  )}
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

                {showCustomPrompt && (
                  <div style={{ width: '100%', padding: '4px 0 6px 4px' }}>
                    <textarea
                      className="plan-select"
                      style={{ width: '100%', minHeight: 56, resize: 'vertical', fontSize: '0.82rem', padding: '4px 6px', boxSizing: 'border-box', borderColor: customPromptError ? 'var(--color-destructive)' : undefined }}
                      value={item.customPrompt || ''}
                      onChange={(e) => handleUpdateItem(item.id, { customPrompt: e.target.value })}
                      disabled={readOnly}
                      placeholder={
                        item.type === 'documentation-tool'
                          ? 'Describe the documentation tool topic and purpose (e.g. "Reflective journal for a clinical ethics case study")…'
                          : customPromptRequired
                            ? 'Required: describe what to generate (used as primary context instead of a learning objective)…'
                            : 'Optional: additional context or instructions for the AI…'
                      }
                    />
                    {customPromptError && (
                      <small style={{ color: 'var(--color-destructive)', fontSize: '0.75rem' }}>
                        Custom prompt is required when no learning objective is selected.
                      </small>
                    )}
                  </div>
                )}
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
