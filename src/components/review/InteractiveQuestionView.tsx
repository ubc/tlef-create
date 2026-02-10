import { useState, useEffect } from 'react';
import { ExtendedQuestion } from './reviewTypes';
import { LearningObjectiveData } from '../generation/generationTypes';
import '../../styles/components/InteractiveQuestions.css';

interface InteractiveQuestionViewProps {
  question: ExtendedQuestion;
  index: number;
  expandedBulletPoints: {[questionId: string]: {[bulletIndex: number]: boolean}};
  toggleBulletPoint: (questionId: string, bulletIndex: number) => void;
  learningObjectives: LearningObjectiveData[];
}

const InteractiveQuestionView = ({ question, index, expandedBulletPoints, toggleBulletPoint, learningObjectives }: InteractiveQuestionViewProps) => {
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [showAnswer, setShowAnswer] = useState(false);
    const [isFlipped, setIsFlipped] = useState(false);

    const [clozeAnswers, setClozeAnswers] = useState<string[]>([]);
    const [orderingItems, setOrderingItems] = useState<string[]>([]);
    const [matchingConnections, setMatchingConnections] = useState<{[key: string]: string}>({});
    const [draggedItem, setDraggedItem] = useState<string | null>(null);

    useEffect(() => {
      if (question.type === 'ordering') {
        if (question.content?.items) {
          setOrderingItems([...question.content.items]);
        } else {
          const fallbackItems = [
            "Initialize variables and data structures",
            "Read input data from user or file",
            "Process data using the main algorithm",
            "Generate and display the results",
            "Clean up resources and exit"
          ];
          setOrderingItems(fallbackItems);
        }
      }
    }, [question]);

    const handleAnswerSelect = (answer: string) => {
      setSelectedAnswer(answer);
      setShowAnswer(true);
    };

    const handleClozeAnswerChange = (idx: number, value: string) => {
      const newAnswers = [...clozeAnswers];
      newAnswers[idx] = value;
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
      const correct = question.content?.correctOrder || [
        "Initialize variables and data structures",
        "Read input data from user or file",
        "Process data using the main algorithm",
        "Generate and display the results",
        "Clean up resources and exit"
      ];
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
      return clozeAnswers.every((answer, idx) =>
        answer.toLowerCase() === correctAnswers[idx]?.toLowerCase()
      );
    };

    const isCorrect = (answer: string) => {
      if (question.type === 'multiple-choice' && question.content?.options) {
        const option = question.content.options.find((opt: { text: string; isCorrect: boolean; order?: number }) => opt.text === answer);
        return option?.isCorrect;
      }
      if (question.type === 'true-false') {
        return String(answer).toLowerCase() === String(question.correctAnswer).toLowerCase();
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
          <div
            className={`flashcard ${isFlipped ? 'flipped' : ''}`}
            onClick={() => setIsFlipped(!isFlipped)}
          >
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
                question.content.options.map((option: { text: string; isCorrect: boolean; order?: number }, idx: number) => {
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

              {question.type === 'true-false' &&
                ['True', 'False'].map((option: string, idx: number) => {
                  const isSelected = selectedAnswer === option;
                  const optionIsCorrect = String(question.correctAnswer).toLowerCase() === option.toLowerCase();
                  const showResult = showAnswer && isSelected;

                  return (
                    <button
                      key={idx}
                      className={`tf-button ${isSelected ? 'selected' : ''} ${showResult ? (optionIsCorrect ? 'correct' : 'incorrect') : ''}`}
                      onClick={() => !showAnswer && handleAnswerSelect(option)}
                      disabled={showAnswer}
                    >
                      <span className="tf-text">{option}</span>
                      {showResult && (
                        <span className="tf-result">
                          {optionIsCorrect ? '✓' : '✗'}
                        </span>
                      )}
                    </button>
                  );
                })
              }

              {question.type === 'summary' && (
                <div className="summary-question accordion-style">
                  <div className="summary-content">
                    <h4>Key Learning Points</h4>
                    {question.content?.keyPoints && question.content.keyPoints.length > 0 ? (
                      <div className="bullet-points">
                        {question.content.keyPoints.map((keyPoint: { title: string; explanation: string }, kpIndex: number) => {
                          const isExpanded = expandedBulletPoints[question._id]?.[kpIndex];
                          return (
                            <div key={kpIndex} className="bullet-point-item">
                              <div
                                className="bullet-point-header"
                                onClick={() => toggleBulletPoint(question._id, kpIndex)}
                                style={{ cursor: 'pointer' }}
                              >
                                <span className={`dropdown-arrow ${isExpanded ? 'expanded' : 'collapsed'}`}>
                                  {isExpanded ? '▼' : '▶'}
                                </span>
                                <span className="bullet-point-title">{keyPoint.title}</span>
                              </div>
                              {isExpanded && (
                                <div className="bullet-point-content">
                                  <p>{keyPoint.explanation}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      learningObjectives.map((objective, loIdx) => (
                        <div key={loIdx} className="learning-objective-panel">
                          <div className="objective-header">
                            <span className="dropdown-arrow">▼</span>
                            <h4>Learning Objective {loIdx + 1}</h4>
                          </div>
                          <div className="objective-content">
                            <div className="objective-points">
                              <p><strong>Objective:</strong> {objective}</p>
                              <p><strong>Key Points:</strong> Understanding and application of this concept</p>
                              <p><strong>Assessment Focus:</strong> This objective will be evaluated through various question types</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {question.type === 'discussion' && (
                <div className="discussion-question">
                </div>
              )}

              {question.type === 'cloze' && question.content?.textWithBlanks && (
                <div className="cloze-question">
                  <div className="cloze-text">
                    {question.content.textWithBlanks?.split('$$').map((part: string, partIndex: number) => (
                      <span key={partIndex}>
                        {part}
                        {partIndex < (question.content.textWithBlanks?.match(/\$\$/g) || []).length && (
                          <input
                            type="text"
                            className="cloze-input"
                            value={clozeAnswers[partIndex] || ''}
                            onChange={(e) => handleClozeAnswerChange(partIndex, e.target.value)}
                            placeholder={`Blank ${partIndex + 1}`}
                          />
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="cloze-options-hint">
                    <strong>Available options:</strong>
                    <div className="options-display">
                      {question.content.blankOptions?.map((blankOptions: string[], blankIndex: number) => (
                        <div key={blankIndex} className="blank-options-hint">
                          <span className="blank-label">Blank {blankIndex + 1}:</span>
                          <span className="options-list">
                            {blankOptions.filter((opt: string) => opt.trim()).join(', ')}
                          </span>
                        </div>
                      ))}
                    </div>
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

              {question.type === 'ordering' && (
                <div className="ordering-question">
                  <div className="ordering-instructions">
                    <p>Drag the items to arrange them in the correct order:</p>
                  </div>
                  <div className="ordering-container">
                    {orderingItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="ordering-item"
                        draggable
                        onDragStart={() => setDraggedItem(item)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedItem) {
                            const dragIndex = orderingItems.indexOf(draggedItem);
                            handleOrderingDrop(dragIndex, idx);
                            setDraggedItem(null);
                          }
                        }}
                      >
                        <span className="order-number">{idx + 1}</span>
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
                          {(question.content.correctOrder || [
                            "Initialize variables and data structures",
                            "Read input data from user or file",
                            "Process data using the main algorithm",
                            "Generate and display the results",
                            "Clean up resources and exit"
                          ]).map((item: string, idx: number) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {question.type === 'matching' && question.content?.leftItems && question.content?.rightItems && (
                <div className="matching-question">
                  <div className="matching-instructions">
                    <p>Drag items from the right to match with items on the left:</p>
                  </div>
                  <div className="matching-container">
                    <div className="matching-left">
                      {question.content.leftItems.map((leftItem: string, idx: number) => (
                        <div key={idx} className="matching-left-item">
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
                      {question.content.rightItems.map((rightItem: string, idx: number) => (
                        <div
                          key={idx}
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

            {!showAnswer && (question.type as string) !== 'flashcard' && question.type !== 'ordering' && question.type !== 'matching' && (
              <div className="question-hint">
                Select an answer to see the result
              </div>
            )}
          </div>
        )}
      </div>
    );
};

export default InteractiveQuestionView;
