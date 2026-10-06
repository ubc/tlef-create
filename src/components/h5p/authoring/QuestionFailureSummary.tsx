import type { StudioQuestionGenerationItem } from '../../../services/api';

const stageLabels: Record<string, string> = {
  preparation: 'Prepare the teaching brief', prepare_prompt: 'Prepare the teaching brief',
  evidence: 'Retrieve source evidence', retrieve_evidence: 'Retrieve source evidence',
  generation: 'Generate the question', generate_and_review: 'Generate and check the question',
  review: 'Check the question', rework_and_review: 'Rework and check the question',
  saving: 'Save the checked question', saved: 'Save the checked question'
};

export function QuestionFailureDetails({ item, working = false }: { item: StudioQuestionGenerationItem; working?: boolean }) {
  const failure = item.failure;
  return <div className="authoring-failure-details">
    <p><strong>Stage:</strong> {stageLabels[failure?.stage || item.phase || ''] || 'Not recorded'}</p>
    <p>{failure?.message || item.message || 'No detailed failure reason was saved for this attempt.'}</p>
    {!working && failure?.recovery && <p><strong>Next step:</strong> {failure.recovery}</p>}
    {(failure?.code || item.code || item.reason) && <small>Error code: {failure?.code || item.code || item.reason}</small>}
  </div>;
}

export default function QuestionFailureSummary({ items, working = false }: { items: StudioQuestionGenerationItem[]; working?: boolean }) {
  const groups = new Map<string, { item: StudioQuestionGenerationItem; count: number }>();
  for (const item of items.filter(item => item.status === 'failed')) {
    const key = JSON.stringify([item.failure?.code || item.code || item.reason, item.failure?.stage || item.phase,
      item.failure?.message || item.message, item.failure?.recovery]);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { item, count: 1 });
  }
  if (!groups.size) return null;
  return <div className="authoring-failure-summary" aria-label="Generation failure reasons">
    <h3>{working ? 'Why a question needs attention' : 'Why generation stopped'}</h3>
    {[...groups.values()].map(({ item, count }, index) => <div key={index}>
      <strong>{count} {count === 1 ? 'question affected' : 'questions affected'}</strong>
      <QuestionFailureDetails item={item} working={working} />
    </div>)}
  </div>;
}
