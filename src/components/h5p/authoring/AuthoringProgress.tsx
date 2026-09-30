import type { AuthoringSession } from '../../../services/api';

const stepLabels: Record<string, string> = {
  start: 'Task queued', dispatch_planning: 'Read sources and propose a teaching plan',
  dispatch_approval: 'Generate questions from the approved plan', dispatch_retry: 'Resume the saved task',
  model_call: 'Process your request', decision_saved: 'Choose the next action', output_saved: 'Prepare a revision',
  restoring: 'Restore a saved version', committing: 'Save the accepted version'
};
export default function AuthoringProgress({ session }: { session: AuthoringSession }) {
  const events = session.assistant?.events || [];
  const steps = session.taskSteps || session.run?.steps || [];
  const generation = session.assistant?.generation;
  if (!events.length && !session.run) return null;
  return <details className="authoring-progress" aria-label="Task steps">
    <summary>Task steps · {generation ? `${generation.readyCount}/${generation.totalQuestions} questions prepared` : events.at(-1)?.message || stepLabels[session.run?.checkpoint || 'start'] || 'Saved progress'}</summary>
    <ol>{[...events.map(event => ({ text: event.message, createdAt: event.createdAt })),
      ...(steps.length ? steps : session.run ? [{ name: session.run.checkpoint, createdAt: session.updatedAt }] : []).map(step => ({ text: stepLabels[step.name] || 'Update saved task', createdAt: step.createdAt }))]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map((step, index) => <li key={index}><span>{step.text}</span><small>{new Date(step.createdAt).toLocaleTimeString()}</small></li>)}</ol>
    {generation && <ul>{generation.items.map(item => <li key={item.index}>Question {item.index + 1} · {item.status === 'ready' ? 'Prepared' : item.status === 'failed' ? 'Needs attention' : item.status === 'generating' ? 'Generating and checking' : 'Queued'}{item.message && <p>{item.message}</p>}</li>)}</ul>}
    <p>These are saved task actions and checks. Expand a failed question below for its draft and review observations.</p>
  </details>;
}
