import { useState } from 'react';
import type { AuthoringClarification as Clarification, AuthoringClarificationAnswers } from '../../../services/api';

interface Props {
  messageId: string; questions: Clarification[]; disabled: boolean;
  onConfirmAnswers: (answers: AuthoringClarificationAnswers, text: string) => void;
}

interface Answer { options: string[]; custom: boolean; text: string }
const emptyAnswer = (): Answer => ({ options: [], custom: false, text: '' });
const defaultSelectionMode = ({ question, options }: Clarification) =>
  /\b(?:topics?|subjects?|themes?|scope)\b|主题|专题|知识点|内容范围|覆盖范围/i.test(question)
  && !/\b(?:conflict|resolve|either|choose one|which one|only one|how many|question count|number of questions|difficulty)\b|冲突|二选一|只能选|仅选一个|多少|题数|数量|难度/i.test(question)
  && !options.some(option => /\b(?:only|all topics|all of the above|entire course|whole course)\b|仅|只(?:讨论|覆盖|包含|教|选)|全部(?:主题|内容|章节)/i.test(option))
    ? 'multiple' : 'single';

function ClarificationChoices({ messageId, questions, disabled, onConfirmAnswers }: Props) {
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const selectedAnswers = questions.map((item, index) => {
    const answer = answers[index] || emptyAnswer();
    return { questionIndex: index, selectedOptions: item.options.filter(option => answer.options.includes(option)),
      ...(answer.custom && answer.text.trim() ? { customAnswer: answer.text.trim() } : {}) };
  });
  const composed = ['Apply these answers to the current task, keeping the other confirmed requirements:',
    ...questions.flatMap((item, index) => {
      const answer = answers[index];
      if (!answer) return [];
      const selected = [...item.options.filter(option => answer.options.includes(option)),
        ...(answer.custom && answer.text.trim() ? [answer.text.trim()] : [])];
      return selected.length ? [`${item.question} ${selected.join('; ')}`] : [];
    })];
  const hasEmptyCustom = Object.values(answers).some(answer => answer.custom && !answer.text.trim());
  const hasMissingAnswer = selectedAnswers.some(answer => !answer.selectedOptions.length && !answer.customAnswer);
  const hasTooManyAnswers = selectedAnswers.some(answer => answer.selectedOptions.length > 4);
  const reply = composed.join('\n');
  const tooLong = reply.length > 4000;
  const updateAnswer = (index: number, update: (answer: Answer) => Answer) =>
    setAnswers(values => ({ ...values, [index]: update(values[index] || emptyAnswer()) }));
  return <div className="authoring-clarification">
    {questions.map((item, index) => {
      const multiple = (item.selectionMode || defaultSelectionMode(item)) === 'multiple';
      const answer = answers[index] || emptyAnswer();
      const inputType = multiple ? 'checkbox' : 'radio';
      const inputName = `clarification-${messageId}-${index}`;
      return <fieldset key={index} disabled={disabled}>
        <legend>{item.question}</legend>
        <p className="authoring-clarification-selection-note">{multiple ? 'Select one or more.' : 'Select one.'}</p>
        <div className="authoring-clarification-options">{item.options.map(option => <label key={option} className={answer.options.includes(option) ? 'selected' : ''}>
          <input type={inputType} name={inputName} value={option} checked={answer.options.includes(option)}
            onChange={() => updateAnswer(index, current => multiple
              ? { ...current, options: current.options.includes(option) ? current.options.filter(value => value !== option) : [...current.options, option] }
              : { ...current, options: [option], custom: false })} />
          <span>{option}</span>
        </label>)}
          {item.allowCustomInput !== false && <label className={answer.custom ? 'selected' : ''}>
            <input type={inputType} name={inputName} value="custom" checked={answer.custom}
              onChange={() => updateAnswer(index, current => ({ ...current,
                custom: multiple ? !current.custom : true, options: multiple ? current.options : [] }))} />
            <span>Write my own answer</span>
          </label>}
        </div>
        {answer.custom && item.allowCustomInput !== false && <label className="authoring-clarification-custom">
          <span>Your answer</span>
          <textarea aria-label={`Your answer: ${item.question}`} value={answer.text} maxLength={500} rows={2}
            placeholder="Enter your answer…" onChange={event => updateAnswer(index, current => ({ ...current, text: event.target.value }))} />
        </label>}
      </fieldset>;
    })}
    {!disabled && <><button type="button" className="btn btn-outline" disabled={hasMissingAnswer || hasEmptyCustom || hasTooManyAnswers || tooLong}
      onClick={() => onConfirmAnswers({ messageId, answers: selectedAnswers }, reply)}>Confirm and continue</button>
      {hasEmptyCustom && <p className="authoring-clarification-error">Enter your own answer or unselect that option.</p>}
      {hasTooManyAnswers && <p className="authoring-clarification-error">Select up to four listed answers; you can also write your own answer.</p>}
      {tooLong && <p className="authoring-clarification-error">Shorten your answers to fit the 4,000-character message limit.</p>}
      <p className="authoring-clarification-note">Answer each question, then confirm to continue the task. Your unsent message is kept.</p></>}
  </div>;
}

export default function AuthoringClarification(props: Props) {
  const { messageId, questions } = props;
  if (!questions.length) return null;
  return <ClarificationChoices key={messageId} {...props} />;
}
