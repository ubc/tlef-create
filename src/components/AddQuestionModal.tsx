import { useState } from 'react';
import { X, Plus, Wand2 } from 'lucide-react';
import '../styles/components/AddQuestionModal.css';

interface Option {
  text: string;
  isCorrect: boolean;
}

interface KeyPoint {
  title: string;
  explanation: string;
}

interface QuestionEditorData {
  question: string;
  options: Option[];
  correctAnswer: string;
  front: string;
  back: string;
  keyPoints: KeyPoint[];
  leftItems: string[];
  rightItems: string[];
  matchingPairs: string[][];
  items: string[];
  textWithBlanks: string;
  blankOptions: string[][];
  clozeCorrectAnswers: string[];
}

interface QuestionEditorProps {
  data: QuestionEditorData;
  onChange: (data: QuestionEditorData) => void;
}

interface ManualSubmitData extends QuestionEditorData {
  type: string;
  loIndex: number;
}

interface AddQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddManual: (questionData: ManualSubmitData) => Promise<void>;
  onGenerateAI: (loIndex: number, prompt: string, questionType: string) => Promise<void>;
  learningObjectives: string[];
  isLoading?: boolean;
}

const AddQuestionModal = ({
  isOpen,
  onClose,
  onAddManual,
  onGenerateAI,
  learningObjectives,
  isLoading = false
}: AddQuestionModalProps) => {
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');
  
  // Manual mode state
  const [questionType, setQuestionType] = useState('multiple-choice');
  const [loIndex, setLoIndex] = useState(0);
  const [questionData, setQuestionData] = useState<QuestionEditorData>({
    question: '',
    options: [
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false }
    ],
    correctAnswer: 'true',
    front: '',
    back: '',
    keyPoints: [{ title: '', explanation: '' }],
    // Matching
    leftItems: ['', ''],
    rightItems: ['', ''],
    matchingPairs: [['', '']],
    // Ordering
    items: ['', '', ''],
    // Cloze
    textWithBlanks: '',
    blankOptions: [['']],
    clozeCorrectAnswers: ['']
  });

  // AI mode state
  const [aiLoIndex, setAiLoIndex] = useState(0);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiQuestionType, setAiQuestionType] = useState('multiple-choice');

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

  const resetForm = () => {
    setMode('manual');
    setQuestionType('multiple-choice');
    setLoIndex(0);
    setQuestionData({
      question: '',
      options: [
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false }
      ],
      correctAnswer: 'true',
      front: '',
      back: '',
      keyPoints: [{ title: '', explanation: '' }],
      leftItems: ['', ''],
      rightItems: ['', ''],
      matchingPairs: [['', '']],
      items: ['', '', ''],
      textWithBlanks: '',
      blankOptions: [['']],
      clozeCorrectAnswers: ['']
    });
    setAiLoIndex(0);
    setAiPrompt('');
    setAiQuestionType('multiple-choice');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleModeChange = (newMode: 'manual' | 'ai') => {
    setMode(newMode);
  };

  const handleTypeChange = (newType: string) => {
    setQuestionType(newType);
    // Reset question data when type changes
    setQuestionData({
      question: '',
      options: [
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false }
      ],
      correctAnswer: 'true',
      front: '',
      back: '',
      keyPoints: [{ title: '', explanation: '' }],
      leftItems: ['', ''],
      rightItems: ['', ''],
      matchingPairs: [['', '']],
      items: ['', '', ''],
      textWithBlanks: '',
      blankOptions: [['']],
      clozeCorrectAnswers: ['']
    });
  };

  const handleManualSubmit = async () => {
    const data = {
      type: questionType,
      loIndex,
      ...questionData
    };
    await onAddManual(data);
    handleClose();
  };

  const handleAISubmit = async () => {
    await onGenerateAI(aiLoIndex, aiPrompt, aiQuestionType);
    handleClose();
  };

  const isManualFormValid = () => {
    if (questionType === 'multiple-choice') {
      return questionData.question.trim() && questionData.options.some((opt: Option) => opt.isCorrect && opt.text.trim());
    }
    if (questionType === 'true-false') {
      return questionData.question.trim();
    }
    if (questionType === 'flashcard') {
      return questionData.front.trim() && questionData.back.trim();
    }
    if (questionType === 'summary') {
      return questionData.question.trim() && questionData.keyPoints.some((kp: KeyPoint) => kp.title.trim());
    }
    if (questionType === 'discussion') {
      return questionData.question.trim();
    }
    if (questionType === 'matching') {
      return questionData.question.trim() && 
             questionData.leftItems.some((item: string) => item.trim()) &&
             questionData.rightItems.some((item: string) => item.trim());
    }
    if (questionType === 'ordering') {
      return questionData.question.trim() && questionData.items.filter((item: string) => item.trim()).length >= 2;
    }
    if (questionType === 'cloze') {
      return questionData.textWithBlanks.trim() && questionData.textWithBlanks.includes('$');
    }
    return false;
  };

  const isAIFormValid = () => {
    return aiPrompt.trim().length > 0;
  };

  if (!isOpen) return null;

  return (
    <div className="add-question-modal">
      <div className="modal-overlay" onClick={handleClose}></div>
      <div className="modal-content">
        <div className="modal-header">
          <h3>Add New Question</h3>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        {/* Mode Selection */}
        <div className="mode-selector">
          <button
            className={`mode-btn ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => handleModeChange('manual')}
          >
            <Plus size={18} />
            Manual Entry
          </button>
          <button
            className={`mode-btn ${mode === 'ai' ? 'active' : ''}`}
            onClick={() => handleModeChange('ai')}
          >
            <Wand2 size={18} />
            AI Generate
          </button>
        </div>

        <div className="modal-body">
          {mode === 'manual' ? (
            <div className="manual-mode">
              {/* Question Type and LO Selection */}
              <div className="form-row">
                <div className="form-field">
                  <label>Question Type</label>
                  <select
                    className="select-input"
                    value={questionType}
                    onChange={(e) => handleTypeChange(e.target.value)}
                  >
                    {questionTypes.map(type => (
                      <option key={type.id} value={type.id}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>Learning Objective</label>
                  <select
                    className="select-input"
                    value={loIndex}
                    onChange={(e) => setLoIndex(parseInt(e.target.value))}
                  >
                    {learningObjectives.map((obj, index) => (
                      <option key={index} value={index}>
                        LO {index + 1}: {obj.substring(0, 40)}...
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Question Type Specific Fields */}
              {questionType === 'multiple-choice' && (
                <MultipleChoiceEditor
                  data={questionData}
                  onChange={setQuestionData}
                />
              )}

              {questionType === 'true-false' && (
                <TrueFalseEditor
                  data={questionData}
                  onChange={setQuestionData}
                />
              )}

              {questionType === 'flashcard' && (
                <FlashcardEditor
                  data={questionData}
                  onChange={setQuestionData}
                />
              )}

              {questionType === 'summary' && (
                <SummaryEditor
                  data={questionData}
                  onChange={setQuestionData}
                />
              )}

              {questionType === 'discussion' && (
                <DiscussionEditor
                  data={questionData}
                  onChange={setQuestionData}
                />
              )}

              {questionType === 'matching' && (
                <MatchingEditor
                  data={questionData}
                  onChange={setQuestionData}
                />
              )}

              {questionType === 'ordering' && (
                <OrderingEditor
                  data={questionData}
                  onChange={setQuestionData}
                />
              )}

              {questionType === 'cloze' && (
                <ClozeEditor
                  data={questionData}
                  onChange={setQuestionData}
                />
              )}
            </div>
          ) : (
            <div className="ai-mode">
              <div className="form-field">
                <label>Learning Objective</label>
                <select
                  className="select-input"
                  value={aiLoIndex}
                  onChange={(e) => setAiLoIndex(parseInt(e.target.value))}
                >
                  {learningObjectives.map((obj, index) => (
                    <option key={index} value={index}>
                      LO {index + 1}: {obj}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Question Type</label>
                <select
                  className="select-input"
                  value={aiQuestionType}
                  onChange={(e) => setAiQuestionType(e.target.value)}
                >
                  {questionTypes.map(type => (
                    <option key={type.id} value={type.id}>{type.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Generation Prompt</label>
                <textarea
                  className="textarea"
                  placeholder="Describe what you want the question to focus on... (e.g., 'Create a question about the practical applications of this concept')"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={6}
                />
                <p className="field-hint">
                  Provide specific instructions to guide the AI in generating the question.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={handleClose}>
            Cancel
          </button>
          {mode === 'manual' ? (
            <button
              className="btn btn-primary"
              onClick={handleManualSubmit}
              disabled={!isManualFormValid() || isLoading}
            >
              <Plus size={16} />
              Add Question
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleAISubmit}
              disabled={!isAIFormValid() || isLoading}
            >
              <Wand2 size={16} />
              Generate Question
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Multiple Choice Editor Component
const MultipleChoiceEditor = ({ data, onChange }: QuestionEditorProps) => {
  const updateOption = (index: number, field: string, value: string | boolean) => {
    const updatedOptions = [...data.options];
    updatedOptions[index] = { ...updatedOptions[index], [field]: value };
    onChange({ ...data, options: updatedOptions });
  };

  const addOption = () => {
    onChange({
      ...data,
      options: [...data.options, { text: '', isCorrect: false }]
    });
  };

  const removeOption = (index: number) => {
    if (data.options.length > 2) {
      const updatedOptions = data.options.filter((_: Option, i: number) => i !== index);
      onChange({ ...data, options: updatedOptions });
    }
  };

  return (
    <>
      <div className="form-field">
        <label>Question</label>
        <textarea
          className="textarea"
          placeholder="Enter your question here..."
          value={data.question}
          onChange={(e) => onChange({ ...data, question: e.target.value })}
          rows={3}
        />
      </div>

      <div className="form-field">
        <label>Answer Options</label>
        <div className="multiple-choice-editor">
          {data.options.map((option: Option, index: number) => (
            <div key={index} className="option-editor">
              <div className="option-input-group">
                <input
                  type="radio"
                  name="correct-answer"
                  checked={option.isCorrect}
                  onChange={() => {
                    const updatedOptions = data.options.map((opt: Option, i: number) => ({
                      ...opt,
                      isCorrect: i === index
                    }));
                    onChange({ ...data, options: updatedOptions });
                  }}
                  className="option-radio"
                />
                <textarea
                  className="option-text-input"
                  value={option.text}
                  onChange={(e) => updateOption(index, 'text', e.target.value)}
                  placeholder={`Option ${index + 1}`}
                  rows={2}
                />
                {data.options.length > 2 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm remove-option"
                    onClick={() => removeOption(index)}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {option.isCorrect && (
                <div className="option-hint">✓ Correct Answer</div>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-outline btn-sm add-option"
            onClick={addOption}
          >
            <Plus size={14} />
            Add Option
          </button>
        </div>
      </div>
    </>
  );
};

// True/False Editor Component
const TrueFalseEditor = ({ data, onChange }: QuestionEditorProps) => {
  return (
    <>
      <div className="form-field">
        <label>Question</label>
        <textarea
          className="textarea"
          placeholder="Enter your true/false question here..."
          value={data.question}
          onChange={(e) => onChange({ ...data, question: e.target.value })}
          rows={3}
        />
      </div>

      <div className="form-field">
        <label>Correct Answer</label>
        <div className="true-false-editor">
          <div
            className={`tf-option ${data.correctAnswer === 'true' ? 'selected' : ''}`}
            onClick={() => onChange({ ...data, correctAnswer: 'true' })}
          >
            <input
              type="radio"
              name="tf-answer"
              checked={data.correctAnswer === 'true'}
              onChange={() => onChange({ ...data, correctAnswer: 'true' })}
            />
            <label className="tf-label">True</label>
          </div>
          <div
            className={`tf-option ${data.correctAnswer === 'false' ? 'selected' : ''}`}
            onClick={() => onChange({ ...data, correctAnswer: 'false' })}
          >
            <input
              type="radio"
              name="tf-answer"
              checked={data.correctAnswer === 'false'}
              onChange={() => onChange({ ...data, correctAnswer: 'false' })}
            />
            <label className="tf-label">False</label>
          </div>
        </div>
      </div>
    </>
  );
};

// Flashcard Editor Component
const FlashcardEditor = ({ data, onChange }: QuestionEditorProps) => {
  return (
    <>
      <div className="form-field">
        <label>Front (Question)</label>
        <textarea
          className="textarea"
          placeholder="Enter the question/front side content..."
          value={data.front}
          onChange={(e) => onChange({ ...data, front: e.target.value })}
          rows={3}
        />
      </div>

      <div className="form-field">
        <label>Back (Answer)</label>
        <textarea
          className="textarea"
          placeholder="Enter the answer/back side content..."
          value={data.back}
          onChange={(e) => onChange({ ...data, back: e.target.value })}
          rows={3}
        />
      </div>
    </>
  );
};

// Summary Editor Component
const SummaryEditor = ({ data, onChange }: QuestionEditorProps) => {
  const updateKeyPoint = (index: number, field: string, value: string) => {
    const updatedKeyPoints = [...data.keyPoints];
    updatedKeyPoints[index] = { ...updatedKeyPoints[index], [field]: value };
    onChange({ ...data, keyPoints: updatedKeyPoints });
  };

  const addKeyPoint = () => {
    onChange({
      ...data,
      keyPoints: [...data.keyPoints, { title: '', explanation: '' }]
    });
  };

  const removeKeyPoint = (index: number) => {
    if (data.keyPoints.length > 1) {
      const updatedKeyPoints = data.keyPoints.filter((_: KeyPoint, i: number) => i !== index);
      onChange({ ...data, keyPoints: updatedKeyPoints });
    }
  };

  return (
    <>
      <div className="form-field">
        <label>Study Guide Title</label>
        <textarea
          className="textarea"
          placeholder="Enter the study guide title/question..."
          value={data.question}
          onChange={(e) => onChange({ ...data, question: e.target.value })}
          rows={2}
        />
      </div>

      <div className="form-field">
        <label>Key Points</label>
        <div className="summary-keypoints-editor">
          {data.keyPoints.map((keyPoint: KeyPoint, index: number) => (
            <div key={index} className="keypoint-editor">
              <div className="keypoint-header">
                <strong>Key Point {index + 1}</strong>
                {data.keyPoints.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm remove-keypoint"
                    onClick={() => removeKeyPoint(index)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="keypoint-fields">
                <input
                  type="text"
                  className="input keypoint-title"
                  value={keyPoint.title}
                  onChange={(e) => updateKeyPoint(index, 'title', e.target.value)}
                  placeholder="Key point title"
                />
                <textarea
                  className="textarea keypoint-explanation"
                  value={keyPoint.explanation}
                  onChange={(e) => updateKeyPoint(index, 'explanation', e.target.value)}
                  placeholder="Detailed explanation"
                  rows={3}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-outline btn-sm add-keypoint"
            onClick={addKeyPoint}
          >
            <Plus size={14} />
            Add Key Point
          </button>
        </div>
      </div>
    </>
  );
};

// Discussion Editor Component
const DiscussionEditor = ({ data, onChange }: QuestionEditorProps) => {
  return (
    <div className="form-field">
      <label>Discussion Question</label>
      <textarea
        className="textarea"
        placeholder="Enter a thought-provoking discussion question..."
        value={data.question}
        onChange={(e) => onChange({ ...data, question: e.target.value })}
        rows={4}
      />
      <p className="field-hint">
        Discussion questions encourage critical thinking and don't have a single correct answer.
      </p>
    </div>
  );
};

// Matching Editor Component
const MatchingEditor = ({ data, onChange }: QuestionEditorProps) => {
  const updateLeftItem = (index: number, value: string) => {
    const updated = [...data.leftItems];
    updated[index] = value;
    onChange({ ...data, leftItems: updated });
  };

  const updateRightItem = (index: number, value: string) => {
    const updated = [...data.rightItems];
    updated[index] = value;
    onChange({ ...data, rightItems: updated });
  };

  const addLeftItem = () => {
    onChange({ ...data, leftItems: [...data.leftItems, ''] });
  };

  const addRightItem = () => {
    onChange({ ...data, rightItems: [...data.rightItems, ''] });
  };

  const removeLeftItem = (index: number) => {
    if (data.leftItems.length > 2) {
      onChange({ ...data, leftItems: data.leftItems.filter((_: string, i: number) => i !== index) });
    }
  };

  const removeRightItem = (index: number) => {
    if (data.rightItems.length > 2) {
      onChange({ ...data, rightItems: data.rightItems.filter((_: string, i: number) => i !== index) });
    }
  };

  return (
    <>
      <div className="form-field">
        <label>Question</label>
        <textarea
          className="textarea"
          placeholder="Enter instructions for the matching question..."
          value={data.question}
          onChange={(e) => onChange({ ...data, question: e.target.value })}
          rows={2}
        />
      </div>

      <div className="form-row">
        <div className="form-field">
          <label>Left Column Items</label>
          {data.leftItems.map((item: string, index: number) => (
            <div key={index} className="option-input-group" style={{ marginBottom: '8px' }}>
              <input
                type="text"
                className="input"
                value={item}
                onChange={(e) => updateLeftItem(index, e.target.value)}
                placeholder={`Item ${index + 1}`}
              />
              {data.leftItems.length > 2 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm remove-option"
                  onClick={() => removeLeftItem(index)}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={addLeftItem}
          >
            <Plus size={14} />
            Add Item
          </button>
        </div>

        <div className="form-field">
          <label>Right Column Items</label>
          {data.rightItems.map((item: string, index: number) => (
            <div key={index} className="option-input-group" style={{ marginBottom: '8px' }}>
              <input
                type="text"
                className="input"
                value={item}
                onChange={(e) => updateRightItem(index, e.target.value)}
                placeholder={`Match ${index + 1}`}
              />
              {data.rightItems.length > 2 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm remove-option"
                  onClick={() => removeRightItem(index)}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={addRightItem}
          >
            <Plus size={14} />
            Add Match
          </button>
        </div>
      </div>
    </>
  );
};

// Ordering Editor Component
const OrderingEditor = ({ data, onChange }: QuestionEditorProps) => {
  const updateItem = (index: number, value: string) => {
    const updated = [...data.items];
    updated[index] = value;
    onChange({ ...data, items: updated });
  };

  const addItem = () => {
    onChange({ ...data, items: [...data.items, ''] });
  };

  const removeItem = (index: number) => {
    if (data.items.length > 2) {
      onChange({ ...data, items: data.items.filter((_: string, i: number) => i !== index) });
    }
  };

  return (
    <>
      <div className="form-field">
        <label>Question</label>
        <textarea
          className="textarea"
          placeholder="Enter instructions (e.g., 'Put these events in chronological order')..."
          value={data.question}
          onChange={(e) => onChange({ ...data, question: e.target.value })}
          rows={2}
        />
      </div>

      <div className="form-field">
        <label>Items to Order (in correct order)</label>
        <p className="field-hint">Enter items in the correct order. They will be shuffled for students.</p>
        {data.items.map((item: string, index: number) => (
          <div key={index} className="option-input-group" style={{ marginBottom: '8px' }}>
            <span style={{ marginRight: '8px', fontWeight: 'bold' }}>{index + 1}.</span>
            <input
              type="text"
              className="input"
              value={item}
              onChange={(e) => updateItem(index, e.target.value)}
              placeholder={`Step ${index + 1}`}
              style={{ flex: 1 }}
            />
            {data.items.length > 2 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm remove-option"
                onClick={() => removeItem(index)}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={addItem}
        >
          <Plus size={14} />
          Add Item
        </button>
      </div>
    </>
  );
};

// Cloze Editor Component
const ClozeEditor = ({ data, onChange }: QuestionEditorProps) => {
  return (
    <>
      <div className="form-field">
        <label>Text with Blanks</label>
        <textarea
          className="textarea"
          placeholder="Enter text and use $ to mark blanks. Example: 'The capital of France is $Paris$. It is located in $Europe$.'"
          value={data.textWithBlanks}
          onChange={(e) => onChange({ ...data, textWithBlanks: e.target.value })}
          rows={6}
        />
        <p className="field-hint">
          Use $ symbols to mark blanks. Text between $ symbols will be the correct answer.
        </p>
      </div>

      <div className="form-field">
        <label>Preview</label>
        <div style={{ 
          padding: '12px', 
          background: 'var(--color-muted)', 
          borderRadius: 'var(--radius-md)',
          fontFamily: 'monospace',
          fontSize: '14px'
        }}>
          {data.textWithBlanks || 'Your text will appear here...'}
        </div>
      </div>
    </>
  );
};

export default AddQuestionModal;
