import type { QuestionReviewSummary } from '../../../services/api';

const checkLabels: Record<keyof QuestionReviewSummary['checks'], string> = {
  contentIsValid: 'Task content', answerIsCorrect: 'Answer', rubricIsAppropriate: 'Assessment criteria',
  feedbackIsConsistent: 'Feedback', followsInstructorRequest: 'Teaching requirements', evidenceIsSufficient: 'Supporting evidence',
};

export default function QuestionCheckSummary({ summary }: { summary?: QuestionReviewSummary }) {
  if (!summary) return null;
  const checks = Object.entries(summary.checks).filter(([, passed]) => typeof passed === 'boolean');
  return <details className="authoring-question-checks">
    <summary>AI text check completed</summary>
    <ul>{checks.map(([key, passed]) => <li key={key}>{checkLabels[key as keyof typeof checkLabels]}: {passed ? 'passed' : 'needs review'}</li>)}</ul>
    {!!summary.arithmeticChecks && <p>{summary.arithmeticChecks} declared arithmetic calculation{summary.arithmeticChecks === 1 ? '' : 's'} verified.</p>}
    <p>Review the task and answer yourself. This text check can miss errors and does not inspect images, audio or video.</p>
  </details>;
}
