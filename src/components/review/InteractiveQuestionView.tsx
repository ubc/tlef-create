import { useState, useEffect } from 'react';
import { ExtendedQuestion } from './reviewTypes';
import { LearningObjectiveData } from '../generation/generationTypes';
import BranchingScenarioTreeView from './BranchingScenarioTreeView';
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

    // Mark the words state
    const [selectedWords, setSelectedWords] = useState<Set<number>>(new Set());
    const [mtwChecked, setMtwChecked] = useState(false);

    // Single choice set state
    const [currentSCSIndex, setCurrentSCSIndex] = useState(0);
    const [selectedSCSAnswer, setSelectedSCSAnswer] = useState<number | null>(null);
    const [scsShowResult, setScsShowResult] = useState(false);

    // Essay state
    const [essayText, setEssayText] = useState('');
    const [essayChecked, setEssayChecked] = useState(false);

    // Sort paragraphs state
    const [sortedParagraphs, setSortedParagraphs] = useState<string[]>([]);
    const [sortChecked, setSortChecked] = useState(false);
    const [draggedParagraph, setDraggedParagraph] = useState<string | null>(null);

    // Crossword state
    const [crosswordAnswers, setCrosswordAnswers] = useState<{[idx: number]: string}>({});
    const [crosswordChecked, setCrosswordChecked] = useState(false);

    // Dictation state
    const [dictationAnswers, setDictationAnswers] = useState<{[idx: number]: string}>({});
    const [dictationChecked, setDictationChecked] = useState(false);

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

    useEffect(() => {
      if (question.type === 'sort-paragraphs' && question.content?.paragraphs) {
        const paragraphs = question.content.paragraphs.map((p: string | { text: string }) =>
          typeof p === 'string' ? p : p.text || ''
        );
        // Shuffle for the user
        const shuffled = [...paragraphs];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        setSortedParagraphs(shuffled);
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

              {question.type === 'mark-the-words' && question.content?.text && (() => {
                const rawText: string = question.content.text;
                const words = rawText.split(/\s+/);
                const correctIndices = new Set<number>();
                const displayWords: string[] = [];
                words.forEach((word: string, idx: number) => {
                  if (word.startsWith('*') && word.endsWith('*') && word.length > 2) {
                    correctIndices.add(idx);
                    displayWords.push(word.slice(1, -1));
                  } else {
                    displayWords.push(word);
                  }
                });
                return (
                  <div className="mark-the-words-question">
                    <div className="mtw-instructions">
                      <p>Click on the correct words:</p>
                    </div>
                    <div className="mtw-text" style={{ lineHeight: '2.2', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {displayWords.map((word, idx) => {
                        const isSelected = selectedWords.has(idx);
                        const isCorrectWord = correctIndices.has(idx);
                        let className = 'mtw-word';
                        if (isSelected) className += ' selected';
                        if (mtwChecked && isSelected && isCorrectWord) className += ' correct';
                        if (mtwChecked && isSelected && !isCorrectWord) className += ' incorrect';
                        if (mtwChecked && !isSelected && isCorrectWord) className += ' missed';
                        return (
                          <span
                            key={idx}
                            className={className}
                            style={{
                              cursor: mtwChecked ? 'default' : 'pointer',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: isSelected ? '2px solid #2563eb' : '2px solid transparent',
                              backgroundColor: mtwChecked && isSelected && isCorrectWord ? '#dcfce7'
                                : mtwChecked && isSelected && !isCorrectWord ? '#fecaca'
                                : mtwChecked && !isSelected && isCorrectWord ? '#fef3c7'
                                : isSelected ? '#dbeafe' : 'transparent'
                            }}
                            onClick={() => {
                              if (mtwChecked) return;
                              const next = new Set(selectedWords);
                              if (next.has(idx)) next.delete(idx);
                              else next.add(idx);
                              setSelectedWords(next);
                            }}
                          >
                            {word}
                          </span>
                        );
                      })}
                    </div>
                    <div className="mtw-actions" style={{ marginTop: '12px' }}>
                      <button className="btn btn-primary" onClick={() => setMtwChecked(true)} disabled={mtwChecked}>
                        Check
                      </button>
                    </div>
                  </div>
                );
              })()}

              {question.type === 'single-choice-set' && question.content?.questions && (() => {
                const scsQuestions: Array<{ question: string; answers: Array<{ text: string } | string> }> = question.content.questions;
                const current = scsQuestions[currentSCSIndex];
                if (!current) return null;
                const answers = current.answers || [];
                return (
                  <div className="single-choice-set-question">
                    <div className="scs-progress" style={{ marginBottom: '8px', fontSize: '0.9em', color: '#666' }}>
                      Question {currentSCSIndex + 1} of {scsQuestions.length}
                    </div>
                    <div className="scs-question-text" style={{ fontWeight: 600, marginBottom: '12px' }}>
                      {current.question}
                    </div>
                    <div className="scs-answers">
                      {answers.map((ans, idx) => {
                        const ansText = typeof ans === 'string' ? ans : ans.text;
                        const isSelected = selectedSCSAnswer === idx;
                        const isCorrectAnswer = idx === 0; // first answer is always correct
                        return (
                          <button
                            key={idx}
                            className={`option-button ${isSelected ? 'selected' : ''} ${scsShowResult && isSelected ? (isCorrectAnswer ? 'correct' : 'incorrect') : ''}`}
                            onClick={() => {
                              if (scsShowResult) return;
                              setSelectedSCSAnswer(idx);
                              setScsShowResult(true);
                            }}
                            disabled={scsShowResult}
                            style={{ display: 'block', width: '100%', marginBottom: '8px', textAlign: 'left' }}
                          >
                            <span className="option-label">{String.fromCharCode(65 + idx)}</span>
                            <span className="option-text">{ansText}</span>
                            {scsShowResult && isSelected && (
                              <span className="option-result">{isCorrectAnswer ? '✓' : '✗'}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {scsShowResult && currentSCSIndex < scsQuestions.length - 1 && (
                      <button
                        className="btn btn-primary"
                        style={{ marginTop: '8px' }}
                        onClick={() => {
                          setCurrentSCSIndex(currentSCSIndex + 1);
                          setSelectedSCSAnswer(null);
                          setScsShowResult(false);
                        }}
                      >
                        Next
                      </button>
                    )}
                  </div>
                );
              })()}

              {question.type === 'essay' && (
                <div className="essay-question">
                  <div className="essay-task" style={{ marginBottom: '12px' }}>
                    <p>{question.content?.taskDescription || ''}</p>
                  </div>
                  <textarea
                    className="essay-input"
                    value={essayText}
                    onChange={(e) => setEssayText(e.target.value)}
                    placeholder="Enter your essay here..."
                    rows={8}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                    disabled={essayChecked}
                  />
                  <div className="essay-actions" style={{ marginTop: '8px' }}>
                    <button className="btn btn-primary" onClick={() => setEssayChecked(true)} disabled={essayChecked || !essayText.trim()}>
                      Check
                    </button>
                  </div>
                  {essayChecked && (
                    <div className="essay-results" style={{ marginTop: '12px' }}>
                      {question.content?.keywords && question.content.keywords.length > 0 && (
                        <div className="keyword-matches" style={{ marginBottom: '8px' }}>
                          <strong>Keyword matches:</strong>
                          <ul>
                            {question.content.keywords.map((kw: { keyword: string; alternatives?: string[] }, idx: number) => {
                              const found = essayText.toLowerCase().includes(kw.keyword.toLowerCase()) ||
                                (kw.alternatives || []).some((alt: string) => essayText.toLowerCase().includes(alt.toLowerCase()));
                              return (
                                <li key={idx} style={{ color: found ? '#16a34a' : '#dc2626' }}>
                                  {found ? '✓' : '✗'} {kw.keyword}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {question.content?.sampleAnswer && (
                        <div className="sample-answer" style={{ padding: '12px', backgroundColor: '#f3f4f6', borderRadius: '4px' }}>
                          <strong>Sample answer:</strong>
                          <p>{question.content.sampleAnswer}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {question.type === 'free-text' && (
                <div className="free-text-question">
                  <textarea
                    placeholder={question.content?.placeholder || 'Enter your answer here...'}
                    rows={5}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                  />
                </div>
              )}

              {question.type === 'open-ended' && (
                <div className="open-ended-question">
                  <textarea
                    placeholder={question.content?.placeholderText || 'Enter your response here...'}
                    rows={5}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                  />
                </div>
              )}

              {question.type === 'simple-multi-choice' && question.content?.alternatives && (
                <div className="simple-multi-choice-question">
                  {question.content.alternatives.map((alt: { text: string; correct?: boolean } | string, idx: number) => {
                    const altText = typeof alt === 'string' ? alt : alt.text;
                    const altCorrect = typeof alt === 'string' ? idx === 0 : (alt.correct !== undefined ? alt.correct : idx === 0);
                    const isSelected = selectedAnswer === altText;
                    const showResult = showAnswer && isSelected;
                    return (
                      <button
                        key={idx}
                        className={`option-button ${isSelected ? 'selected' : ''} ${showResult ? (altCorrect ? 'correct' : 'incorrect') : ''}`}
                        onClick={() => !showAnswer && handleAnswerSelect(altText)}
                        disabled={showAnswer}
                      >
                        <span className="option-label">{String.fromCharCode(65 + idx)}</span>
                        <span className="option-text">{altText}</span>
                        {showResult && (
                          <span className="option-result">{altCorrect ? '✓' : '✗'}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === 'sort-paragraphs' && sortedParagraphs.length > 0 && (
                <div className="sort-paragraphs-question">
                  <div className="sort-instructions">
                    <p>{question.content?.taskDescription || 'Drag the paragraphs into the correct order:'}</p>
                  </div>
                  <div className="sort-container">
                    {sortedParagraphs.map((paragraph, idx) => (
                      <div
                        key={idx}
                        className="sort-paragraph-item"
                        draggable={!sortChecked}
                        onDragStart={() => setDraggedParagraph(paragraph)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedParagraph && !sortChecked) {
                            const fromIdx = sortedParagraphs.indexOf(draggedParagraph);
                            const newItems = [...sortedParagraphs];
                            const [moved] = newItems.splice(fromIdx, 1);
                            newItems.splice(idx, 0, moved);
                            setSortedParagraphs(newItems);
                            setDraggedParagraph(null);
                          }
                        }}
                        style={{
                          padding: '12px', margin: '4px 0', border: '1px solid #d1d5db',
                          borderRadius: '4px', cursor: sortChecked ? 'default' : 'grab',
                          backgroundColor: sortChecked ? (
                            sortedParagraphs[idx] === (question.content?.paragraphs || [])[idx]?.text || sortedParagraphs[idx] === (question.content?.paragraphs || [])[idx]
                              ? '#dcfce7' : '#fecaca'
                          ) : '#fff'
                        }}
                      >
                        <span style={{ marginRight: '8px', fontWeight: 600 }}>{idx + 1}.</span>
                        {paragraph}
                        {!sortChecked && <span style={{ float: 'right', color: '#9ca3af' }}>⋮⋮</span>}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <button className="btn btn-primary" onClick={() => setSortChecked(true)} disabled={sortChecked}>
                      Check Order
                    </button>
                  </div>
                  {sortChecked && (
                    <div style={{ marginTop: '12px' }}>
                      <strong>Correct order:</strong>
                      <ol style={{ paddingLeft: '20px' }}>
                        {(question.content?.paragraphs || []).map((p: string | { text: string }, idx: number) => (
                          <li key={idx}>{typeof p === 'string' ? p : p.text}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}

              {question.type === 'crossword' && question.content?.words && (
                <div className="crossword-question">
                  <div style={{ marginBottom: '12px' }}>
                    <p>{question.content?.taskDescription || 'Fill in the answers based on the clues:'}</p>
                  </div>
                  <div className="crossword-clues">
                    {question.content.words.map((w: { answer?: string; word?: string; clue?: string; hint?: string }, idx: number) => {
                      const answer = (w.answer || w.word || '').toUpperCase();
                      const clue = w.clue || w.hint || '';
                      const userAnswer = crosswordAnswers[idx] || '';
                      const isCorrectAnswer = crosswordChecked && userAnswer.toUpperCase() === answer;
                      return (
                        <div key={idx} style={{ marginBottom: '8px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px',
                          backgroundColor: crosswordChecked ? (isCorrectAnswer ? '#dcfce7' : '#fecaca') : '#fff' }}>
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>{idx + 1}. {clue}</div>
                          <input
                            type="text"
                            value={userAnswer}
                            onChange={(e) => setCrosswordAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                            placeholder={`${answer.length} letters`}
                            maxLength={answer.length + 5}
                            disabled={crosswordChecked}
                            style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', width: `${Math.max(answer.length * 18, 100)}px`, letterSpacing: '4px', fontFamily: 'monospace', textTransform: 'uppercase' }}
                          />
                          {crosswordChecked && !isCorrectAnswer && (
                            <span style={{ marginLeft: '8px', color: '#16a34a' }}>{answer}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <button className="btn btn-primary" onClick={() => setCrosswordChecked(true)} disabled={crosswordChecked}>
                      Check
                    </button>
                  </div>
                </div>
              )}

              {question.type === 'dictation' && question.content?.sentences && (
                <div className="dictation-question">
                  <div style={{ marginBottom: '12px' }}>
                    <p>{question.content?.taskDescription || 'Type what you hear (or read the sentence and type it from memory):'}</p>
                  </div>
                  {question.content.sentences.map((s: string | { text: string }, idx: number) => {
                    const sentenceText = typeof s === 'string' ? s : s.text || '';
                    const userAnswer = dictationAnswers[idx] || '';
                    const isCorrectAnswer = dictationChecked && userAnswer.trim().toLowerCase() === sentenceText.trim().toLowerCase();
                    return (
                      <div key={idx} style={{ marginBottom: '12px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px',
                        backgroundColor: dictationChecked ? (isCorrectAnswer ? '#dcfce7' : '#fecaca') : '#fff' }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>Sentence {idx + 1}</div>
                        <input
                          type="text"
                          value={userAnswer}
                          onChange={(e) => setDictationAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                          placeholder="Type the sentence..."
                          disabled={dictationChecked}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                        />
                        {dictationChecked && !isCorrectAnswer && (
                          <div style={{ marginTop: '4px', color: '#16a34a', fontSize: '0.9em' }}>
                            Correct: {sentenceText}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ marginTop: '8px' }}>
                    <button className="btn btn-primary" onClick={() => setDictationChecked(true)} disabled={dictationChecked}>
                      Check
                    </button>
                  </div>
                </div>
              )}

              {question.type === 'arithmetic-quiz' && (
                <div className="arithmetic-quiz-question">
                  <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#f3f4f6', borderRadius: '8px' }}>
                    <p style={{ fontSize: '1.1em' }}>
                      Arithmetic Quiz: <strong>{question.content?.quizType || 'addition'}</strong>
                    </p>
                    <p style={{ color: '#6b7280' }}>
                      {question.content?.numQuestions || 10} questions, max number: {question.content?.maxNumber || 10}
                    </p>
                    <p style={{ fontSize: '0.9em', color: '#9ca3af' }}>
                      This quiz is interactive in H5P export. Preview not available here.
                    </p>
                  </div>
                </div>
              )}

              {question.type === 'branching-scenario' && (
                <div className="branching-scenario-question">
                  {question.content?.nodes?.length > 0 ? (
                    <BranchingScenarioTreeView
                      introText={question.content.introText || 'Introduction'}
                      nodes={question.content.nodes}
                    />
                  ) : (
                    <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#f3f4f6', borderRadius: '8px' }}>
                      <p style={{ fontSize: '1.1em' }}>Branching Scenario</p>
                      <p style={{ color: '#6b7280' }}>No structure data available. Try regenerating.</p>
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

            {!showAnswer && (question.type as string) !== 'flashcard' && question.type !== 'ordering' && question.type !== 'matching' && question.type !== 'mark-the-words' && question.type !== 'single-choice-set' && question.type !== 'essay' && question.type !== 'free-text' && question.type !== 'open-ended' && question.type !== 'simple-multi-choice' && question.type !== 'sort-paragraphs' && question.type !== 'crossword' && question.type !== 'dictation' && question.type !== 'arithmetic-quiz' && question.type !== 'branching-scenario' && (
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
