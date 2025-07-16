import { useState } from 'react';
import { Edit, Trash2, Plus, Eye, EyeOff, Save, RotateCcw, Wand2 } from 'lucide-react';
import '../styles/components/ReviewEdit.css';

interface ReviewEditProps {
  quizId: string;
  learningObjectives: string[];
}

interface Question {
  id: string;
  type: string;
  difficulty: string;
  question: string;
  answer: string | string[];
  correctAnswer?: string;
  loIndex: number;
  learningObjective: string;
  isEditing?: boolean;
}

const ReviewEdit = ({ quizId, learningObjectives }: ReviewEditProps) => {
  const [questions, setQuestions] = useState<Question[]>([
    {
      id: '1',
      type: 'multiple-choice',
      difficulty: 'moderate',
      question: 'What is the primary function of mitochondria in a cell?',
      answer: ['Protein synthesis', 'Energy production', 'DNA replication', 'Cell division'],
      correctAnswer: 'Energy production',
      loIndex: 0,
      learningObjective: learningObjectives[0] || 'Sample Learning Objective'
    },
    {
      id: '2',
      type: 'true-false',
      difficulty: 'easy',
      question: 'Photosynthesis occurs only in plant leaves.',
      answer: 'False',
      correctAnswer: 'False',
      loIndex: 0,
      learningObjective: learningObjectives[0] || 'Sample Learning Objective'
    },
    {
      id: '3',
      type: 'flashcard',
      difficulty: 'moderate',
      question: 'Define cellular respiration and its importance.',
      answer: 'Cellular respiration is the process by which cells break down glucose and other molecules to produce ATP (energy) for cellular activities.',
      loIndex: 1,
      learningObjective: learningObjectives[1] || 'Sample Learning Objective 2'
    }
  ]);

  const [showManualAdd, setShowManualAdd] = useState(false);
  const [filterByLO, setFilterByLO] = useState<number | null>(null);
  const [newQuestion, setNewQuestion] = useState({
    type: 'multiple-choice',
    difficulty: 'moderate',
    question: '',
    answer: '',
    correctAnswer: '',
    loIndex: 0
  });

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

  const filteredQuestions = filterByLO !== null
      ? questions.filter(q => q.loIndex === filterByLO)
      : questions;

  const toggleEdit = (questionId: string) => {
    setQuestions(questions.map(q =>
        q.id === questionId ? { ...q, isEditing: !q.isEditing } : q
    ));
  };

  const deleteQuestion = (questionId: string) => {
    setQuestions(questions.filter(q => q.id !== questionId));
  };

  const updateQuestion = (questionId: string, field: keyof Question, value: any) => {
    setQuestions(questions.map(q =>
        q.id === questionId ? { ...q, [field]: value } : q
    ));
  };

  const saveQuestion = (questionId: string) => {
    setQuestions(questions.map(q =>
        q.id === questionId ? { ...q, isEditing: false } : q
    ));
  };

  const addManualQuestion = () => {
    if (!newQuestion.question.trim()) return;

    const question: Question = {
      id: Date.now().toString(),
      type: newQuestion.type,
      difficulty: newQuestion.difficulty,
      question: newQuestion.question,
      answer: newQuestion.answer,
      correctAnswer: newQuestion.correctAnswer,
      loIndex: newQuestion.loIndex,
      learningObjective: learningObjectives[newQuestion.loIndex] || 'Custom Question'
    };

    setQuestions([...questions, question]);
    setNewQuestion({
      type: 'multiple-choice',
      difficulty: 'moderate',
      question: '',
      answer: '',
      correctAnswer: '',
      loIndex: 0
    });
    setShowManualAdd(false);
  };

  const regenerateQuestion = (questionId: string) => {
    // Mock regeneration
    const question = questions.find(q => q.id === questionId);
    if (question) {
      updateQuestion(questionId, 'question', `Regenerated: ${question.question}`);
    }
  };

  return (
      <div className="review-edit">
        <div className="card">
          <div className="card-header">
            <div className="review-header">
              <div>
                <h3 className="card-title">Review & Edit Questions</h3>
                <p className="card-description">
                  Review generated questions and make final adjustments
                </p>
              </div>
              <div className="review-actions">
                <button
                    className="btn btn-outline"
                    onClick={() => setShowManualAdd(true)}
                >
                  <Plus size={16} />
                  Add Question
                </button>
              </div>
            </div>
          </div>

          <div className="review-filters">
            <div className="filter-group">
              <label>Filter by Learning Objective:</label>
              <select
                  className="select-input"
                  value={filterByLO ?? ''}
                  onChange={(e) => setFilterByLO(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">All Objectives</option>
                {learningObjectives.map((obj, index) => (
                    <option key={index} value={index}>
                      LO {index + 1}: {obj.substring(0, 50)}...
                    </option>
                ))}
              </select>
            </div>
            <div className="questions-count">
              {filteredQuestions.length} questions {filterByLO !== null ? 'in this objective' : 'total'}
            </div>
          </div>

          <div className="questions-list">
            {filteredQuestions.map((question, index) => (
                <div key={question.id} className="question-item">
                  <div className="question-header">
                    <div className="question-meta">
                      <span className="question-number">Q{index + 1}</span>
                      <span className="question-type">{question.type.replace('-', ' ')}</span>
                      <span className="question-difficulty">{question.difficulty}</span>
                      <span className="question-lo">LO {question.loIndex + 1}</span>
                    </div>
                    <div className="question-actions">
                      <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => regenerateQuestion(question.id)}
                          title="Regenerate question"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleEdit(question.id)}
                          title={question.isEditing ? 'Cancel edit' : 'Edit question'}
                      >
                        {question.isEditing ? <EyeOff size={14} /> : <Edit size={14} />}
                      </button>
                      <button
                          className="btn btn-ghost btn-sm text-destructive"
                          onClick={() => deleteQuestion(question.id)}
                          title="Delete question"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {question.isEditing ? (
                      <div className="question-edit">
                        <div className="edit-field">
                          <label>Question:</label>
                          <textarea
                              className="textarea"
                              value={question.question}
                              onChange={(e) => updateQuestion(question.id, 'question', e.target.value)}
                              rows={3}
                          />
                        </div>

                        <div className="edit-row">
                          <div className="edit-field">
                            <label>Type:</label>
                            <select
                                className="select-input"
                                value={question.type}
                                onChange={(e) => updateQuestion(question.id, 'type', e.target.value)}
                            >
                              {questionTypes.map(type => (
                                  <option key={type.id} value={type.id}>{type.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="edit-field">
                            <label>Difficulty:</label>
                            <select
                                className="select-input"
                                value={question.difficulty}
                                onChange={(e) => updateQuestion(question.id, 'difficulty', e.target.value)}
                            >
                              <option value="easy">Easy</option>
                              <option value="moderate">Moderate</option>
                              <option value="hard">Hard</option>
                            </select>
                          </div>
                        </div>

                        <div className="edit-field">
                          <label>Answer:</label>
                          <textarea
                              className="textarea"
                              value={Array.isArray(question.answer) ? question.answer.join('\n') : question.answer}
                              onChange={(e) => updateQuestion(question.id, 'answer', e.target.value)}
                              rows={2}
                          />
                        </div>

                        <div className="edit-actions">
                          <button
                              className="btn btn-primary btn-sm"
                              onClick={() => saveQuestion(question.id)}
                          >
                            <Save size={14} />
                            Save
                          </button>
                          <button
                              className="btn btn-outline btn-sm"
                              onClick={() => toggleEdit(question.id)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                  ) : (
                      <div className="question-display">
                        <div className="question-text">{question.question}</div>
                        <div className="question-answer">
                          <strong>Answer:</strong> {
                          Array.isArray(question.answer)
                              ? question.answer.join(', ')
                              : question.answer
                        }
                        </div>
                      </div>
                  )}
                </div>
            ))}
          </div>

          {showManualAdd && (
              <div className="manual-add-modal">
                <div className="modal-overlay" onClick={() => setShowManualAdd(false)}></div>
                <div className="modal-content">
                  <div className="modal-header">
                    <h4>Add New Question</h4>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShowManualAdd(false)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="manual-add-form">
                    <div className="form-row">
                      <div className="form-field">
                        <label>Question Type:</label>
                        <select
                            className="select-input"
                            value={newQuestion.type}
                            onChange={(e) => setNewQuestion({...newQuestion, type: e.target.value})}
                        >
                          {questionTypes.map(type => (
                              <option key={type.id} value={type.id}>{type.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>Difficulty:</label>
                        <select
                            className="select-input"
                            value={newQuestion.difficulty}
                            onChange={(e) => setNewQuestion({...newQuestion, difficulty: e.target.value})}
                        >
                          <option value="easy">Easy</option>
                          <option value="moderate">Moderate</option>
                          <option value="hard">Hard</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label>Learning Objective:</label>
                        <select
                            className="select-input"
                            value={newQuestion.loIndex}
                            onChange={(e) => setNewQuestion({...newQuestion, loIndex: parseInt(e.target.value)})}
                        >
                          {learningObjectives.map((obj, index) => (
                              <option key={index} value={index}>
                                LO {index + 1}: {obj.substring(0, 30)}...
                              </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="form-field">
                      <label>Question:</label>
                      <textarea
                          className="textarea"
                          placeholder="Enter your question here..."
                          value={newQuestion.question}
                          onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                          rows={3}
                      />
                    </div>

                    <div className="form-field">
                      <label>Answer:</label>
                      <textarea
                          className="textarea"
                          placeholder="Enter the answer or options (one per line for multiple choice)..."
                          value={newQuestion.answer}
                          onChange={(e) => setNewQuestion({...newQuestion, answer: e.target.value})}
                          rows={3}
                      />
                    </div>

                    <div className="modal-actions">
                      <button
                          className="btn btn-primary"
                          onClick={addManualQuestion}
                          disabled={!newQuestion.question.trim()}
                      >
                        <Plus size={16} />
                        Add Question
                      </button>
                      <button
                          className="btn btn-outline"
                          onClick={() => setShowManualAdd(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
          )}
        </div>
      </div>
  );
};

export default ReviewEdit;