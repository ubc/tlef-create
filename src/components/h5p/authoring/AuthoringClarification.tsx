import { useState } from 'react';
import type { AuthoringClarification as Clarification } from '../../../services/api';

interface Props {
  messageId: string; questions: Clarification[]; disabled: boolean;
  onUseAnswers: (text: string) => void;
}

export default function AuthoringClarification({ messageId, questions, disabled, onUseAnswers }: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  if (!questions.length) return null;
  return <div className="authoring-clarification">
    {questions.map((item, index) => <fieldset key={index} disabled={disabled}>
      <legend>{item.question}</legend>
      <div className="authoring-clarification-options">{item.options.map(option => <label key={option} className={answers[index] === option ? 'selected' : ''}>
        <input type="radio" name={`clarification-${messageId}-${index}`} value={option} checked={answers[index] === option}
          onChange={() => setAnswers(values => ({ ...values, [index]: option }))} />
        <span>{option}</span>
      </label>)}</div>
    </fieldset>)}
    {!disabled && <><button type="button" className="btn btn-outline" disabled={!Object.keys(answers).length}
      onClick={() => onUseAnswers(['Apply these choices to the current task, keeping the other confirmed requirements:',
        ...questions.flatMap((item, index) => answers[index] ? [`${item.question} ${answers[index]}`] : [])].join('\n'))}>Use selected answers</button>
      <p className="authoring-clarification-note">Review your reply below, then send it. You can also write your own answer.</p></>}
  </div>;
}
