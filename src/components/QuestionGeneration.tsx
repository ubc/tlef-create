import { useState } from 'react';
import { Wand2, Settings, Zap, Gamepad2, GraduationCap, Edit, Plus, Minus } from 'lucide-react';
import '../styles/components/QuestionGeneration.css';

interface QuestionGenerationProps {
  learningObjectives: string[];
  assignedMaterials: string[];
  quizId: string;
}

type PedagogicalApproach = 'support' | 'assess' | 'gamify' | 'custom';
type QuestionType = 'multiple-choice' | 'true-false' | 'flashcard' | 'summary' | 'discussion' | 'matching' | 'ordering' | 'cloze';

interface QuestionTypeConfig {
  type: QuestionType;
  count: number;
}

const QuestionGeneration = ({ learningObjectives, assignedMaterials, quizId }: QuestionGenerationProps) => {
  const [approach, setApproach] = useState<PedagogicalApproach>('support');
  const [questionsPerLO, setQuestionsPerLO] = useState(3);
  const [showAdvancedEdit, setShowAdvancedEdit] = useState(false);
  const [customQuestionTypes, setCustomQuestionTypes] = useState<QuestionTypeConfig[]>([
    { type: 'multiple-choice', count: 2 },
    { type: 'flashcard', count: 1 }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<any[]>([]);

  const pedagogicalApproaches = [
    {
      id: 'support' as PedagogicalApproach,
      title: 'Support Learning',
      description: 'Flashcards, summaries, and discussion questions to reinforce understanding',
      icon: GraduationCap,
      defaultTypes: [
        { type: 'flashcard' as QuestionType, count: 2 },
        { type: 'summary' as QuestionType, count: 1 },
        { type: 'discussion' as QuestionType, count: 1 }
      ]
    },
    {
      id: 'assess' as PedagogicalApproach,
      title: 'Assess Learning',
      description: 'Multiple choice and true/false questions to test comprehension',
      icon: Zap,
      defaultTypes: [
        { type: 'multiple-choice' as QuestionType, count: 2 },
        { type: 'true-false' as QuestionType, count: 1 }
      ]
    },
    {
      id: 'gamify' as PedagogicalApproach,
      title: 'Gamify Learning',
      description: 'Interactive questions like matching, ordering, and cloze tests',
      icon: Gamepad2,
      defaultTypes: [
        { type: 'matching' as QuestionType, count: 1 },
        { type: 'ordering' as QuestionType, count: 1 },
        { type: 'cloze' as QuestionType, count: 1 }
      ]
    },
    {
      id: 'custom' as PedagogicalApproach,
      title: 'Custom Formula',
      description: 'Define your own mix of question types and quantities',
      icon: Settings,
      defaultTypes: []
    }
  ];

  const questionTypes = [
    { id: 'multiple-choice', label: 'Multiple Choice' },
    { id: 'true-false', label: 'True/False' },
    { id: 'flashcard', label: 'Flashcard' },
    { id: 'summary', label: 'Summary' },
    { id: 'discussion', label: 'Discussion' },
    { id: 'matching', label: 'Matching' },
    { id: 'ordering', label: 'Ordering' },
    { id: 'cloze', label: 'Cloze Test' }
  ];

  const getCurrentQuestionTypes = () => {
    if (approach === 'custom') {
      return customQuestionTypes;
    }
    const selectedApproach = pedagogicalApproaches.find(app => app.id === approach);
    return selectedApproach?.defaultTypes || [];
  };

  const getTotalQuestionsPerLO = () => {
    if (approach === 'custom') {
      return customQuestionTypes.reduce((total, config) => total + config.count, 0);
    }
    return questionsPerLO;
  };

  const handleApproachSelect = (approachId: PedagogicalApproach) => {
    setApproach(approachId);
    setShowAdvancedEdit(approachId === 'custom');

    if (approachId !== 'custom') {
      const selectedApproach = pedagogicalApproaches.find(app => app.id === approachId);
      if (selectedApproach?.defaultTypes) {
        const totalQuestions = selectedApproach.defaultTypes.reduce((total, config) => total + config.count, 0);
        setQuestionsPerLO(totalQuestions);
      }
    }
  };

  const addQuestionType = () => {
    setCustomQuestionTypes([...customQuestionTypes, { type: 'multiple-choice', count: 1 }]);
  };

  const removeQuestionType = (index: number) => {
    setCustomQuestionTypes(customQuestionTypes.filter((_, i) => i !== index));
  };

  const updateQuestionType = (index: number, field: 'type' | 'count', value: QuestionType | number) => {
    const updated = [...customQuestionTypes];
    updated[index] = { ...updated[index], [field]: value };
    setCustomQuestionTypes(updated);
  };

  const handleGeneration = async () => {
    setIsGenerating(true);

    // Generate mock questions based on approach
    const questionConfigs = getCurrentQuestionTypes();
    const mockQuestions: any[] = [];

    learningObjectives.forEach((objective, loIndex) => {
      questionConfigs.forEach((config) => {
        for (let i = 0; i < config.count; i++) {
          mockQuestions.push({
            id: Date.now() + Math.random(),
            type: config.type,
            difficulty: 'moderate',
            question: `${config.type.replace('-', ' ')} question ${mockQuestions.length + 1} for "${objective.substring(0, 40)}..."`,
            answer: config.type === 'multiple-choice' ? ['Option A', 'Option B', 'Option C', 'Option D'] :
                config.type === 'true-false' ? 'True' :
                    'Sample answer content',
            correctAnswer: config.type === 'multiple-choice' ? 'Option A' : 'True',
            loIndex,
            learningObjective: objective,
            generatedAt: new Date().toISOString()
          });
        }
      });
    });

    setTimeout(() => {
      setGeneratedQuestions(mockQuestions);
      setIsGenerating(false);
    }, 3000);
  };

  return (
      <div className="question-generation">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Auto Generation</h3>
            <p className="card-description">
              Generate a complete quiz based on your learning objectives and pedagogical approach
            </p>
          </div>

          <div className="pedagogical-approaches">
            <h4>Choose Pedagogical Approach</h4>
            <div className="approaches-grid">
              {pedagogicalApproaches.map((app) => (
                  <div
                      key={app.id}
                      className={`approach-card ${approach === app.id ? 'selected' : ''}`}
                      onClick={() => handleApproachSelect(app.id)}
                  >
                    <app.icon size={24} />
                    <h5>{app.title}</h5>
                    <p>{app.description}</p>
                    {app.id !== 'custom' && !showAdvancedEdit && approach === app.id && (
                        <button
                            className="btn btn-outline btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowAdvancedEdit(true);
                            }}
                        >
                          <Edit size={14} />
                          Advanced Edit
                        </button>
                    )}
                  </div>
              ))}
            </div>
          </div>

          {approach !== 'custom' && !showAdvancedEdit && (
              <div className="generation-settings">
                <div className="setting-group">
                  <label>Questions per Learning Objective: {questionsPerLO}</label>
                  <div className="questions-counter">
                    <button
                        className="btn btn-outline counter-btn"
                        onClick={() => setQuestionsPerLO(Math.max(1, questionsPerLO - 1))}
                    >
                      <Minus size={16} />
                    </button>
                    <span className="counter-value">{questionsPerLO}</span>
                    <button
                        className="btn btn-outline counter-btn"
                        onClick={() => setQuestionsPerLO(Math.min(10, questionsPerLO + 1))}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                <div className="setting-group">
                  <label>Total Questions: {learningObjectives.length * questionsPerLO}</label>
                  <p className="setting-description">
                    Based on {learningObjectives.length} learning objectives
                  </p>
                </div>
              </div>
          )}

          {(approach === 'custom' || showAdvancedEdit) && (
              <div className="advanced-edit">
                <div className="advanced-header">
                  <h4>Question Formula</h4>
                  {approach !== 'custom' && (
                      <button
                          className="btn btn-outline btn-sm"
                          onClick={() => setShowAdvancedEdit(false)}
                      >
                        Simple View
                      </button>
                  )}
                </div>

                <div className="question-types-config">
                  {(approach === 'custom' ? customQuestionTypes :
                          pedagogicalApproaches.find(app => app.id === approach)?.defaultTypes || []
                  ).map((config, index) => (
                      <div key={index} className="question-type-row">
                        <select
                            className="select-input"
                            value={config.type}
                            onChange={(e) => approach === 'custom'
                                ? updateQuestionType(index, 'type', e.target.value as QuestionType)
                                : null
                            }
                            disabled={approach !== 'custom'}
                        >
                          {questionTypes.map(type => (
                              <option key={type.id} value={type.id}>{type.label}</option>
                          ))}
                        </select>

                        <div className="count-input">
                          <button
                              className="btn btn-outline counter-btn"
                              onClick={() => approach === 'custom'
                                  ? updateQuestionType(index, 'count', Math.max(0, config.count - 1))
                                  : null
                              }
                              disabled={approach !== 'custom'}
                          >
                            <Minus size={14} />
                          </button>
                          <span className="counter-value">{config.count}</span>
                          <button
                              className="btn btn-outline counter-btn"
                              onClick={() => approach === 'custom'
                                  ? updateQuestionType(index, 'count', config.count + 1)
                                  : null
                              }
                              disabled={approach !== 'custom'}
                          >
                            <Plus size={14} />
                          </button>
                        </div>

                        {approach === 'custom' && (
                            <button
                                className="btn btn-outline btn-sm"
                                onClick={() => removeQuestionType(index)}
                            >
                              Remove
                            </button>
                        )}
                      </div>
                  ))}

                  {approach === 'custom' && (
                      <button
                          className="btn btn-outline"
                          onClick={addQuestionType}
                      >
                        <Plus size={16} />
                        Add Question Type
                      </button>
                  )}
                </div>

                <div className="total-summary">
                  <p><strong>Total per Learning Objective:</strong> {getTotalQuestionsPerLO()} questions</p>
                  <p><strong>Total Quiz Questions:</strong> {learningObjectives.length * getTotalQuestionsPerLO()}</p>
                </div>
              </div>
          )}

          <div className="generation-action">
            {isGenerating ? (
                <div className="generating-state">
                  <div className="loading-spinner"></div>
                  <p>Generating questions for Learning Objective 1 of {learningObjectives.length}...</p>
                  <button className="btn btn-secondary">Cancel Generation</button>
                </div>
            ) : (
                <button className="btn btn-primary" onClick={handleGeneration}>
                  <Wand2 size={16} />
                  Generate Full Quiz ({learningObjectives.length * getTotalQuestionsPerLO()} questions)
                </button>
            )}
          </div>
        </div>

        {generatedQuestions.length > 0 && (
            <div className="generated-questions">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Generated Questions ({generatedQuestions.length})</h3>
                  <p className="card-description">
                    Questions generated successfully. Review and edit as needed.
                  </p>
                </div>

                <div className="questions-preview">
                  {generatedQuestions.slice(0, 3).map((question, index) => (
                      <div key={question.id} className="question-preview">
                        <div className="question-meta">
                          Q{index + 1} • {question.type.replace('-', ' ')} • {question.difficulty}
                        </div>
                        <div className="question-text">{question.question}</div>
                      </div>
                  ))}

                  {generatedQuestions.length > 3 && (
                      <div className="more-questions">
                        And {generatedQuestions.length - 3} more questions...
                      </div>
                  )}
                </div>
              </div>
            </div>
        )}
      </div>
  );
};

export default QuestionGeneration;