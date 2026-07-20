import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X, Wand2 } from 'lucide-react';
import { questionsApi, Question } from '../../services/api';
import { ExtendedQuestion } from './reviewTypes';
import { QuestionTypeOption } from '../../constants/questionTypeCapabilities';

interface MCOption {
  text: string;
  isCorrect: boolean;
  order?: number;
  tip?: string;
  chosenFeedback?: string;
  notChosenFeedback?: string;
}

interface KeyPoint {
  title: string;
  explanation: string;
}

interface ManualQuestionFormState {
  type: string;
  question: string;
  loIndex: number;
  options: MCOption[];
  selectionMode: 'single' | 'multiple';
  correctAnswer: string;
  front: string;
  back: string;
  keyPoints: KeyPoint[];
  // Matching
  leftItems: string[];
  rightItems: string[];
  // Ordering
  items: string[];
  // Cloze
  textWithBlanks: string;
}

import { LearningObjectiveData } from '../generation/generationTypes';

interface ManualQuestionFormProps {
  isOpen: boolean;
  onClose: () => void;
  quizId: string;
  learningObjectives: LearningObjectiveData[];
  availableQuestionTypes: QuestionTypeOption[];
  onQuestionAdded: (question: ExtendedQuestion) => void;
  onGenerateAI?: (loIndex: number, prompt: string, questionType: string) => Promise<void>;
  showNotification: (type: string, title: string, message: string) => void;
}

const createDefaultFormState = (defaultType: string): ManualQuestionFormState => ({
  type: defaultType,
  question: '',
  loIndex: 0,
  options: [
    { text: '', isCorrect: false, tip: '', chosenFeedback: '', notChosenFeedback: '' },
    { text: '', isCorrect: false, tip: '', chosenFeedback: '', notChosenFeedback: '' },
    { text: '', isCorrect: false, tip: '', chosenFeedback: '', notChosenFeedback: '' },
    { text: '', isCorrect: false, tip: '', chosenFeedback: '', notChosenFeedback: '' }
  ],
  selectionMode: 'single',
  correctAnswer: 'true',
  front: '',
  back: '',
  keyPoints: [{ title: '', explanation: '' }],
  leftItems: ['', ''],
  rightItems: ['', ''],
  items: ['', '', ''],
  textWithBlanks: ''
});

const ManualQuestionForm = ({ isOpen, onClose, quizId, learningObjectives, availableQuestionTypes, onQuestionAdded, onGenerateAI, showNotification }: ManualQuestionFormProps) => {
  const defaultQuestionType = useMemo(
    () => availableQuestionTypes[0]?.value || 'multiple-choice',
    [availableQuestionTypes]
  );
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');
  const [newQuestion, setNewQuestion] = useState<ManualQuestionFormState>(() => createDefaultFormState(defaultQuestionType));

  // AI mode state
  const [aiLoIndex, setAiLoIndex] = useState(-1);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiQuestionType, setAiQuestionType] = useState(defaultQuestionType);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!availableQuestionTypes.some(type => type.value === newQuestion.type)) {
      setNewQuestion(createDefaultFormState(defaultQuestionType));
    }

    if (!availableQuestionTypes.some(type => type.value === aiQuestionType)) {
      setAiQuestionType(defaultQuestionType);
    }
  }, [availableQuestionTypes, aiQuestionType, defaultQuestionType, newQuestion.type]);

  const resetForm = () => {
    setMode('manual');
    const nextDefaultState = createDefaultFormState(defaultQuestionType);
    setNewQuestion({
      ...nextDefaultState,
      options: nextDefaultState.options.map(o => ({ ...o })),
      keyPoints: nextDefaultState.keyPoints.map(k => ({ ...k })),
      leftItems: [...nextDefaultState.leftItems],
      rightItems: [...nextDefaultState.rightItems],
      items: [...nextDefaultState.items],
    });
    setAiLoIndex(-1);
    setAiPrompt('');
    setAiQuestionType(defaultQuestionType);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const addManualQuestion = async () => {
    try {
      const selectedLO = learningObjectives[newQuestion.loIndex] || learningObjectives[0];
      const learningObjectiveId = selectedLO?._id;

      let questionText = '';
      let content: Question['content'] = {};
      let correctAnswer = '';

      switch (newQuestion.type) {
        case 'multiple-choice':
          questionText = newQuestion.question;
          {
            const correctOptions = newQuestion.options.filter((opt: MCOption) => opt.isCorrect && opt.text.trim());
            const normalizedSelectionMode = newQuestion.selectionMode === 'multiple' || correctOptions.length > 1
              ? 'multiple'
              : 'single';
          content = {
            options: newQuestion.options.map((opt: MCOption, index: number) => ({
              text: opt.text,
              isCorrect: opt.isCorrect,
              order: index,
              tip: opt.tip || '',
              chosenFeedback: opt.chosenFeedback || '',
              notChosenFeedback: opt.notChosenFeedback || ''
            }))
              .filter((opt: MCOption) => opt.text.trim()),
            selectionMode: normalizedSelectionMode
          };
          correctAnswer = normalizedSelectionMode === 'multiple'
            ? correctOptions.map((opt: MCOption) => opt.text)
            : (correctOptions[0]?.text || '');
          }
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
        case 'matching': {
          questionText = newQuestion.question;
          const validLeftItems = newQuestion.leftItems.filter((s: string) => s.trim());
          const validRightItems = newQuestion.rightItems.filter((s: string) => s.trim());
          // Build pairs from same-position items, then shuffle rightItems for display
          const matchingPairs = validLeftItems
            .map((left: string, i: number) => [left, validRightItems[i] || ''])
            .filter(([l, r]: string[]) => l.trim() && r.trim());
          // Shuffle right items so students don't see them in order
          const shuffledRight = [...validRightItems].sort(() => Math.random() - 0.5);
          content = {
            leftItems: validLeftItems,
            rightItems: shuffledRight,
            matchingPairs
          };
          correctAnswer = 'See matching pairs';
          break;
        }
        case 'ordering': {
          questionText = newQuestion.question;
          const correctOrder = newQuestion.items.filter((s: string) => s.trim());
          // Shuffle items for display; correctOrder preserves the answer
          const shuffledItems = [...correctOrder].sort(() => Math.random() - 0.5);
          content = {
            items: shuffledItems,
            correctOrder
          };
          correctAnswer = 'See correct order';
          break;
        }
        case 'cloze':
          questionText = newQuestion.textWithBlanks;
          content = {
            textWithBlanks: newQuestion.textWithBlanks,
            blankOptions: [],
            correctAnswers: (newQuestion.textWithBlanks.match(/\$([^$]+)\$/g) || []).map((m: string) => m.replace(/\$/g, ''))
          };
          correctAnswer = 'See blanks';
          break;
        default:
          questionText = newQuestion.question;
          break;
      }

      const questionData = {
        quizId,
        learningObjectiveId,
        type: newQuestion.type,
        difficulty: 'moderate',
        questionText,
        content,
        correctAnswer,
        explanation: 'Manually created question'
      };

      const result = await questionsApi.createQuestion(questionData);
      onQuestionAdded({ ...result.question, isEditing: false });
      handleClose();
      showNotification('success', 'Question Added', 'New question has been created');
    } catch (error) {
      console.error('Failed to add question:', error);
      showNotification('error', 'Add Failed', 'Failed to create new question');
    }
  };

  const handleAISubmit = async () => {
    if (!onGenerateAI) return;
    setAiLoading(true);
    try {
      await onGenerateAI(aiLoIndex, aiPrompt, aiQuestionType);
      handleClose();
    } catch (error) {
      console.error('Failed to generate AI question:', error);
      showNotification('error', 'Generation Failed', 'Failed to generate question with AI');
    } finally {
      setAiLoading(false);
    }
  };

  const isManualFormValid = () => {
    if (newQuestion.type === 'multiple-choice') {
      const validOptions = newQuestion.options.filter((opt: MCOption) => opt.text.trim());
      const validCorrectOptions = validOptions.filter((opt: MCOption) => opt.isCorrect);
      return newQuestion.question.trim()
        && validOptions.length >= 2
        && (newQuestion.selectionMode === 'multiple'
          ? validCorrectOptions.length >= 1
          : validCorrectOptions.length === 1);
    }
    if (newQuestion.type === 'true-false') return newQuestion.question.trim();
    if (newQuestion.type === 'flashcard') return newQuestion.front.trim() && newQuestion.back.trim();
    if (newQuestion.type === 'summary') return newQuestion.question.trim() && newQuestion.keyPoints.some((kp: KeyPoint) => kp.title.trim());
    if (newQuestion.type === 'matching') {
      return newQuestion.question.trim() &&
        newQuestion.leftItems.filter((s: string) => s.trim()).length >= 2 &&
        newQuestion.rightItems.filter((s: string) => s.trim()).length >= 2;
    }
    if (newQuestion.type === 'ordering') {
      return newQuestion.question.trim() && newQuestion.items.filter((s: string) => s.trim()).length >= 2;
    }
    if (newQuestion.type === 'cloze') {
      return newQuestion.textWithBlanks.trim() && newQuestion.textWithBlanks.includes('$');
    }
    return newQuestion.question.trim();
  };

  const isAIFormValid = () => {
    if (aiLoIndex === -1) return aiPrompt.trim().length > 0;
    return true;
  };

  if (!isOpen) return null;

  return (
    <div className="manual-add-modal">
      <div className="modal-overlay" onClick={handleClose}></div>
      <div className="modal-content add-question-modal-content">
        <div className="modal-header">
          <h4>Add New Question</h4>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="aq-mode-selector">
          <button
            className={`aq-mode-btn ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => setMode('manual')}
          >
            <Plus size={18} />
            Manual Entry
          </button>
          <button
            className={`aq-mode-btn ${mode === 'ai' ? 'active' : ''}`}
            onClick={() => setMode('ai')}
            disabled={!onGenerateAI}
          >
            <Wand2 size={18} />
            AI Generate
          </button>
        </div>

        <div className="manual-add-form">
          {mode === 'manual' ? (
            <>
              {/* Question Type */}
              <div className="form-field">
                <label>Question Type</label>
                <select
                  className="select-input"
                  value={newQuestion.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    const nextDefaultState = createDefaultFormState(type);
                    setNewQuestion({
                      ...nextDefaultState,
                      type,
                      loIndex: newQuestion.loIndex,
                      options: nextDefaultState.options.map(o => ({ ...o })),
                      keyPoints: nextDefaultState.keyPoints.map(k => ({ ...k })),
                      leftItems: [...nextDefaultState.leftItems],
                      rightItems: [...nextDefaultState.rightItems],
                      items: [...nextDefaultState.items],
                    });
                  }}
                >
                  {availableQuestionTypes.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              {/* Learning Objective - full width */}
              <div className="form-field">
                <label>Learning Objective</label>
                <select
                  className="select-input aq-lo-select"
                  value={newQuestion.loIndex}
                  onChange={(e) => setNewQuestion({...newQuestion, loIndex: parseInt(e.target.value)})}
                  title={learningObjectives[newQuestion.loIndex]?.text || ''}
                >
                  {learningObjectives.map((obj, index) => {
                    const text = obj?.text || 'Unknown';
                    return (
                      <option key={index} value={index}>
                        LO {index + 1}: {text}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* MULTIPLE CHOICE */}
              {newQuestion.type === 'multiple-choice' && (
                <>
                  <div className="form-field">
                    <label>Question</label>
                    <textarea
                      className="textarea"
                      placeholder="Enter your question here..."
                      value={newQuestion.question}
                      onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                      rows={3}
                    />
                  </div>
                  <div className="form-field">
                    <label>Answer Mode</label>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="radio"
                          name="manual-mc-selection-mode"
                          checked={newQuestion.selectionMode === 'single'}
                          onChange={() => {
                            const firstCorrectIndex = newQuestion.options.findIndex((option: MCOption) => option.isCorrect);
                            const updatedOptions = newQuestion.options.map((option: MCOption, index: number) => ({
                              ...option,
                              isCorrect: firstCorrectIndex === -1 ? false : index === firstCorrectIndex
                            }));
                            setNewQuestion({ ...newQuestion, selectionMode: 'single', options: updatedOptions });
                          }}
                        />
                        Single answer
                      </label>
                      <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="radio"
                          name="manual-mc-selection-mode"
                          checked={newQuestion.selectionMode === 'multiple'}
                          onChange={() => setNewQuestion({ ...newQuestion, selectionMode: 'multiple' })}
                        />
                        Multiple answers
                      </label>
                    </div>
                  </div>
                  <div className="form-field">
                    <label>Answer Options</label>
                    <div className="aq-options-list">
                      {newQuestion.options.map((option: MCOption, index: number) => (
                        <div key={index} className="aq-option-row" style={{ display: 'block' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                            <input
                              type={newQuestion.selectionMode === 'multiple' ? 'checkbox' : 'radio'}
                              name={newQuestion.selectionMode === 'multiple' ? undefined : 'manual-mc-correct-answer'}
                              checked={option.isCorrect}
                              onChange={(e) => {
                                const updatedOptions = [...newQuestion.options];
                                if (newQuestion.selectionMode === 'multiple') {
                                  updatedOptions[index] = { ...updatedOptions[index], isCorrect: e.target.checked };
                                } else {
                                  updatedOptions.forEach((existingOption, optionIndex) => {
                                    updatedOptions[optionIndex] = {
                                      ...existingOption,
                                      isCorrect: optionIndex === index
                                    };
                                  });
                                }
                                setNewQuestion({ ...newQuestion, options: updatedOptions });
                              }}
                              className="aq-option-checkbox"
                            />
                            <input
                              type="text"
                              value={option.text}
                              onChange={(e) => {
                                const updatedOptions = [...newQuestion.options];
                                updatedOptions[index] = { ...updatedOptions[index], text: e.target.value };
                                setNewQuestion({ ...newQuestion, options: updatedOptions });
                              }}
                              placeholder={`Option ${index + 1}`}
                              className="input aq-option-input"
                            />
                            {newQuestion.options.length > 2 && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm aq-remove-btn"
                                onClick={() => {
                                  const updatedOptions = newQuestion.options.filter((_: MCOption, i: number) => i !== index);
                                  setNewQuestion({ ...newQuestion, options: updatedOptions });
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                          <div style={{ marginTop: '8px', marginLeft: '32px', display: 'grid', gap: '8px' }}>
                            <input
                              type="text"
                              value={option.tip || ''}
                              onChange={(e) => {
                                const updatedOptions = [...newQuestion.options];
                                updatedOptions[index] = { ...updatedOptions[index], tip: e.target.value };
                                setNewQuestion({ ...newQuestion, options: updatedOptions });
                              }}
                              placeholder="Tip shown before checking answers"
                              className="input aq-option-input"
                            />
                            <input
                              type="text"
                              value={option.chosenFeedback || ''}
                              onChange={(e) => {
                                const updatedOptions = [...newQuestion.options];
                                updatedOptions[index] = { ...updatedOptions[index], chosenFeedback: e.target.value };
                                setNewQuestion({ ...newQuestion, options: updatedOptions });
                              }}
                              placeholder="Feedback shown if this option is selected"
                              className="input aq-option-input"
                            />
                            <input
                              type="text"
                              value={option.notChosenFeedback || ''}
                              onChange={(e) => {
                                const updatedOptions = [...newQuestion.options];
                                updatedOptions[index] = { ...updatedOptions[index], notChosenFeedback: e.target.value };
                                setNewQuestion({ ...newQuestion, options: updatedOptions });
                              }}
                              placeholder="Feedback shown if this option is not selected"
                              className="input aq-option-input"
                            />
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-outline btn-sm aq-add-option-btn"
                        onClick={() => {
                          setNewQuestion({
                            ...newQuestion,
                            options: [...newQuestion.options, {
                              text: '',
                              isCorrect: false,
                              tip: '',
                              chosenFeedback: '',
                              notChosenFeedback: ''
                            }]
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
                    <label>Question</label>
                    <textarea
                      className="textarea"
                      placeholder="Enter your true/false question here..."
                      value={newQuestion.question}
                      onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                      rows={3}
                    />
                  </div>
                  <div className="form-field">
                    <label>Correct Answer</label>
                    <div className="aq-tf-options">
                      <div
                        className={`aq-tf-option ${String(newQuestion.correctAnswer).toLowerCase() === 'true' ? 'selected' : ''}`}
                        onClick={() => setNewQuestion({...newQuestion, correctAnswer: 'true'})}
                      >
                        <input
                          type="radio"
                          id="new-tf-true"
                          name="new-tf-answer"
                          value="true"
                          checked={String(newQuestion.correctAnswer).toLowerCase() === 'true'}
                          onChange={() => setNewQuestion({...newQuestion, correctAnswer: 'true'})}
                        />
                        <label htmlFor="new-tf-true">True</label>
                      </div>
                      <div
                        className={`aq-tf-option ${String(newQuestion.correctAnswer).toLowerCase() === 'false' ? 'selected' : ''}`}
                        onClick={() => setNewQuestion({...newQuestion, correctAnswer: 'false'})}
                      >
                        <input
                          type="radio"
                          id="new-tf-false"
                          name="new-tf-answer"
                          value="false"
                          checked={String(newQuestion.correctAnswer).toLowerCase() === 'false'}
                          onChange={() => setNewQuestion({...newQuestion, correctAnswer: 'false'})}
                        />
                        <label htmlFor="new-tf-false">False</label>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* FLASHCARD */}
              {newQuestion.type === 'flashcard' && (
                <>
                  <div className="form-field">
                    <label>Front (Question)</label>
                    <textarea
                      className="textarea"
                      placeholder="Enter the question/front side content..."
                      value={newQuestion.front}
                      onChange={(e) => setNewQuestion({...newQuestion, front: e.target.value})}
                      rows={3}
                    />
                  </div>
                  <div className="form-field">
                    <label>Back (Answer)</label>
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
                    <label>Study Guide Title</label>
                    <textarea
                      className="textarea"
                      placeholder="Enter the study guide title/question..."
                      value={newQuestion.question}
                      onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                      rows={2}
                    />
                  </div>
                  <div className="form-field">
                    <label>Key Points</label>
                    <div className="aq-keypoints-list">
                      {newQuestion.keyPoints.map((keyPoint: KeyPoint, index: number) => (
                        <div key={index} className="aq-keypoint-item">
                          <div className="aq-keypoint-header">
                            <span className="aq-keypoint-label">Key Point {index + 1}</span>
                            {newQuestion.keyPoints.length > 1 && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm aq-remove-btn"
                                onClick={() => {
                                  const updatedKeyPoints = newQuestion.keyPoints.filter((_: KeyPoint, i: number) => i !== index);
                                  setNewQuestion({...newQuestion, keyPoints: updatedKeyPoints});
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                          <input
                            type="text"
                            value={keyPoint.title}
                            onChange={(e) => {
                              const updatedKeyPoints = [...newQuestion.keyPoints];
                              updatedKeyPoints[index] = { ...updatedKeyPoints[index], title: e.target.value };
                              setNewQuestion({...newQuestion, keyPoints: updatedKeyPoints});
                            }}
                            placeholder="Key point title"
                            className="input"
                          />
                          <textarea
                            value={keyPoint.explanation}
                            onChange={(e) => {
                              const updatedKeyPoints = [...newQuestion.keyPoints];
                              updatedKeyPoints[index] = { ...updatedKeyPoints[index], explanation: e.target.value };
                              setNewQuestion({...newQuestion, keyPoints: updatedKeyPoints});
                            }}
                            placeholder="Detailed explanation"
                            className="textarea"
                            rows={2}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-outline btn-sm aq-add-option-btn"
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

              {/* DISCUSSION */}
              {newQuestion.type === 'discussion' && (
                <div className="form-field">
                  <label>Discussion Question</label>
                  <textarea
                    className="textarea"
                    placeholder="Enter a thought-provoking discussion question..."
                    value={newQuestion.question}
                    onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                    rows={4}
                  />
                  <p className="aq-hint">Discussion questions encourage critical thinking and don't have a single correct answer.</p>
                </div>
              )}

              {/* MATCHING */}
              {newQuestion.type === 'matching' && (
                <>
                  <div className="form-field">
                    <label>Question</label>
                    <textarea
                      className="textarea"
                      placeholder="Enter instructions for the matching question..."
                      value={newQuestion.question}
                      onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                      rows={2}
                    />
                  </div>
                  <div className="aq-matching-columns">
                    <div className="form-field">
                      <label>Left Column</label>
                      <div className="aq-options-list">
                        {newQuestion.leftItems.map((item: string, index: number) => (
                          <div key={index} className="aq-option-row">
                            <input
                              type="text"
                              value={item}
                              onChange={(e) => {
                                const updated = [...newQuestion.leftItems];
                                updated[index] = e.target.value;
                                setNewQuestion({...newQuestion, leftItems: updated});
                              }}
                              placeholder={`Item ${index + 1}`}
                              className="input aq-option-input"
                            />
                            {newQuestion.leftItems.length > 2 && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm aq-remove-btn"
                                onClick={() => setNewQuestion({...newQuestion, leftItems: newQuestion.leftItems.filter((_: string, i: number) => i !== index)})}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn btn-outline btn-sm aq-add-option-btn"
                          onClick={() => setNewQuestion({...newQuestion, leftItems: [...newQuestion.leftItems, '']})}
                        >
                          <Plus size={14} /> Add Item
                        </button>
                      </div>
                    </div>
                    <div className="form-field">
                      <label>Right Column (Matches)</label>
                      <div className="aq-options-list">
                        {newQuestion.rightItems.map((item: string, index: number) => (
                          <div key={index} className="aq-option-row">
                            <input
                              type="text"
                              value={item}
                              onChange={(e) => {
                                const updated = [...newQuestion.rightItems];
                                updated[index] = e.target.value;
                                setNewQuestion({...newQuestion, rightItems: updated});
                              }}
                              placeholder={`Match ${index + 1}`}
                              className="input aq-option-input"
                            />
                            {newQuestion.rightItems.length > 2 && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm aq-remove-btn"
                                onClick={() => setNewQuestion({...newQuestion, rightItems: newQuestion.rightItems.filter((_: string, i: number) => i !== index)})}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn btn-outline btn-sm aq-add-option-btn"
                          onClick={() => setNewQuestion({...newQuestion, rightItems: [...newQuestion.rightItems, '']})}
                        >
                          <Plus size={14} /> Add Match
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="aq-hint">Items at the same position in left and right columns form a matching pair.</p>
                </>
              )}

              {/* ORDERING */}
              {newQuestion.type === 'ordering' && (
                <>
                  <div className="form-field">
                    <label>Question</label>
                    <textarea
                      className="textarea"
                      placeholder="Enter instructions (e.g., 'Put these events in chronological order')..."
                      value={newQuestion.question}
                      onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                      rows={2}
                    />
                  </div>
                  <div className="form-field">
                    <label>Items (in correct order)</label>
                    <p className="aq-hint">Enter items in the correct order. They will be shuffled for students.</p>
                    <div className="aq-options-list">
                      {newQuestion.items.map((item: string, index: number) => (
                        <div key={index} className="aq-option-row">
                          <span className="aq-order-number">{index + 1}.</span>
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => {
                              const updated = [...newQuestion.items];
                              updated[index] = e.target.value;
                              setNewQuestion({...newQuestion, items: updated});
                            }}
                            placeholder={`Step ${index + 1}`}
                            className="input aq-option-input"
                          />
                          {newQuestion.items.length > 2 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm aq-remove-btn"
                              onClick={() => setNewQuestion({...newQuestion, items: newQuestion.items.filter((_: string, i: number) => i !== index)})}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-outline btn-sm aq-add-option-btn"
                        onClick={() => setNewQuestion({...newQuestion, items: [...newQuestion.items, '']})}
                      >
                        <Plus size={14} /> Add Item
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* CLOZE TEST */}
              {newQuestion.type === 'cloze' && (
                <>
                  <div className="form-field">
                    <label>Text with Blanks</label>
                    <textarea
                      className="textarea"
                      placeholder="Use $ to mark blanks. Example: 'The capital of France is $Paris$. It is in $Europe$.'"
                      value={newQuestion.textWithBlanks}
                      onChange={(e) => setNewQuestion({...newQuestion, textWithBlanks: e.target.value})}
                      rows={6}
                    />
                    <p className="aq-hint">Wrap correct answers with $ symbols. Text between $ will become fill-in-the-blank answers.</p>
                  </div>
                  {newQuestion.textWithBlanks && (
                    <div className="form-field">
                      <label>Preview</label>
                      <div className="aq-cloze-preview">
                        {newQuestion.textWithBlanks.split(/\$([^$]+)\$/g).map((part: string, i: number) =>
                          i % 2 === 0 ? (
                            <span key={i}>{part}</span>
                          ) : (
                            <span key={i} className="aq-cloze-blank">______</span>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Generic editor for new question types */}
              {['mark-the-words', 'essay', 'free-text', 'open-ended', 'sort-paragraphs',
                'crossword', 'dictation', 'arithmetic-quiz', 'single-choice-set', 'simple-multi-choice',
                'question-set', 'branching-scenario', 'documentation-tool'].includes(newQuestion.type) && (
                <div className="form-field">
                  <label>
                    {newQuestion.type === 'mark-the-words' ? 'Text (wrap correct words with *asterisks*)' :
                     newQuestion.type === 'essay' ? 'Essay Task Description' :
                     newQuestion.type === 'crossword' ? 'Crossword Clues & Words' :
                     newQuestion.type === 'sort-paragraphs' ? 'Paragraphs (in correct order, one per line)' :
                     newQuestion.type === 'dictation' ? 'Sentences (one per line)' :
                     newQuestion.type === 'question-set' ? 'Question Set Description' :
                     newQuestion.type === 'branching-scenario' ? 'Branching Scenario Description' :
                     newQuestion.type === 'documentation-tool' ? 'Documentation Task Description' :
                     'Question'}
                  </label>
                  <textarea
                    className="textarea"
                    placeholder={
                      newQuestion.type === 'mark-the-words' ? 'The process of *photosynthesis* converts *sunlight* into energy...' :
                      newQuestion.type === 'essay' ? 'Describe the main factors that influence...' :
                      newQuestion.type === 'sort-paragraphs' ? 'Enter each paragraph on a new line in the correct order' :
                      newQuestion.type === 'crossword' ? 'WORD:Clue for the word (one per line)' :
                      newQuestion.type === 'dictation' ? 'Enter sentences, one per line' :
                      newQuestion.type === 'question-set' ? 'Describe the question set you want to add...' :
                      newQuestion.type === 'branching-scenario' ? 'Describe the branching scenario prompt and choices...' :
                      newQuestion.type === 'documentation-tool' ? 'Describe the documentation activity...' :
                      'Enter your question here...'
                    }
                    value={newQuestion.question}
                    onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                    rows={6}
                  />
                  <p className="aq-hint">
                    {newQuestion.type === 'mark-the-words' ? 'Wrap each correct word separately: *normal* *force*, not *normal force*.' :
                     newQuestion.type === 'essay' ? 'Students write a longer response.' :
                     newQuestion.type === 'free-text' || newQuestion.type === 'open-ended' ? 'Open-ended, no single correct answer.' :
                     newQuestion.type === 'sort-paragraphs' ? 'Students rearrange into correct order.' :
                     newQuestion.type === 'crossword' ? 'Words arranged into a crossword automatically.' :
                     newQuestion.type === 'dictation' ? 'Students type sentences from memory.' :
                     newQuestion.type === 'question-set' ? 'A grouped set of questions.' :
                     newQuestion.type === 'branching-scenario' ? 'Students choose paths through a scenario.' :
                     newQuestion.type === 'documentation-tool' ? 'Students document goals, progress, or reflections.' :
                     ''}
                  </p>
                </div>
              )}

              <div className="modal-actions">
                <button className="btn btn-outline" onClick={handleClose}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={addManualQuestion}
                  disabled={!isManualFormValid()}
                >
                  <Plus size={16} />
                  Add Question
                </button>
              </div>
            </>
          ) : (
            /* AI MODE */
            <>
              <div className="form-field">
                <label>Learning Objective</label>
                <select
                  className="select-input aq-lo-select"
                  value={aiLoIndex}
                  onChange={(e) => setAiLoIndex(parseInt(e.target.value))}
                  title={aiLoIndex >= 0 && learningObjectives[aiLoIndex] ? `LO ${aiLoIndex + 1}: ${learningObjectives[aiLoIndex].text}` : 'No LO reference'}
                >
                  <option value={-1}>Custom Prompt (No LO reference)</option>
                  {learningObjectives.map((obj, index) => {
                    const text = obj?.text || 'Unknown';
                    return (
                      <option key={index} value={index}>
                        LO {index + 1}: {text}
                      </option>
                    );
                  })}
                </select>
                {aiLoIndex === -1 && (
                  <p className="aq-hint">No learning objective selected — a custom prompt is required below.</p>
                )}
              </div>

              <div className="form-field">
                <label>Question Type</label>
                <select
                  className="select-input"
                  value={aiQuestionType}
                  onChange={(e) => setAiQuestionType(e.target.value)}
                >
                  {availableQuestionTypes.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Custom Prompt {aiLoIndex === -1 ? '(required)' : '(optional)'}</label>
                <textarea
                  className="textarea"
                  placeholder={aiLoIndex === -1
                    ? "Describe what you want the question to be about... (required)"
                    : "Optionally add instructions to refine the AI output..."}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={4}
                />
                {aiLoIndex >= 0 && (
                  <p className="aq-hint">Leave empty to generate based on the selected LO, or add instructions to customize.</p>
                )}
              </div>

              <div className="modal-actions">
                <button className="btn btn-outline" onClick={handleClose}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleAISubmit}
                  disabled={!isAIFormValid() || aiLoading}
                >
                  {aiLoading ? (
                    <>Generating...</>
                  ) : (
                    <>
                      <Wand2 size={16} />
                      Generate Question
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManualQuestionForm;
