import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { questionsApi, Question } from '../../services/api';
import { ExtendedQuestion, questionTypes } from './reviewTypes';

interface MCOption {
  text: string;
  isCorrect: boolean;
  order?: number;
}

interface KeyPoint {
  title: string;
  explanation: string;
}

interface ManualQuestionFormState {
  type: string;
  difficulty: string;
  question: string;
  loIndex: number;
  options: MCOption[];
  correctAnswer: string;
  front: string;
  back: string;
  keyPoints: KeyPoint[];
}

import { LearningObjectiveData } from '../generation/generationTypes';

interface ManualQuestionFormProps {
  isOpen: boolean;
  onClose: () => void;
  quizId: string;
  learningObjectives: LearningObjectiveData[];
  onQuestionAdded: (question: ExtendedQuestion) => void;
  showNotification: (type: string, title: string, message: string) => void;
}

const ManualQuestionForm = ({ isOpen, onClose, quizId, learningObjectives, onQuestionAdded, showNotification }: ManualQuestionFormProps) => {
  const [newQuestion, setNewQuestion] = useState<ManualQuestionFormState>({
    type: 'multiple-choice',
    difficulty: 'moderate',
    question: '',
    loIndex: 0,
    options: [
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false }
    ],
    correctAnswer: 'true',
    front: '',
    back: '',
    keyPoints: [{ title: '', explanation: '' }]
  });

  const addManualQuestion = async () => {
    try {
      const learningObjectiveIds = learningObjectives.map((_, index) => `lo-${index}`);
      const learningObjectiveId = learningObjectiveIds[newQuestion.loIndex] || learningObjectiveIds[0];

      let questionText = '';
      let content: Question['content'] = {};
      let correctAnswer = '';

      switch (newQuestion.type) {
        case 'multiple-choice':
          questionText = newQuestion.question;
          content = {
            options: newQuestion.options.map((opt: MCOption, index: number) => ({
              text: opt.text,
              isCorrect: opt.isCorrect,
              order: index
            }))
          };
          correctAnswer = newQuestion.options.find((opt: MCOption) => opt.isCorrect)?.text || '';
          break;
        case 'true-false':
          questionText = newQuestion.question;
          correctAnswer = newQuestion.correctAnswer;
          content = {};
          break;
        case 'flashcard':
          questionText = newQuestion.front;
          content = { front: newQuestion.front, back: newQuestion.back };
          correctAnswer = newQuestion.back;
          break;
        case 'summary':
          questionText = newQuestion.question;
          content = {
            keyPoints: newQuestion.keyPoints.map((kp: KeyPoint, index: number) => ({
              title: kp.title,
              explanation: kp.explanation,
              order: index
            }))
          };
          correctAnswer = 'See key points';
          break;
        default:
          questionText = newQuestion.question;
          break;
      }

      const questionData = {
        quizId,
        learningObjectiveId,
        type: newQuestion.type,
        difficulty: newQuestion.difficulty,
        questionText,
        content,
        correctAnswer,
        explanation: 'Manually created question'
      };

      const result = await questionsApi.createQuestion(questionData);
      onQuestionAdded({ ...result.question, isEditing: false });

      // Reset form
      setNewQuestion({
        type: 'multiple-choice',
        difficulty: 'moderate',
        question: '',
        loIndex: 0,
        options: [
          { text: '', isCorrect: false },
          { text: '', isCorrect: false },
          { text: '', isCorrect: false },
          { text: '', isCorrect: false }
        ],
        correctAnswer: 'true',
        front: '',
        back: '',
        keyPoints: [{ title: '', explanation: '' }]
      });
      onClose();
      showNotification('success', 'Question Added', 'New question has been created');
    } catch (error) {
      console.error('Failed to add question:', error);
      showNotification('error', 'Add Failed', 'Failed to create new question');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="manual-add-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content add-question-modal-content">
        <div className="modal-header">
          <h4>Add New Question</h4>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="manual-add-form">
          <div className="form-row">
            <div className="form-field">
              <label>Question Type:</label>
              <select
                className="select-input"
                value={newQuestion.type}
                onChange={(e) => {
                  const type = e.target.value;
                  setNewQuestion({
                    type,
                    difficulty: newQuestion.difficulty,
                    question: '',
                    loIndex: newQuestion.loIndex,
                    options: [
                      { text: '', isCorrect: false },
                      { text: '', isCorrect: false },
                      { text: '', isCorrect: false },
                      { text: '', isCorrect: false }
                    ],
                    correctAnswer: 'true',
                    front: '',
                    back: '',
                    keyPoints: [{ title: '', explanation: '' }]
                  });
                }}
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
                {learningObjectives.map((obj, index) => {
                  const text = obj?.text || 'Unknown';
                  return (
                    <option key={index} value={index}>
                      LO {index + 1}: {text.substring(0, 30)}{text.length > 30 ? '...' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* MULTIPLE CHOICE */}
          {newQuestion.type === 'multiple-choice' && (
            <>
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
                <label>Answer Options:</label>
                <div className="multiple-choice-editor">
                  {newQuestion.options.map((option: MCOption, index: number) => (
                    <div key={index} className="option-editor">
                      <input
                        type="checkbox"
                        checked={option.isCorrect}
                        onChange={(e) => {
                          const updatedOptions = [...newQuestion.options];
                          updatedOptions[index].isCorrect = e.target.checked;
                          setNewQuestion({...newQuestion, options: updatedOptions});
                        }}
                        className="option-checkbox"
                      />
                      <input
                        type="text"
                        value={option.text}
                        onChange={(e) => {
                          const updatedOptions = [...newQuestion.options];
                          updatedOptions[index].text = e.target.value;
                          setNewQuestion({...newQuestion, options: updatedOptions});
                        }}
                        placeholder={`Option ${index + 1}`}
                        className="option-input"
                      />
                      {newQuestion.options.length > 2 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            const updatedOptions = newQuestion.options.filter((_: MCOption, i: number) => i !== index);
                            setNewQuestion({...newQuestion, options: updatedOptions});
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setNewQuestion({
                        ...newQuestion,
                        options: [...newQuestion.options, { text: '', isCorrect: false }]
                      });
                    }}
                  >
                    <Plus size={14} />
                    Add Option
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TRUE/FALSE */}
          {newQuestion.type === 'true-false' && (
            <>
              <div className="form-field">
                <label>Question:</label>
                <textarea
                  className="textarea"
                  placeholder="Enter your true/false question here..."
                  value={newQuestion.question}
                  onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                  rows={3}
                />
              </div>
              <div className="form-field">
                <label>Correct Answer:</label>
                <div className="true-false-editor">
                  <div className="tf-option">
                    <input
                      type="radio"
                      id="new-tf-true"
                      name="new-tf-answer"
                      value="true"
                      checked={String(newQuestion.correctAnswer).toLowerCase() === 'true'}
                      onChange={() => setNewQuestion({...newQuestion, correctAnswer: 'true'})}
                      className="tf-radio"
                    />
                    <label htmlFor="new-tf-true" className="tf-label">True</label>
                  </div>
                  <div className="tf-option">
                    <input
                      type="radio"
                      id="new-tf-false"
                      name="new-tf-answer"
                      value="false"
                      checked={String(newQuestion.correctAnswer).toLowerCase() === 'false'}
                      onChange={() => setNewQuestion({...newQuestion, correctAnswer: 'false'})}
                      className="tf-radio"
                    />
                    <label htmlFor="new-tf-false" className="tf-label">False</label>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* FLASHCARD */}
          {newQuestion.type === 'flashcard' && (
            <>
              <div className="form-field">
                <label>Front side (Question):</label>
                <textarea
                  className="textarea"
                  placeholder="Enter the question/front side content..."
                  value={newQuestion.front}
                  onChange={(e) => setNewQuestion({...newQuestion, front: e.target.value})}
                  rows={3}
                />
              </div>
              <div className="form-field">
                <label>Back side (Answer):</label>
                <textarea
                  className="textarea"
                  placeholder="Enter the answer/back side content..."
                  value={newQuestion.back}
                  onChange={(e) => setNewQuestion({...newQuestion, back: e.target.value})}
                  rows={3}
                />
              </div>
            </>
          )}

          {/* SUMMARY */}
          {newQuestion.type === 'summary' && (
            <>
              <div className="form-field">
                <label>Study Guide Title:</label>
                <textarea
                  className="textarea"
                  placeholder="Enter the study guide title/question..."
                  value={newQuestion.question}
                  onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                  rows={2}
                />
              </div>
              <div className="form-field">
                <label>Knowledge Points:</label>
                <div className="summary-keypoints-editor">
                  {newQuestion.keyPoints.map((keyPoint: KeyPoint, index: number) => (
                    <div key={index} className="keypoint-editor">
                      <input
                        type="text"
                        value={keyPoint.title}
                        onChange={(e) => {
                          const updatedKeyPoints = [...newQuestion.keyPoints];
                          updatedKeyPoints[index].title = e.target.value;
                          setNewQuestion({...newQuestion, keyPoints: updatedKeyPoints});
                        }}
                        placeholder="Key point title"
                        className="keypoint-title-input"
                      />
                      <textarea
                        value={keyPoint.explanation}
                        onChange={(e) => {
                          const updatedKeyPoints = [...newQuestion.keyPoints];
                          updatedKeyPoints[index].explanation = e.target.value;
                          setNewQuestion({...newQuestion, keyPoints: updatedKeyPoints});
                        }}
                        placeholder="Detailed explanation"
                        className="keypoint-explanation-input"
                        rows={2}
                      />
                      {newQuestion.keyPoints.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            const updatedKeyPoints = newQuestion.keyPoints.filter((_: KeyPoint, i: number) => i !== index);
                            setNewQuestion({...newQuestion, keyPoints: updatedKeyPoints});
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setNewQuestion({
                        ...newQuestion,
                        keyPoints: [...newQuestion.keyPoints, { title: '', explanation: '' }]
                      });
                    }}
                  >
                    <Plus size={14} />
                    Add Key Point
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button
              className="btn btn-primary"
              onClick={addManualQuestion}
              disabled={
                (newQuestion.type === 'multiple-choice' && (!newQuestion.question.trim() || !newQuestion.options.some((opt: MCOption) => opt.isCorrect))) ||
                (newQuestion.type === 'true-false' && !newQuestion.question.trim()) ||
                (newQuestion.type === 'flashcard' && (!newQuestion.front.trim() || !newQuestion.back.trim())) ||
                (newQuestion.type === 'summary' && (!newQuestion.question.trim() || !newQuestion.keyPoints.some((kp: KeyPoint) => kp.title.trim())))
              }
            >
              <Plus size={16} />
              Add Question
            </button>
            <button className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualQuestionForm;
