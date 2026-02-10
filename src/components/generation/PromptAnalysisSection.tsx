import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { LearningObjectiveData } from './generationTypes';

interface PromptAnalysisSectionProps {
  questions: any[];
  learningObjectives: LearningObjectiveData[];
}

export default function PromptAnalysisSection({ questions, learningObjectives }: PromptAnalysisSectionProps) {
  const [expanded, setExpanded] = useState(true);

  // Group questions by LO
  const questionsByLO = questions.reduce((acc, q) => {
    const loId = q.learningObjective?._id || q.learningObjectiveId;
    if (!acc[loId]) {
      acc[loId] = [];
    }
    acc[loId].push(q);
    return acc;
  }, {} as Record<string, any[]>);

  // Calculate method usage statistics
  const methodUsage = questions.reduce((acc, q) => {
    const method = q.generationMetadata?.generationMethod || 'template-based';
    acc[method] = (acc[method] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="prompt-analysis">
      <div className="card-header-content">
        <h4>Generation Prompt Analysis</h4>
        <p>See exactly how each question was generated and what prompts were used:</p>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              <ChevronUp size={16} />
              Hide Details
            </>
          ) : (
            <>
              <ChevronDown size={16} />
              Show Details
            </>
          )}
        </button>
      </div>

      {expanded && (
        <div className="prompts-by-lo">
          {learningObjectives.map((lo, idx) => {
            const loQuestions = questionsByLO[lo._id] || [];
            if (loQuestions.length === 0) return null;

            return (
              <div key={lo._id} className="lo-prompt-group">
                <div className="lo-header">
                  <span className="lo-title">
                    LO {idx + 1}: {lo.text.substring(0, 50)}{lo.text.length > 50 ? '...' : ''}
                  </span>
                  <span className="lo-count">{loQuestions.length} questions</span>
                </div>

                <div className="prompt-list">
                  {loQuestions.map((q, qIdx) => (
                    <div key={q._id || qIdx} className="prompt-item">
                      <div className="prompt-header">
                        <span className="prompt-question">Q{q.order + 1}</span>
                        <span className="prompt-type">{q.type?.replace('-', ' ')}</span>
                        <span className="prompt-method">
                          {q.generationMetadata?.generationMethod || 'template-based'}
                        </span>
                        <span className={`complexity-badge ${q.generationMetadata?.complexity || 'medium'}`}>
                          {q.generationMetadata?.complexity || 'medium'}
                        </span>
                      </div>

                      <div className="sub-objective">
                        <strong>Sub-Learning Objective:</strong>{' '}
                        {q.generationMetadata?.subObjective || 'General knowledge application'}
                      </div>

                      <div className="focus-area">
                        <strong>Focus Area:</strong>{' '}
                        <span className="focus-tag">
                          {q.generationMetadata?.focusArea || 'general knowledge'}
                        </span>
                      </div>

                      <div className="prompt-text">
                        <strong>Detailed AI Prompt:</strong>{' '}
                        {q.generationMetadata?.generationPrompt || 
                          `Generate ${q.type} question for: ${lo.text}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI Generation Method Summary */}
      <div className="generation-summary">
        <h5>AI Generation Method Summary</h5>
        <div className="method-stats">
          {Object.entries(methodUsage).map(([method, count]) => (
            <div key={method} className="method-stat">
              <span className="method-name">{method.replace('-', ' → ')}</span>
              <span className="method-count">{count} questions</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
