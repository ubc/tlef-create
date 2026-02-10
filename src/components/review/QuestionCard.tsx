import { Edit, Trash2, Plus, EyeOff, Save, RotateCcw } from 'lucide-react';
import { ExtendedQuestion } from './reviewTypes';
import { useQuestionEditHandlers } from './useQuestionEditHandlers';

interface QuestionCardProps {
  question: ExtendedQuestion;
  index: number;
  handlers: ReturnType<typeof useQuestionEditHandlers>;
  onToggleEdit: (questionId: string) => void;
  onSave: (questionId: string) => void;
  onDelete: (questionId: string) => void;
  onRegenerate: (questionId: string) => void;
}

const QuestionCard = ({ question, index, handlers, onToggleEdit, onSave, onDelete, onRegenerate }: QuestionCardProps) => {
  const {
    updateQuestion, updateMultipleChoiceOption, updateMultipleChoiceCorrect,
    addMultipleChoiceOption, removeMultipleChoiceOption, updateTrueFalseAnswer,
    updateMatchingLeftItem, updateMatchingRightItem, addMatchingLeftItem,
    addMatchingRightItem, removeMatchingLeftItem, removeMatchingRightItem,
    updateMatchingPair, addMatchingPair, removeMatchingPair,
    updateOrderingItem, addOrderingItem, removeOrderingItem, moveOrderingItem,
    updateClozeText, addClozeBlank, removeClozeBlank, updateClozeBlankOption,
    addClozeBlankOption, removeClozeBlankOption, updateClozeCorrectAnswer,
    updateKeyPoint, addKeyPoint, removeKeyPoint,
  } = handlers;

  return (
    <div id={`question-${question._id}`} className="question-item">
      <div className="question-header">
        <div className="question-meta">
          <span className="question-number">Q{index + 1}</span>
          <span className="question-type">{question.type.replace('-', ' ')}</span>
          <span className="question-difficulty">{question.difficulty}</span>
          <span className="question-lo">Order {question.order + 1}</span>
        </div>
        <div className="question-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => onRegenerate(question._id)} title="Regenerate question with custom prompt">
            <RotateCcw size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onToggleEdit(question._id)} title={question.isEditing ? 'Cancel edit' : 'Edit question'}>
            {question.isEditing ? <EyeOff size={14} /> : <Edit size={14} />}
          </button>
          <button className="btn btn-ghost btn-sm text-destructive" onClick={() => onDelete(question._id)} title="Delete question">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {question.isEditing ? (
        <div className="question-edit">
          <div className="edit-field">
            <label>{question.type === 'flashcard' ? 'Front side:' : 'Question:'}</label>
            <textarea
              className="textarea"
              value={question.type === 'flashcard' ? (question.content?.front || question.questionText) : question.questionText}
              onChange={(e) => {
                if (question.type === 'flashcard') {
                  updateQuestion(question._id, 'content', { ...question.content, front: e.target.value });
                } else {
                  updateQuestion(question._id, 'questionText', e.target.value);
                }
              }}
              rows={3}
              placeholder={question.type === 'flashcard' ? 'Enter the question/front side content...' : 'Enter your question...'}
            />
          </div>

          {question.type === 'multiple-choice' && question.content?.options ? (
            <div className="edit-field">
              <label>Answer Options:</label>
              <div className="multiple-choice-editor">
                {question.content.options.map((option: { text: string; isCorrect: boolean; order?: number }, idx: number) => (
                  <div key={idx} className="option-editor">
                    <div className="option-input-group">
                      <input type="radio" name={`correct-${question._id}`} checked={option.isCorrect} onChange={() => updateMultipleChoiceCorrect(question._id, idx)} className="option-radio" />
                      <textarea className="option-text-input" value={option.text} onChange={(e) => updateMultipleChoiceOption(question._id, idx, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + idx)}`} rows={2} />
                      <button type="button" className="btn btn-ghost btn-sm remove-option" onClick={() => removeMultipleChoiceOption(question._id, idx)} disabled={question.content.options.length <= 2} title="Remove option">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <small className="option-hint">{option.isCorrect ? 'Correct Answer' : `Option ${String.fromCharCode(65 + idx)}`}</small>
                  </div>
                ))}
                <button type="button" className="btn btn-outline btn-sm add-option" onClick={() => addMultipleChoiceOption(question._id)} disabled={question.content.options.length >= 6}>
                  <Plus size={14} /> Add Option
                </button>
              </div>
            </div>
          ) : question.type === 'true-false' ? (
            <div className="edit-field">
              <label>Correct Answer:</label>
              <div className="true-false-editor">
                <div className="tf-option">
                  <input type="radio" name={`tf-correct-${question._id}`} value="True" checked={String(question.correctAnswer).toLowerCase() === 'true'} onChange={() => updateTrueFalseAnswer(question._id, 'True')} className="tf-radio" />
                  <label className="tf-label">True</label>
                </div>
                <div className="tf-option">
                  <input type="radio" name={`tf-correct-${question._id}`} value="False" checked={String(question.correctAnswer).toLowerCase() === 'false'} onChange={() => updateTrueFalseAnswer(question._id, 'False')} className="tf-radio" />
                  <label className="tf-label">False</label>
                </div>
              </div>
            </div>
          ) : question.type === 'flashcard' ? (
            <div className="edit-field">
              <label>Back side:</label>
              <textarea className="textarea" value={question.content?.back || question.correctAnswer || ''} onChange={(e) => updateQuestion(question._id, 'content', { ...question.content, back: e.target.value })} rows={3} placeholder="Enter the answer/back side content..." />
            </div>
          ) : question.type === 'summary' ? (
            <div className="edit-field">
              <label>Knowledge Points:</label>
              <div className="summary-keypoints-editor">
                {question.content?.keyPoints && question.content.keyPoints.length > 0 ? (
                  question.content.keyPoints.map((keyPoint: { title: string; explanation: string }, kpIdx: number) => (
                    <div key={kpIdx} className="keypoint-editor">
                      <div className="keypoint-header">
                        <strong>Point {kpIdx + 1}:</strong>
                        <button type="button" className="btn btn-outline btn-sm remove-keypoint" onClick={() => removeKeyPoint(question._id, kpIdx)} disabled={question.content.keyPoints.length <= 1} title="Remove key point"><Trash2 size={14} /></button>
                      </div>
                      <div className="keypoint-fields">
                        <input type="text" className="input-field keypoint-title" value={keyPoint.title || ''} onChange={(e) => updateKeyPoint(question._id, kpIdx, 'title', e.target.value)} placeholder="Enter the knowledge point title..." />
                        <textarea className="textarea keypoint-explanation" value={keyPoint.explanation || ''} onChange={(e) => updateKeyPoint(question._id, kpIdx, 'explanation', e.target.value)} rows={3} placeholder="Enter detailed explanation of this knowledge point..." />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="no-keypoints"><p>No knowledge points available. Generate the question with AI or add manually.</p></div>
                )}
                <button type="button" className="btn btn-outline btn-sm add-keypoint" onClick={() => addKeyPoint(question._id)} disabled={question.content?.keyPoints?.length >= 8}><Plus size={14} /> Add Knowledge Point</button>
              </div>
            </div>
          ) : question.type === 'matching' ? (
            <div className="edit-field">
              <label>Matching Items:</label>
              <div className="matching-editor">
                <div className="matching-editor-section">
                  <h4>Left Items (Items to Match):</h4>
                  <div className="matching-items-list">
                    {question.content?.leftItems?.map((item: string, idx: number) => (
                      <div key={idx} className="matching-item-editor">
                        <div className="item-input-group">
                          <input type="text" className="input-field matching-item-input" value={item} onChange={(e) => updateMatchingLeftItem(question._id, idx, e.target.value)} placeholder={`Left item ${idx + 1}`} />
                          <button type="button" className="btn btn-ghost btn-sm remove-item" onClick={() => removeMatchingLeftItem(question._id, idx)} disabled={question.content.leftItems.length <= 2} title="Remove item"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn btn-outline btn-sm add-item" onClick={() => addMatchingLeftItem(question._id)} disabled={question.content?.leftItems?.length >= 8}><Plus size={14} /> Add Left Item</button>
                </div>
                <div className="matching-editor-section">
                  <h4>Right Items (Answer Options):</h4>
                  <div className="matching-items-list">
                    {question.content?.rightItems?.map((item: string, idx: number) => (
                      <div key={idx} className="matching-item-editor">
                        <div className="item-input-group">
                          <input type="text" className="input-field matching-item-input" value={item} onChange={(e) => updateMatchingRightItem(question._id, idx, e.target.value)} placeholder={`Right item ${idx + 1}`} />
                          <button type="button" className="btn btn-ghost btn-sm remove-item" onClick={() => removeMatchingRightItem(question._id, idx)} disabled={question.content.rightItems.length <= 2} title="Remove item"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn btn-outline btn-sm add-item" onClick={() => addMatchingRightItem(question._id)} disabled={question.content?.rightItems?.length >= 8}><Plus size={14} /> Add Right Item</button>
                </div>
                <div className="matching-editor-section">
                  <h4>Correct Matches:</h4>
                  <div className="matching-pairs-editor">
                    {question.content?.matchingPairs?.map((pair: string[], pIdx: number) => (
                      <div key={pIdx} className="matching-pair-editor">
                        <div className="pair-input-group">
                          <select className="select-input pair-select" value={pair[0] || ''} onChange={(e) => updateMatchingPair(question._id, pIdx, 0, e.target.value)}>
                            <option value="">Select left item</option>
                            {question.content?.leftItems?.map((item: string, itemIdx: number) => (<option key={itemIdx} value={item}>{item}</option>))}
                          </select>
                          <span className="pair-arrow">→</span>
                          <select className="select-input pair-select" value={pair[1] || ''} onChange={(e) => updateMatchingPair(question._id, pIdx, 1, e.target.value)}>
                            <option value="">Select right item</option>
                            {question.content?.rightItems?.map((item: string, itemIdx: number) => (<option key={itemIdx} value={item}>{item}</option>))}
                          </select>
                          <button type="button" className="btn btn-ghost btn-sm remove-pair" onClick={() => removeMatchingPair(question._id, pIdx)} disabled={question.content.matchingPairs.length <= 1} title="Remove pair"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn btn-outline btn-sm add-pair" onClick={() => addMatchingPair(question._id)} disabled={question.content?.matchingPairs?.length >= 6}><Plus size={14} /> Add Match Pair</button>
                </div>
              </div>
            </div>
          ) : question.type === 'cloze' ? (
            <div className="edit-field">
              <label>Cloze Question:</label>
              <div className="cloze-editor">
                <div className="cloze-editor-section">
                  <h4>Question Text with Blanks:</h4>
                  <div className="cloze-text-editor">
                    <textarea className="cloze-text-input" value={question.content?.textWithBlanks || ''} onChange={(e) => updateClozeText(question._id, e.target.value)} placeholder="Enter your text with blanks marked by $$" rows={4} />
                    <small className="cloze-hint">Use $$ to mark where blanks should appear. Each $$ will create a fill-in field.</small>
                  </div>
                  <button type="button" className="btn btn-outline btn-sm add-blank" onClick={() => addClozeBlank(question._id)}><Plus size={14} /> Add Blank</button>
                </div>
                <div className="cloze-editor-section">
                  <h4>Blank Options & Correct Answers:</h4>
                  <div className="cloze-blanks-editor">
                    {question.content?.blankOptions?.map((blankOptions: string[], blankIdx: number) => (
                      <div key={blankIdx} className="cloze-blank-editor">
                        <div className="blank-header">
                          <strong>Blank {blankIdx + 1}:</strong>
                          <button type="button" className="btn btn-ghost btn-sm remove-blank" onClick={() => removeClozeBlank(question._id, blankIdx)} disabled={question.content.blankOptions.length <= 1} title="Remove blank"><Trash2 size={14} /></button>
                        </div>
                        <div className="blank-options">
                          <label>Available Options:</label>
                          <div className="options-list">
                            {blankOptions.map((option: string, optIdx: number) => (
                              <div key={optIdx} className="option-input-group">
                                <input type="text" className="input-field option-input" value={option} onChange={(e) => updateClozeBlankOption(question._id, blankIdx, optIdx, e.target.value)} placeholder={`Option ${optIdx + 1}`} />
                                <button type="button" className="btn btn-ghost btn-sm remove-option" onClick={() => removeClozeBlankOption(question._id, blankIdx, optIdx)} disabled={blankOptions.length <= 1} title="Remove option"><Trash2 size={14} /></button>
                              </div>
                            ))}
                          </div>
                          <button type="button" className="btn btn-outline btn-sm add-option" onClick={() => addClozeBlankOption(question._id, blankIdx)}><Plus size={14} /> Add Option</button>
                        </div>
                        <div className="correct-answer">
                          <label>Correct Answer:</label>
                          <input type="text" className="input-field correct-answer-input" value={question.content?.correctAnswers?.[blankIdx] || ''} onChange={(e) => updateClozeCorrectAnswer(question._id, blankIdx, e.target.value)} placeholder="Enter the correct answer for this blank" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="cloze-editor-section">
                  <h4>Preview:</h4>
                  <div className="cloze-preview">
                    <div className="preview-text">
                      {question.content?.textWithBlanks?.split('$$').map((part: string, partIdx: number) => (
                        <span key={partIdx}>
                          {part}
                          {partIdx < (question.content?.textWithBlanks?.match(/\$\$/g) || []).length && (
                            <input type="text" className="preview-blank" placeholder={`Blank ${partIdx + 1}`} disabled />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : question.type === 'ordering' ? (
            <div className="edit-field">
              <label>Ordering Items:</label>
              <div className="ordering-editor">
                <div className="ordering-editor-section">
                  <h4>Items to Order:</h4>
                  <div className="ordering-items-list">
                    {question.content?.items?.map((item: string, idx: number) => (
                      <div key={idx} className="ordering-item-editor">
                        <div className="item-input-group">
                          <div className="order-number-display">{idx + 1}</div>
                          <textarea className="ordering-item-input" value={item} onChange={(e) => updateOrderingItem(question._id, idx, e.target.value)} placeholder={`Item ${idx + 1}`} rows={2} />
                          <div className="item-actions">
                            <button type="button" className="btn btn-ghost btn-sm move-up" onClick={() => moveOrderingItem(question._id, idx, Math.max(0, idx - 1))} disabled={idx === 0} title="Move up">↑</button>
                            <button type="button" className="btn btn-ghost btn-sm move-down" onClick={() => moveOrderingItem(question._id, idx, Math.min((question.content?.items?.length || 1) - 1, idx + 1))} disabled={idx === (question.content?.items?.length || 1) - 1} title="Move down">↓</button>
                            <button type="button" className="btn btn-ghost btn-sm remove-item" onClick={() => removeOrderingItem(question._id, idx)} disabled={question.content.items.length <= 2} title="Remove item"><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn btn-outline btn-sm add-item" onClick={() => addOrderingItem(question._id)} disabled={question.content?.items?.length >= 8}><Plus size={14} /> Add Item</button>
                </div>
                <div className="ordering-editor-section">
                  <h4>Correct Order Preview:</h4>
                  <div className="correct-order-preview">
                    <ol>{question.content?.correctOrder?.map((item: string, idx: number) => (<li key={idx}>{item}</li>))}</ol>
                  </div>
                  <small className="order-hint">The correct order is automatically updated when you reorder items above.</small>
                </div>
              </div>
            </div>
          ) : (
            <div className="edit-field">
              <label>Correct Answer:</label>
              <textarea className="textarea" value={typeof question.correctAnswer === 'string' ? question.correctAnswer : JSON.stringify(question.correctAnswer)} onChange={(e) => updateQuestion(question._id, 'correctAnswer', e.target.value)} rows={2} />
            </div>
          )}

          <div className="edit-field">
            <label>Explanation (optional):</label>
            <textarea className="textarea" value={question.explanation || ''} onChange={(e) => updateQuestion(question._id, 'explanation', e.target.value)} rows={2} />
          </div>

          <div className="edit-actions">
            <button className="btn btn-primary btn-sm" onClick={() => onSave(question._id)}><Save size={14} /> Save</button>
            <button className="btn btn-outline btn-sm" onClick={() => onToggleEdit(question._id)}>Cancel</button>
          </div>
        </div>
      ) : question.type === 'summary' ? (
        <div className="question-display">
          <div className="question-text">{question.questionText}</div>
          <div className="summary-keypoints-display">
            {question.content?.keyPoints && question.content.keyPoints.length > 0 ? (
              <div className="keypoints-list">
                <strong>Knowledge Points:</strong>
                {question.content.keyPoints.map((keyPoint: { title: string; explanation: string }, kpIdx: number) => (
                  <div key={kpIdx} className="keypoint-display">
                    <div className="keypoint-title"><strong>{kpIdx + 1}. {keyPoint.title}</strong></div>
                    <div className="keypoint-explanation">{keyPoint.explanation}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="question-answer"><strong>Answer:</strong> {typeof question.correctAnswer === 'string' ? question.correctAnswer : JSON.stringify(question.correctAnswer)}</div>
            )}
          </div>
          {question.explanation && (<div className="question-explanation"><strong>Explanation:</strong> {question.explanation}</div>)}
        </div>
      ) : question.type === 'matching' ? (
        <div className="question-display">
          <div className="question-text">{question.questionText}</div>
          <div className="matching-display">
            <div className="matching-items-display">
              <div className="matching-left-display"><strong>Items to Match:</strong><ul>{question.content?.leftItems?.map((item: string, idx: number) => (<li key={idx}>{item}</li>))}</ul></div>
              <div className="matching-right-display"><strong>Answer Options:</strong><ul>{question.content?.rightItems?.map((item: string, idx: number) => (<li key={idx}>{item}</li>))}</ul></div>
            </div>
            <div className="matching-pairs-display"><strong>Correct Matches:</strong><ul>{question.content?.matchingPairs?.map((pair: string[], idx: number) => (<li key={idx}><strong>{pair[0]}</strong> → {pair[1]}</li>))}</ul></div>
          </div>
          {question.explanation && (<div className="question-explanation"><strong>Explanation:</strong> {question.explanation}</div>)}
        </div>
      ) : question.type === 'cloze' ? (
        <div className="question-display">
          <div className="question-text">{question.questionText}</div>
          <div className="cloze-display">
            <div className="cloze-text-display">
              <strong>Question Text:</strong>
              <div className="cloze-text-content">
                {question.content?.textWithBlanks?.split('$$').map((part: string, partIdx: number) => (
                  <span key={partIdx}>{part}{partIdx < (question.content?.blankOptions?.length || 0) && (<span className="blank-placeholder">[Blank {partIdx + 1}]</span>)}</span>
                ))}
              </div>
            </div>
            <div className="cloze-answers-display"><strong>Correct Answers:</strong><ul>{question.content?.correctAnswers?.map((answer: string, idx: number) => (<li key={idx}><strong>Blank {idx + 1}:</strong> {answer}</li>))}</ul></div>
            <div className="cloze-options-display">
              <strong>Available Options:</strong>
              {question.content?.blankOptions?.map((blankOptions: string[], blankIdx: number) => (
                <div key={blankIdx} className="blank-options-display"><strong>Blank {blankIdx + 1}:</strong> {blankOptions.filter((opt: string) => opt.trim()).join(', ')}</div>
              ))}
            </div>
          </div>
          {question.explanation && (<div className="question-explanation"><strong>Explanation:</strong> {question.explanation}</div>)}
        </div>
      ) : question.type === 'ordering' ? (
        <div className="question-display">
          <div className="question-text">{question.questionText}</div>
          <div className="ordering-display">
            <div className="ordering-items-display"><strong>Items to Order:</strong><ul>{question.content?.items?.map((item: string, idx: number) => (<li key={idx}>{item}</li>))}</ul></div>
            <div className="correct-order-display"><strong>Correct Order:</strong><ol>{question.content?.correctOrder?.map((item: string, idx: number) => (<li key={idx}>{item}</li>))}</ol></div>
          </div>
          {question.explanation && (<div className="question-explanation"><strong>Explanation:</strong> {question.explanation}</div>)}
        </div>
      ) : (
        <div className="question-display">
          <div className="question-text">{question.questionText}</div>
          <div className="question-answer"><strong>Answer:</strong> {typeof question.correctAnswer === 'string' ? question.correctAnswer : JSON.stringify(question.correctAnswer)}</div>
          {question.explanation && (<div className="question-explanation"><strong>Explanation:</strong> {question.explanation}</div>)}
        </div>
      )}
    </div>
  );
};

export default QuestionCard;
