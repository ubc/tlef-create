import { useState, useEffect } from 'react';
import { Edit, Trash2, Plus, Eye, EyeOff, Save, RotateCcw, Wand2, Play, Download } from 'lucide-react';
import { questionsApi, Question } from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import '../styles/components/ReviewEdit.css';
import '../styles/components/InteractiveQuestions.css';

interface ReviewEditProps {
  quizId: string;
  learningObjectives: string[];
}

interface ExtendedQuestion extends Question {
  isEditing?: boolean;
}

const ReviewEdit = ({ quizId, learningObjectives }: ReviewEditProps) => {
  const [questions, setQuestions] = useState<ExtendedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const { showNotification } = usePubSub('ReviewEdit');

  const [viewMode, setViewMode] = useState<'edit' | 'interact'>('edit');
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

  // Load questions from database
  useEffect(() => {
    loadQuestions();
  }, [quizId]);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      const result = await questionsApi.getQuestions(quizId);
      console.log('📝 Loaded questions for review:', result.questions.length);
      setQuestions(result.questions.map(q => ({ ...q, isEditing: false })));
    } catch (error) {
      console.error('Failed to load questions:', error);
      showNotification('error', 'Load Failed', 'Failed to load questions for review');
    } finally {
      setLoading(false);
    }
  };

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
      ? questions.filter(q => {
          // Find the learning objective index by comparing text
          const loText = typeof q.learningObjective === 'string' ? q.learningObjective : (q.learningObjective as any)?.text;
          const targetLO = learningObjectives[filterByLO];
          return loText === targetLO;
        })
      : questions;

  const toggleEdit = (questionId: string) => {
    setQuestions(questions.map(q =>
        q._id === questionId ? { ...q, isEditing: !q.isEditing } : q
    ));
  };

  const deleteQuestion = async (questionId: string) => {
    try {
      await questionsApi.deleteQuestion(questionId);
      setQuestions(questions.filter(q => q._id !== questionId));
      showNotification('success', 'Question Deleted', 'Question has been removed');
    } catch (error) {
      console.error('Failed to delete question:', error);
      showNotification('error', 'Delete Failed', 'Failed to delete question');
    }
  };

  const updateQuestion = (questionId: string, field: keyof ExtendedQuestion, value: any) => {
    setQuestions(questions.map(q =>
        q._id === questionId ? { ...q, [field]: value } : q
    ));
  };

  const saveQuestion = async (questionId: string) => {
    try {
      const question = questions.find(q => q._id === questionId);
      if (!question) return;

      // Prepare the update data - only send changed fields
      const updates: Partial<Question> = {
        questionText: question.questionText,
        type: question.type,
        difficulty: question.difficulty,
        content: question.content,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation
      };

      const result = await questionsApi.updateQuestion(questionId, updates);
      
      // Update local state with the response
      setQuestions(questions.map(q =>
          q._id === questionId ? { ...result.question, isEditing: false } : q
      ));
      
      showNotification('success', 'Question Saved', 'Question has been updated');
    } catch (error) {
      console.error('Failed to save question:', error);
      showNotification('error', 'Save Failed', 'Failed to save question changes');
    }
  };

  const addManualQuestion = async () => {
    if (!newQuestion.question.trim()) return;

    try {
      // First, we need to get the learning objective ID
      // For now, let's assume we have access to learning objectives with IDs
      // In a real scenario, you'd fetch this from the learningObjectives API
      const learningObjectiveId = 'placeholder-lo-id'; // This needs to be the actual LO ID
      
      const questionData = {
        quizId,
        learningObjectiveId,
        type: newQuestion.type as any,
        difficulty: newQuestion.difficulty as any,
        questionText: newQuestion.question,
        content: {
          // Parse the answer based on question type
          ...(newQuestion.type === 'multiple-choice' && {
            options: newQuestion.answer.split('\n').map((text, index) => ({
              text: text.trim(),
              isCorrect: text.trim() === newQuestion.correctAnswer,
              order: index
            }))
          })
        },
        correctAnswer: newQuestion.correctAnswer,
        explanation: 'Manually created question'
      };

      const result = await questionsApi.createQuestion(questionData);
      setQuestions([...questions, { ...result.question, isEditing: false }]);
      
      setNewQuestion({
        type: 'multiple-choice',
        difficulty: 'moderate',
        question: '',
        answer: '',
        correctAnswer: '',
        loIndex: 0
      });
      setShowManualAdd(false);
      
      showNotification('success', 'Question Added', 'New question has been created');
    } catch (error) {
      console.error('Failed to add question:', error);
      showNotification('error', 'Add Failed', 'Failed to create new question');
    }
  };

  const regenerateQuestion = async (questionId: string) => {
    try {
      const result = await questionsApi.regenerateQuestion(questionId);
      setQuestions(questions.map(q =>
          q._id === questionId ? { ...result.question, isEditing: false } : q
      ));
      showNotification('success', 'Question Regenerated', 'Question has been regenerated using AI');
    } catch (error) {
      console.error('Failed to regenerate question:', error);
      showNotification('error', 'Regeneration Failed', 'Failed to regenerate question');
    }
  };

  // Interactive Question Component
  const InteractiveQuestion = ({ question, index }: { question: ExtendedQuestion; index: number }) => {
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [showAnswer, setShowAnswer] = useState(false);
    const [isFlipped, setIsFlipped] = useState(false);
    
    // State for different question types
    const [clozeAnswers, setClozeAnswers] = useState<string[]>([]);
    const [orderingItems, setOrderingItems] = useState<string[]>([]);
    const [matchingConnections, setMatchingConnections] = useState<{[key: string]: string}>({});
    const [draggedItem, setDraggedItem] = useState<string | null>(null);

    // Initialize ordering items when component mounts
    useEffect(() => {
      if (question.type === 'ordering' && question.content?.items) {
        setOrderingItems([...question.content.items]);
      }
    }, [question]);

    const handleAnswerSelect = (answer: string) => {
      setSelectedAnswer(answer);
      setShowAnswer(true);
    };

    const handleClozeAnswerChange = (index: number, value: string) => {
      const newAnswers = [...clozeAnswers];
      newAnswers[index] = value;
      setClozeAnswers(newAnswers);
    };

    const handleOrderingDrop = (fromIndex: number, toIndex: number) => {
      const newItems = [...orderingItems];
      const [movedItem] = newItems.splice(fromIndex, 1);
      newItems.splice(toIndex, 0, movedItem);
      setOrderingItems(newItems);
    };

    const handleMatchingConnection = (leftItem: string, rightItem: string) => {
      setMatchingConnections(prev => ({ ...prev, [leftItem]: rightItem }));
    };

    const checkOrderingAnswer = () => {
      const correct = question.content?.correctOrder;
      return JSON.stringify(orderingItems) === JSON.stringify(correct);
    };

    const checkMatchingAnswer = () => {
      const correctPairs = question.content?.matchingPairs || [];
      return correctPairs.every(([left, right]: [string, string]) => 
        matchingConnections[left] === right
      );
    };

    const checkClozeAnswers = () => {
      const correctAnswers = question.content?.correctAnswers || [];
      return clozeAnswers.every((answer, index) => 
        answer.toLowerCase() === correctAnswers[index]?.toLowerCase()
      );
    };

    const isCorrect = (answer: string) => {
      if (question.type === 'multiple-choice' && question.content?.options) {
        const option = question.content.options.find((opt: any) => opt.text === answer);
        return option?.isCorrect;
      }
      if (question.type === 'true-false') {
        return answer === question.correctAnswer;
      }
      return false;
    };

    return (
      <div className="interactive-question">
        <div className="question-header">
          <span className="question-number">Q{index + 1}</span>
          <span className="question-type">{question.type.replace('-', ' ')}</span>
          <span className="question-difficulty">{question.difficulty}</span>
        </div>

        {question.type === 'flashcard' ? (
          <div className={`flashcard ${isFlipped ? 'flipped' : ''}`} onClick={() => setIsFlipped(!isFlipped)}>
            <div className="flashcard-inner">
              <div className="flashcard-front">
                <div className="flashcard-content">
                  <p>{question.content?.front || question.questionText}</p>
                  <div className="flip-hint">Click to reveal answer</div>
                </div>
              </div>
              <div className="flashcard-back">
                <div className="flashcard-content">
                  <p>{question.content?.back || question.correctAnswer}</p>
                  <div className="flip-hint">Click to return</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="standard-question">
            <div className="question-text">{question.questionText}</div>
            
            <div className="question-options">
              {question.type === 'multiple-choice' && question.content?.options && 
                question.content.options.map((option: any, idx: number) => {
                  const isSelected = selectedAnswer === option.text;
                  const optionIsCorrect = option.isCorrect;
                  const showResult = showAnswer && isSelected;
                  
                  return (
                    <button
                      key={idx}
                      className={`option-button ${isSelected ? 'selected' : ''} ${showResult ? (optionIsCorrect ? 'correct' : 'incorrect') : ''}`}
                      onClick={() => !showAnswer && handleAnswerSelect(option.text)}
                      disabled={showAnswer}
                    >
                      <span className="option-label">{String.fromCharCode(65 + idx)}</span>
                      <span className="option-text">{option.text}</span>
                      {showResult && (
                        <span className="option-result">
                          {optionIsCorrect ? '✓' : '✗'}
                        </span>
                      )}
                    </button>
                  );
                })
              }
              
              {question.type === 'true-false' && question.content?.options && 
                question.content.options.map((option: any, idx: number) => {
                  const isSelected = selectedAnswer === option.text;
                  const optionIsCorrect = option.isCorrect;
                  const showResult = showAnswer && isSelected;
                  
                  return (
                    <button
                      key={idx}
                      className={`tf-button ${isSelected ? 'selected' : ''} ${showResult ? (optionIsCorrect ? 'correct' : 'incorrect') : ''}`}
                      onClick={() => !showAnswer && handleAnswerSelect(option.text)}
                      disabled={showAnswer}
                    >
                      <span className="tf-text">{option.text}</span>
                      {showResult && (
                        <span className="tf-result">
                          {optionIsCorrect ? '✓' : '✗'}
                        </span>
                      )}
                    </button>
                  );
                })
              }

              {/* Summary Question - Show Answer Button */}
              {question.type === 'summary' && (
                <div className="summary-question">
                  <div className="answer-reveal">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAnswer(!showAnswer)}
                    >
                      {showAnswer ? 'Hide Answer' : 'Show Model Answer'}
                    </button>
                  </div>
                  {showAnswer && (
                    <div className="model-answer">
                      <div className="answer-section">
                        <strong>Model Answer:</strong>
                        <p>{question.correctAnswer}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Discussion Question - Show Answer Button */}
              {question.type === 'discussion' && (
                <div className="discussion-question">
                  <div className="answer-reveal">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAnswer(!showAnswer)}
                    >
                      {showAnswer ? 'Hide Answer' : 'Show Sample Response'}
                    </button>
                  </div>
                  {showAnswer && (
                    <div className="sample-response">
                      <div className="answer-section">
                        <strong>Sample Response:</strong>
                        <p>{question.correctAnswer}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Cloze (Fill in the blanks) Question - Dropdown Menus */}
              {question.type === 'cloze' && question.content?.blankOptions && (
                <div className="cloze-question">
                  <div className="cloze-text">
                    {question.content.textWithBlanks?.split('_____').map((part, partIndex) => (
                      <span key={partIndex}>
                        {part}
                        {partIndex < question.content.blankOptions.length && (
                          <select
                            className="cloze-dropdown"
                            value={clozeAnswers[partIndex] || ''}
                            onChange={(e) => handleClozeAnswerChange(partIndex, e.target.value)}
                          >
                            <option value="">Select...</option>
                            {question.content.blankOptions[partIndex]?.map((option: string, optIndex: number) => (
                              <option key={optIndex} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="cloze-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAnswer(true)}
                      disabled={clozeAnswers.some(answer => !answer)}
                    >
                      Check Answers
                    </button>
                  </div>
                  {showAnswer && (
                    <div className="cloze-results">
                      <div className={`answer-feedback ${checkClozeAnswers() ? 'correct' : 'incorrect'}`}>
                        {checkClozeAnswers() ? '✓ Correct!' : '✗ Some answers are incorrect'}
                      </div>
                      <div className="correct-answers">
                        <strong>Correct answers:</strong> {question.content.correctAnswers?.join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Ordering Question - Drag and Drop */}
              {question.type === 'ordering' && question.content?.items && (
                <div className="ordering-question">
                  <div className="ordering-instructions">
                    <p>Drag the items to arrange them in the correct order:</p>
                  </div>
                  <div className="ordering-container">
                    {orderingItems.map((item, index) => (
                      <div
                        key={index}
                        className="ordering-item"
                        draggable
                        onDragStart={() => setDraggedItem(item)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedItem) {
                            const dragIndex = orderingItems.indexOf(draggedItem);
                            handleOrderingDrop(dragIndex, index);
                            setDraggedItem(null);
                          }
                        }}
                      >
                        <span className="order-number">{index + 1}</span>
                        <span className="order-text">{item}</span>
                        <span className="drag-handle">⋮⋮</span>
                      </div>
                    ))}
                  </div>
                  <div className="ordering-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAnswer(true)}
                    >
                      Check Order
                    </button>
                  </div>
                  {showAnswer && (
                    <div className="ordering-results">
                      <div className={`answer-feedback ${checkOrderingAnswer() ? 'correct' : 'incorrect'}`}>
                        {checkOrderingAnswer() ? '✓ Correct order!' : '✗ Incorrect order'}
                      </div>
                      <div className="correct-order">
                        <strong>Correct order:</strong>
                        <ol>
                          {question.content.correctOrder?.map((item: string, idx: number) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Matching Question - Drag and Drop */}
              {question.type === 'matching' && question.content?.leftItems && question.content?.rightItems && (
                <div className="matching-question">
                  <div className="matching-instructions">
                    <p>Drag items from the right to match with items on the left:</p>
                  </div>
                  <div className="matching-container">
                    <div className="matching-left">
                      {question.content.leftItems.map((leftItem: string, index: number) => (
                        <div key={index} className="matching-left-item">
                          <div className="left-text">{leftItem}</div>
                          <div 
                            className="match-target"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (draggedItem) {
                                handleMatchingConnection(leftItem, draggedItem);
                                setDraggedItem(null);
                              }
                            }}
                          >
                            {matchingConnections[leftItem] || 'Drop here'}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="matching-right">
                      {question.content.rightItems.map((rightItem: string, index: number) => (
                        <div
                          key={index}
                          className="matching-right-item"
                          draggable
                          onDragStart={() => setDraggedItem(rightItem)}
                        >
                          {rightItem}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="matching-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAnswer(true)}
                      disabled={Object.keys(matchingConnections).length < question.content.leftItems.length}
                    >
                      Check Matches
                    </button>
                  </div>
                  {showAnswer && (
                    <div className="matching-results">
                      <div className={`answer-feedback ${checkMatchingAnswer() ? 'correct' : 'incorrect'}`}>
                        {checkMatchingAnswer() ? '✓ All matches correct!' : '✗ Some matches are incorrect'}
                      </div>
                      <div className="correct-matches">
                        <strong>Correct matches:</strong>
                        <ul>
                          {question.content.matchingPairs?.map(([left, right]: [string, string], idx: number) => (
                            <li key={idx}>{left} → {right}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {showAnswer && question.explanation && (
              <div className="explanation">
                <strong>Explanation:</strong> {question.explanation}
              </div>
            )}

            {!showAnswer && question.type !== 'flashcard' && (
              <div className="question-hint">
                Select an answer to see the result
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="review-edit">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Loading Questions...</h3>
            <p className="card-description">Please wait while we load your questions</p>
          </div>
          <div className="p-6 text-center">
            <div className="loading-spinner">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="review-edit">
        <div className="card">
          <div className="card-header">
            <div className="review-header">
              <div>
                <h3 className="card-title">Review & Edit Questions</h3>
                <p className="card-description">
                  Review generated questions and make final adjustments ({questions.length} questions loaded)
                </p>
              </div>
              <div className="review-actions">
                <button
                    className={`btn ${viewMode === 'interact' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setViewMode(viewMode === 'edit' ? 'interact' : 'edit')}
                >
                  {viewMode === 'edit' ? <Play size={16} /> : <Edit size={16} />}
                  {viewMode === 'edit' ? 'Interact' : 'Edit'}
                </button>
                {viewMode === 'edit' && (
                  <button
                      className="btn btn-outline"
                      onClick={() => setShowManualAdd(true)}
                  >
                    <Plus size={16} />
                    Add Question
                  </button>
                )}
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
            {filteredQuestions.length === 0 ? (
              <div className="no-questions">
                <p>No questions found. Generate questions from the Question Generation tab first, or add questions manually.</p>
                {viewMode === 'edit' && (
                  <button
                      className="btn btn-primary"
                      onClick={() => setShowManualAdd(true)}
                  >
                    <Plus size={16} />
                    Add First Question
                  </button>
                )}
              </div>
            ) : viewMode === 'interact' ? (
              // Interactive mode - show questions as interactive cards
              <div className="questions-interactive">
                {filteredQuestions.map((question, index) => (
                  <InteractiveQuestion key={question._id} question={question} index={index} />
                ))}
              </div>
            ) : (
              // Edit mode - show questions as editable list items
              filteredQuestions.map((question, index) => (
                <div key={question._id} className="question-item">
                  <div className="question-header">
                    <div className="question-meta">
                      <span className="question-number">Q{index + 1}</span>
                      <span className="question-type">{question.type.replace('-', ' ')}</span>
                      <span className="question-difficulty">{question.difficulty}</span>
                      <span className="question-lo">Order {question.order + 1}</span>
                    </div>
                    <div className="question-actions">
                      <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => regenerateQuestion(question._id)}
                          title="Regenerate question"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleEdit(question._id)}
                          title={question.isEditing ? 'Cancel edit' : 'Edit question'}
                      >
                        {question.isEditing ? <EyeOff size={14} /> : <Edit size={14} />}
                      </button>
                      <button
                          className="btn btn-ghost btn-sm text-destructive"
                          onClick={() => deleteQuestion(question._id)}
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
                              value={question.questionText}
                              onChange={(e) => updateQuestion(question._id, 'questionText', e.target.value)}
                              rows={3}
                          />
                        </div>

                        <div className="edit-row">
                          <div className="edit-field">
                            <label>Type:</label>
                            <select
                                className="select-input"
                                value={question.type}
                                onChange={(e) => updateQuestion(question._id, 'type', e.target.value)}
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
                                onChange={(e) => updateQuestion(question._id, 'difficulty', e.target.value)}
                            >
                              <option value="easy">Easy</option>
                              <option value="moderate">Moderate</option>
                              <option value="hard">Hard</option>
                            </select>
                          </div>
                        </div>

                        <div className="edit-field">
                          <label>Correct Answer:</label>
                          <textarea
                              className="textarea"
                              value={typeof question.correctAnswer === 'string' ? question.correctAnswer : JSON.stringify(question.correctAnswer)}
                              onChange={(e) => updateQuestion(question._id, 'correctAnswer', e.target.value)}
                              rows={2}
                          />
                        </div>

                        <div className="edit-field">
                          <label>Explanation (optional):</label>
                          <textarea
                              className="textarea"
                              value={question.explanation || ''}
                              onChange={(e) => updateQuestion(question._id, 'explanation', e.target.value)}
                              rows={2}
                          />
                        </div>

                        <div className="edit-actions">
                          <button
                              className="btn btn-primary btn-sm"
                              onClick={() => saveQuestion(question._id)}
                          >
                            <Save size={14} />
                            Save
                          </button>
                          <button
                              className="btn btn-outline btn-sm"
                              onClick={() => toggleEdit(question._id)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                  ) : (
                      <div className="question-display">
                        <div className="question-text">{question.questionText}</div>
                        <div className="question-answer">
                          <strong>Answer:</strong> {
                            typeof question.correctAnswer === 'string' 
                              ? question.correctAnswer 
                              : JSON.stringify(question.correctAnswer)
                          }
                        </div>
                        {question.explanation && (
                          <div className="question-explanation">
                            <strong>Explanation:</strong> {question.explanation}
                          </div>
                        )}
                      </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Export Section */}
          {filteredQuestions.length > 0 && (
            <div className="export-section">
              <div className="export-header">
                <h4>Export Quiz</h4>
                <p>Export your completed quiz for use in other platforms</p>
              </div>
              <div className="export-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => showNotification('info', 'Export Coming Soon', 'H5P and other export formats will be available soon!')}
                >
                  <Download size={16} />
                  Export to H5P
                </button>
                <button
                  className="btn btn-outline"
                  onClick={() => showNotification('info', 'Export Coming Soon', 'PDF export functionality will be available soon!')}
                >
                  <Download size={16} />
                  Export to PDF
                </button>
              </div>
            </div>
          )}

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