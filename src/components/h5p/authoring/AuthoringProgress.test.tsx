import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import AuthoringProgress from './AuthoringProgress';
import type { AuthoringSession, AuthoringTokenUsage } from '../../../services/api';

it.each([
  ['evidence', 'Source evidence refreshed'], ['novelty', 'Distinct question focus'], ['slice', 'Planned focus correction']
])('shows the actual %s rework strategy while the task continues', (repairStrategy, label) => {
  const session = { id: 'task1', status: 'generating', updatedAt: '2026-10-02', run: { id: 'run1', status: 'running',
    checkpoint: 'dispatch_approval', startedAt: '2026-10-02' }, assistant: { events: [], generation: {
      readyCount: 0, totalQuestions: 1, items: [{ index: 0, status: 'generating', phase: 'rework_and_review', attempts: 2, repairStrategy }]
    } } } as AuthoringSession;
  render(<AuthoringProgress session={session} connected />);
  expect(screen.getByRole('status')).toHaveTextContent('Question 1 · Rework rejected draft · review again');
  expect(screen.queryByText('Task finished')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Task steps').querySelector('summary')!);
  expect(screen.getByText(`Automatic rework used (1 of 1) · ${label}`)).toBeVisible();
});

const reportedUsage = (overrides: Partial<AuthoringTokenUsage> = {}): AuthoringTokenUsage => ({
  inputTokens: 20000, outputTokens: 5000, totalTokens: 25000,
  reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null,
  calls: 2, reportedCalls: 2, pendingCalls: 0, unknownCalls: 0,
  status: 'complete', models: ['gpt-6-luna'], ...overrides,
});
const sessionWithUsage = (tokenUsage?: AuthoringTokenUsage): AuthoringSession => ({
  id: 'task1', title: 'Teaching task', courseId: 'course1', quizId: null, materialIds: [],
  instructions: '', autoApprove: false, revision: 1, status: 'ready', error: '',
  currentVersionId: null, candidateVersionId: null, messages: [], versions: [], assistant: null,
  run: { id: 'run1', status: 'succeeded', checkpoint: 'output_saved', tokenUsage,
    startedAt: '2026-10-02T12:00:00Z', updatedAt: '2026-10-02T12:00:12Z' },
  updatedAt: '2026-10-02T12:00:12Z',
});
const openTaskSteps = () => {
  const details = screen.getByLabelText('Task steps');
  fireEvent.click(details.querySelector('summary')!);
  return details;
};

it('shows compact tokens beside elapsed time and exact tokens in the details', () => {
  render(<AuthoringProgress session={sessionWithUsage(reportedUsage())} />);
  const details = screen.getByLabelText('Task steps');
  expect(details.querySelector('summary')).toHaveTextContent(`Worked for 12s · 25k tokens`);
  openTaskSteps();
  const usage = screen.getByRole('region', { name: 'This execution' });
  expect(within(usage).getByText('Input tokens').nextElementSibling).toHaveTextContent((20000).toLocaleString());
  expect(within(usage).getByText('Output tokens').nextElementSibling).toHaveTextContent((5000).toLocaleString());
  expect(within(usage).getByText('Total tokens').nextElementSibling).toHaveTextContent((25000).toLocaleString());
  expect(within(usage).getByText('2 of 2 model calls reported usage.')).toBeVisible();
  expect(within(usage).getByText('Models: gpt-6-luna')).toBeVisible();
});

it('labels partial totals as recorded subtotals without estimating missing calls', () => {
  render(<AuthoringProgress session={sessionWithUsage(reportedUsage({ status: 'partial', calls: 3, unknownCalls: 1 }))} />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent(`25k+ tokens · recorded usage`);
  openTaskSteps();
  const usage = screen.getByRole('region', { name: 'This execution' });
  expect(within(usage).getByText('Recorded total').nextElementSibling).toHaveTextContent((25000).toLocaleString());
  expect(usage).toHaveTextContent('2 of 3 model calls reported usage. 1 without reported usage.');
  expect(within(usage).getByText(/Calls without reported usage are excluded; missing tokens are not estimated/)).toBeVisible();
});

it('distinguishes unavailable provider usage from an old snapshot without a receipt', () => {
  const unavailable = reportedUsage({ status: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null,
    reportedCalls: 0, unknownCalls: 2 });
  const { rerender } = render(<AuthoringProgress session={sessionWithUsage(unavailable)} />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent('Token usage unavailable');
  openTaskSteps();
  const usage = screen.getByRole('region', { name: 'This execution' });
  expect(within(usage).getByText('Total tokens').nextElementSibling).toHaveTextContent('Not reported');
  expect(within(usage).getByText(/The model calls did not return token usage/)).toBeVisible();
  rerender(<AuthoringProgress session={sessionWithUsage()} />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent('Token usage not recorded');
  expect(screen.getByText('No token usage was recorded for this execution.')).toBeVisible();
  expect(screen.queryByText('0 tokens')).not.toBeInTheDocument();
});

it('shows pending usage during live work and updates when the call reports usage', () => {
  const pending = reportedUsage({ status: 'pending', inputTokens: null, outputTokens: null, totalTokens: null,
    calls: 1, reportedCalls: 0, pendingCalls: 1 });
  const session = sessionWithUsage(pending);
  session.run!.status = 'running';
  const { rerender } = render(<AuthoringProgress session={session} connected />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent('Token usage pending');
  openTaskSteps();
  expect(screen.getByRole('region', { name: 'This execution' })).toHaveTextContent('1 awaiting usage.');
  rerender(<AuthoringProgress session={sessionWithUsage(reportedUsage())} connected />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent(`25k tokens`);
  expect(screen.queryByText(/awaiting completed model calls/)).not.toBeInTheDocument();
});

it('retains the known subtotal while other live calls are still pending', () => {
  render(<AuthoringProgress session={sessionWithUsage(reportedUsage({ status: 'pending', calls: 3, pendingCalls: 1 }))} />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent(`25k+ tokens · usage pending`);
  openTaskSteps();
  expect(screen.getByText('Recorded total').nextElementSibling).toHaveTextContent((25000).toLocaleString());
});

it('shows genuine zero token usage when a model call reported zero', () => {
  render(<AuthoringProgress session={sessionWithUsage(reportedUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0,
    calls: 1, reportedCalls: 1 }))} />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent('Worked for 12s · 0 tokens');
  openTaskSteps();
  const usage = screen.getByRole('region', { name: 'This execution' });
  expect(within(usage).getByText('Total tokens').nextElementSibling).toHaveTextContent(/^0$/);
  expect(within(usage).getByText('1 of 1 model call reported usage.')).toBeVisible();
  expect(within(usage).queryByText('Not reported')).not.toBeInTheDocument();
});

it('shows reasoning and cache details under their parent usage without adding them to total', () => {
  render(<AuthoringProgress session={sessionWithUsage(reportedUsage({ reasoningTokens: 2000,
    cachedInputTokens: 12000, cacheWriteTokens: 1000 }))} />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent(`25k tokens`);
  openTaskSteps();
  const usage = screen.getByRole('region', { name: 'This execution' });
  const input = within(usage).getByText('Input tokens').nextElementSibling!;
  const output = within(usage).getByText('Output tokens').nextElementSibling!;
  expect(within(input as HTMLElement).getByText(`Cached input: ${(12000).toLocaleString()}`)).toBeVisible();
  expect(within(input as HTMLElement).getByText(`Cache writes: ${(1000).toLocaleString()}`)).toBeVisible();
  expect(within(output as HTMLElement).getByText(`Reasoning: ${(2000).toLocaleString()}`)).toBeVisible();
  expect(within(usage).getByText('Total tokens').nextElementSibling).toHaveTextContent((25000).toLocaleString());
  expect(within(usage).queryByText((40000).toLocaleString())).not.toBeInTheDocument();
  expect(within(usage).getByText(/These details are not added again/)).toBeVisible();
});

it('keeps execution tokens separate from the cumulative conversation total across retries', () => {
  const session = sessionWithUsage(reportedUsage());
  session.tokenUsage = reportedUsage({ inputTokens: 40000, outputTokens: 10000, totalTokens: 50000, calls: 4, reportedCalls: 4 });
  render(<AuthoringProgress session={session} />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent(`25k tokens`);
  openTaskSteps();
  const cumulative = screen.getByLabelText('Conversation token usage');
  expect(cumulative.querySelector('summary')).toHaveTextContent(`Conversation total · 50k tokens`);
  fireEvent.click(cumulative.querySelector('summary')!);
  const usage = screen.getByRole('region', { name: 'All executions in this conversation' });
  expect(within(usage).getByText('Total tokens').nextElementSibling).toHaveTextContent((50000).toLocaleString());
  expect(within(usage).getByText('4 of 4 model calls reported usage.')).toBeVisible();
});

it('does not discard a cumulative receipt when the snapshot has no operations or current run', () => {
  const session = sessionWithUsage();
  session.run = null;
  session.tokenUsage = reportedUsage();
  render(<AuthoringProgress session={session} />);
  openTaskSteps();
  expect(screen.getByLabelText('Conversation token usage').querySelector('summary')).toHaveTextContent(`25k tokens`);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).not.toHaveTextContent('Worked for 0s');
});

it('recognizes the backend legacy marker without claiming that a provider omitted usage', () => {
  const legacy = reportedUsage({ inputTokens: null, outputTokens: null, totalTokens: null,
    calls: 0, reportedCalls: 0, unknownCalls: 0, untrackedRuns: 1, status: 'unavailable', models: [] });
  render(<AuthoringProgress session={sessionWithUsage(legacy)} />);
  expect(screen.getByLabelText('Task steps').querySelector('summary')).toHaveTextContent('Token usage not recorded');
  openTaskSteps();
  const usage = screen.getByRole('region', { name: 'This execution' });
  expect(within(usage).getByText('No token usage was recorded for this execution.')).toBeVisible();
  expect(within(usage).getByText('Total tokens').nextElementSibling).toHaveTextContent('Not reported');
  expect(within(usage).queryByText(/model calls did not return/)).not.toBeInTheDocument();
  expect(within(usage).queryByText(/0 of 0 model calls/)).not.toBeInTheDocument();
});

it('explains unrecorded earlier executions even when all tracked calls reported usage', () => {
  const session = sessionWithUsage(reportedUsage());
  session.tokenUsage = reportedUsage({ status: 'partial', untrackedRuns: 2 });
  render(<AuthoringProgress session={session} />);
  openTaskSteps();
  const cumulative = screen.getByLabelText('Conversation token usage');
  expect(cumulative.querySelector('summary')).toHaveTextContent(`25k+ tokens · recorded usage`);
  fireEvent.click(cumulative.querySelector('summary')!);
  const usage = screen.getByRole('region', { name: 'All executions in this conversation' });
  expect(within(usage).getByText('2 of 2 model calls reported usage.')).toBeVisible();
  expect(within(usage).getByText('2 earlier executions have no token usage record and are excluded from this total.')).toBeVisible();
  expect(within(usage).getByText('Recorded total').nextElementSibling).toHaveTextContent((25000).toLocaleString());
});
