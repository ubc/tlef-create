import type { TeachingRequirements } from '../../../services/api';

const labels: Record<string, string> = { topic: 'Topic', audience: 'Audience', purpose: 'Purpose',
  difficulty: 'Difficulty', questionCount: 'Question count', questionTypes: 'Question types',
  mustCover: 'Required coverage', exclusions: 'Exclude' };

export default function TeachingRequirementsCard({ requirements }: { requirements: TeachingRequirements }) {
  const fields = Object.entries(requirements.fields || {}).filter(([key]) => labels[key]);
  if (!fields.length && !requirements.countIssue && !requirements.openQuestions?.length) return null;
  return <details className="authoring-requirements">
    <summary>Teaching requirements · {fields.length} recorded</summary>
    <p>Saved from your messages and plan edits. Tell CREATE what to change in the chat.</p>
    <dl>{fields.map(([key, field]) => <div key={key}><dt>{labels[key]}</dt><dd>{String(field.value)}{field.approximate ? ' (approximately)' : ''}<small>{field.source === 'plan-edit' ? 'From your saved teaching plan' : field.quote ? `You said: “${field.quote}”` : 'From your message'}</small></dd></div>)}</dl>
    {requirements.countIssue && <p role="status">{requirements.countIssue}</p>}
    {!!requirements.openQuestions?.length && <ul>{requirements.openQuestions.map((question, i) => <li key={i}>{question}</li>)}</ul>}
  </details>;
}
