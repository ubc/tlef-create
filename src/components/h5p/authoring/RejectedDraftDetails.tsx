import type { StudioAssistantSession } from '../../../services/api';

type Review = NonNullable<NonNullable<StudioAssistantSession['generation']>['items'][number]['review']>;
const display = (value: number) => Number(value.toPrecision(15));

export default function RejectedDraftDetails({ review }: { review: Review }) {
  const check = review.calculationCheck;
  return <div>
    <strong>Rejected draft — not published</strong>
    <p>{review.questionText}</p>
    <ul>{review.options.map((option, index) => <li key={index}>{option.text}{option.isCorrect ? ' (draft answer key)' : ''}</li>)}</ul>
    <strong>Failure details</strong>
    {check && <section aria-label="Calculation check">
      <p><strong>Calculation check ({check.location})</strong></p>
      <p><code>{check.expression}</code> evaluates to {display(check.computed)}; the feedback claimed {display(check.claimed)}. The answer key was not changed.</p>
      <p>This checks the arithmetic in feedback, not the correctness of the entire question.</p>
    </section>}
    <p><strong>AI review observations</strong></p>
    {review.issues.length ? <ul>{review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
      : <p>The AI review did not return a detailed observation.</p>}
    <p>AI observations may need instructor review.</p>
  </div>;
}
