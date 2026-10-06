import { useEffect, useState } from 'react';
import { Check, ChevronDown, Clock3, Loader2, Wrench } from 'lucide-react';
import type { AuthoringSession, AuthoringTokenUsage } from '../../../services/api';

const stepLabels: Record<string, string> = {
  start: 'Task queued', dispatch_planning: 'Read sources and propose a teaching plan',
  clarify_requirements: 'Clarify teaching requirements', dispatch_approval: 'Generate approved questions',
  dispatch_retry: 'Resume unfinished work', model_call: 'Process your request', decision_saved: 'Choose the next action',
  output_saved: 'Prepare a revision', restoring: 'Restore a version', committing: 'Save the accepted version'
};
const tools: Record<string, string> = { prepare_prompt: 'Prepare teaching brief', retrieve_evidence: 'Retrieve source evidence',
  generate_and_review: 'Generate question · run checks',
  rework_and_review: 'Rework rejected draft · review again', saved: 'Save checked question', needs_attention: 'Review needed' };
const repairLabels: Record<string, string> = { feedback: 'Feedback only', answer: 'Answer redraft', instructions: 'Instruction correction',
  evidence: 'Source evidence refreshed', novelty: 'Distinct question focus', slice: 'Planned focus correction' };
export const elapsedLabel = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
};

const formatTokens = (value: number | null) => value == null ? 'Not reported' : value.toLocaleString();
const formatTokenSummary = (value: number) => value >= 10000
  ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : formatTokens(value);
const tokenUsageLabel = (usage?: AuthoringTokenUsage) => {
  if (!usage) return 'Token usage not recorded';
  if (usage.status === 'pending') return usage.totalTokens == null ? 'Token usage pending' : `${formatTokenSummary(usage.totalTokens)}+ tokens · usage pending`;
  if (usage.status === 'unavailable') return usage.calls === 0 && (usage.untrackedRuns || 0) > 0 ? 'Token usage not recorded' : 'Token usage unavailable';
  if (usage.status === 'partial') return usage.totalTokens == null ? 'Token usage partially recorded' : `${formatTokenSummary(usage.totalTokens)}+ tokens · recorded usage`;
  return usage.totalTokens == null ? 'Token usage unavailable' : `${formatTokenSummary(usage.totalTokens)} tokens`;
};

function TokenUsageDetails({ usage, label }: { usage?: AuthoringTokenUsage; label: string }) {
  const unrecorded = usage?.status === 'unavailable' && usage.calls === 0 && (usage.untrackedRuns || 0) > 0;
  return <section className="authoring-token-usage" aria-label={label}>
    <strong>{label}</strong>
    {!usage ? <p>No token usage was recorded for this execution.</p> : <>
      <dl>
        <div><dt>Input tokens</dt><dd>{formatTokens(usage.inputTokens)}
          {usage.cachedInputTokens != null && <small>Cached input: {formatTokens(usage.cachedInputTokens)}</small>}
          {usage.cacheWriteTokens != null && <small>Cache writes: {formatTokens(usage.cacheWriteTokens)}</small>}
        </dd></div>
        <div><dt>Output tokens</dt><dd>{formatTokens(usage.outputTokens)}
          {usage.reasoningTokens != null && <small>Reasoning: {formatTokens(usage.reasoningTokens)}</small>}
        </dd></div>
        <div><dt>{usage.status === 'partial' || usage.status === 'pending' ? 'Recorded total' : 'Total tokens'}</dt><dd>{formatTokens(usage.totalTokens)}</dd></div>
      </dl>
      {(usage.reasoningTokens != null || usage.cachedInputTokens != null || usage.cacheWriteTokens != null) && <p>Reasoning is part of output; cached input is part of input. These details are not added again. Cache writes are shown separately as reported.</p>}
      {!unrecorded && <p>{usage.reportedCalls.toLocaleString()} of {usage.calls.toLocaleString()} model {usage.calls === 1 ? 'call' : 'calls'} reported usage.
        {usage.pendingCalls > 0 && ` ${usage.pendingCalls.toLocaleString()} awaiting usage.`}
        {usage.unknownCalls > 0 && ` ${usage.unknownCalls.toLocaleString()} without reported usage.`}
      </p>}
      {unrecorded && <p>No token usage was recorded for this execution.</p>}
      {!unrecorded && (usage.untrackedRuns || 0) > 0 && <p>{usage.untrackedRuns!.toLocaleString()} earlier {usage.untrackedRuns === 1 ? 'execution has' : 'executions have'} no token usage record and {usage.untrackedRuns === 1 ? 'is' : 'are'} excluded from this total.</p>}
      {usage.status === 'partial' && <p>This is a recorded subtotal. Calls without reported usage are excluded; missing tokens are not estimated.</p>}
      {usage.status === 'pending' && <p>Usage is awaiting completed model calls. Any recorded total is a subtotal.</p>}
      {usage.status === 'unavailable' && !unrecorded && <p>The model calls did not return token usage. No total can be shown.</p>}
      {usage.models.length > 0 && <p>Models: {usage.models.join(', ')}</p>}
    </>}
  </section>;
}

export default function AuthoringProgress({ session, connected = false }: { session: AuthoringSession; connected?: boolean }) {
  const active = !!session.run && ['queued', 'running', 'waiting'].includes(session.run.status);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const events = session.assistant?.events || [];
  const steps = session.taskSteps || session.run?.steps || [];
  const generation = session.currentVersionId ? undefined : session.assistant?.generation;
  if (!events.length && !session.run && !session.tokenUsage) return null;
  const start = Date.parse(session.run?.startedAt || session.run?.createdAt || steps[0]?.createdAt || session.updatedAt);
  const finish = active ? now : Date.parse(session.run?.updatedAt || session.updatedAt);
  // Collapse repeated snapshots of the same action into one expandable tool row.
  const grouped: Array<{ name: string; text: string; createdAt: string; updates: number }> = [];
  [...events.map(event => ({ name: event.stage, text: event.message, createdAt: event.createdAt })),
    ...steps.map(step => ({ name: step.name, text: stepLabels[step.name] || 'Update saved task', createdAt: step.createdAt }))]
    .filter(step => Date.parse(step.createdAt) >= start)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).forEach(step => {
      const last = grouped.at(-1);
      if (last?.name === step.name) { last.text = step.text; last.updates++; }
      else grouped.push({ ...step, updates: 1 });
    });
  const operations = (session.operations || []).filter(item => item.runId === session.run?.id);
  const current = generation?.items.find(item => item.status === 'generating');
  return <div className="authoring-task-trace">
    <div className="authoring-live-line" role="status">{active ? <Loader2 size={14} className="spin" /> : <Clock3 size={14} />}<span>{active ? current ? `Question ${current.index + 1} · ${tools[current.phase || ''] || 'Generating'}` : operations.filter(item => item.status === 'running').at(-1)?.label || grouped.at(-1)?.text || 'Working' : generation ? `${generation.readyCount}/${generation.totalQuestions} questions checked` : 'Task finished'}</span></div>
    <details className="authoring-progress" aria-label="Task steps">
      <summary><span className="authoring-progress-metrics">{session.run || steps.length ? `${active ? 'Working' : 'Worked'} for ${elapsedLabel(finish - start)} · ` : ''}{tokenUsageLabel(session.run?.tokenUsage)}</span> <ChevronDown size={13} /><small>{active ? connected ? 'Live' : 'Reconnecting · saved progress available' : 'Saved steps'}</small></summary>
      <TokenUsageDetails usage={session.run?.tokenUsage} label="This execution" />
      {session.tokenUsage && <details className="authoring-conversation-usage" aria-label="Conversation token usage">
        <summary>Conversation total · {tokenUsageLabel(session.tokenUsage)}</summary>
        <TokenUsageDetails usage={session.tokenUsage} label="All executions in this conversation" />
      </details>}
      {operations.length > 0 && <ol aria-label="Recorded operations">{operations.map(item => <li key={item.id} className={item.parentId ? 'authoring-operation-child' : ''}>
        {item.status === 'running' && active ? <Loader2 size={13} className="spin" /> : item.status === 'completed' ? <Check size={13} /> : <Wrench size={13} />}
        <details><summary>{item.label}</summary><small>{item.status === 'running' && !active ? 'Completion was not recorded' : item.status} · {new Date(item.startedAt).toLocaleTimeString()}{item.durationMs != null ? ` · ${elapsedLabel(item.durationMs)}` : ''}</small>{item.summary && <p>{item.summary}</p>}</details>
      </li>)}</ol>}
      {!operations.length && <ol>{grouped.map((step, index) => <li key={index}><Wrench size={13} /><details><summary>{stepLabels[step.name] || step.name.replaceAll('-', ' ')}</summary><p>{step.text}</p><small>{new Date(step.createdAt).toLocaleTimeString()}{step.updates > 1 ? ` · ${step.updates} progress updates` : ''}</small></details></li>)}</ol>}
      {generation && <ul className="authoring-question-checks">{generation.items.map(item => <li key={item.index}>{item.status === 'ready' ? <Check size={14} /> : <Wrench size={14} />}<div>Question {item.index + 1} · {item.status === 'ready' ? 'Checked' : item.status === 'failed' ? 'Needs attention' : tools[item.phase || ''] || 'Queued'}{(item.attempts || 0) > 1 && <small>Automatic rework used (1 of 1){repairLabels[item.repairStrategy || ''] ? ` · ${repairLabels[item.repairStrategy!]}` : ''}</small>}{item.startedAt && item.completedAt && <small>{elapsedLabel(Date.parse(item.completedAt) - Date.parse(item.startedAt))}</small>}{item.message && <p>{item.message}</p>}</div></li>)}</ul>}
      <p>Recorded actions and checks. AI review can be wrong; inspect the question and its sources before sharing.</p>
    </details>
  </div>;
}
