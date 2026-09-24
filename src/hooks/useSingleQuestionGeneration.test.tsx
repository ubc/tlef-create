import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSingleQuestionGeneration } from './useSingleQuestionGeneration';
import { useQuestionGenerationJob } from './useQuestionGenerationJob';
import type { QuestionGenerationJob } from '../services/api';

const mocks = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), list: vi.fn(), abandon: vi.fn() }));
vi.mock('../services/api', () => ({ questionsApi: {
  startQuestionGeneration: mocks.start, getGenerationJob: mocks.get, listGenerationJobs: mocks.list, abandonUnconfirmedGeneration: mocks.abandon
} }));
const config = { questionType: 'multiple-choice', customPrompt: 'Use condensation on a cold glass.', useCustomPromptOnly: true };
function receipt(status: QuestionGenerationJob['status'] = 'running', requestId = 'recovered'): QuestionGenerationJob {
  return { requestId, jobId: requestId, quizId: 'quiz1', sessionId: `session-${requestId}`, mode: 'append', status,
    totalQuestions: 1, completedQuestions: status === 'succeeded' ? 1 : 0, failedQuestions: 0,
    questionIds: status === 'succeeded' ? ['published-question'] : [], items: [], createdAt: '2026-09-20', updatedAt: '2026-09-20' };
}
async function single() {
  const hook = renderHook(() => useSingleQuestionGeneration('quiz1', 'owner1'));
  await act(async () => {});
  let outcome: { questionId?: string; error?: Error } | undefined;
  act(() => { void hook.result.current.generate(config).then(questionId => { outcome = { questionId }; }, error => { outcome = { error }; }); });
  await act(async () => {});
  return { ...hook, outcome: () => outcome };
}
describe('durable question generation recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear();
    mocks.list.mockResolvedValue([]);
    mocks.start.mockImplementation(async (_quiz, _session, _configs, options) => {
      const job = receipt('running', options.requestId);
      mocks.get.mockResolvedValue(job);
      return { success: true, sessionId: job.sessionId, job };
    });
  });
  afterEach(() => vi.useRealTimers());

  it('waits for published IDs, not prepared drafts or elapsed streaming deadlines', async () => {
    const hook = await single();
    await act(async () => { await vi.advanceTimersByTimeAsync(215_000); });
    expect(hook.outcome()).toBeUndefined();
    expect(mocks.start).toHaveBeenCalledOnce();
    const id = mocks.start.mock.calls[0][3].requestId;
    mocks.get.mockResolvedValue(receipt('succeeded', id));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(hook.outcome()).toEqual({ questionId: 'published-question' });
    expect(hook.result.current.isGenerating).toBe(false);
  });

  it('recovers a lost submission response without a second paid POST', async () => {
    mocks.start.mockImplementation(async (_quiz, _session, _configs, options) => {
      mocks.get.mockResolvedValue(receipt('running', options.requestId));
      throw Object.assign(new Error('Response lost'), { status: 502 });
    });
    const hook = await single();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(hook.outcome()).toBeUndefined();
    await act(async () => { await expect(hook.result.current.generate(config)).rejects.toThrow('active'); });
    mocks.get.mockResolvedValue(receipt('succeeded', mocks.start.mock.calls[0][3].requestId));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(hook.outcome()?.questionId).toBe('published-question');
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it('recovers after unmount/reload with no local receipt and never resubmits', async () => {
    const first = await single();
    const id = mocks.start.mock.calls[0][3].requestId;
    first.unmount();
    sessionStorage.clear();
    mocks.list.mockResolvedValue([receipt('running', id)]);
    const settled = vi.fn();
    const recovered = renderHook(() => useQuestionGenerationJob('quiz1', 'owner1', settled));
    await act(async () => {});
    expect(recovered.result.current.isBusy).toBe(true);
    mocks.get.mockResolvedValue(receipt('succeeded', id));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it.each(['failed', 'interrupted', 'conflict'] as const)('reports %s without claiming staged questions were saved', async status => {
    const hook = await single();
    mocks.get.mockResolvedValue({ ...receipt(status, mocks.start.mock.calls[0][3].requestId), completedQuestions: 1, message: 'Saved questions preserved.' });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(hook.outcome()?.questionId).toBeUndefined();
    expect(hook.outcome()?.error?.message).toBe('Saved questions preserved.');
    expect(hook.result.current.isBusy).toBe(false);
  });

  it('retains an uncertain receipt during an outage and supports manual status checking', async () => {
    const hook = await single();
    mocks.get.mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(hook.result.current.recoveryMessage).toContain('does not mean generation failed');
    expect(hook.result.current.isBusy).toBe(true);
    mocks.get.mockResolvedValue(receipt('succeeded', mocks.start.mock.calls[0][3].requestId));
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.outcome()?.questionId).toBe('published-question');
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it('passes safe replacement intent while storing no prompts or question text', async () => {
    const hook = renderHook(() => useQuestionGenerationJob('quiz1', 'owner1'));
    await act(async () => {});
    act(() => { void hook.result.current.start([config], 'replace').catch(() => {}); });
    await act(async () => {});
    expect(mocks.start).toHaveBeenCalledWith('quiz1', expect.any(String), [config], expect.objectContaining({ mode: 'replace', requestId: expect.any(String) }));
    expect(sessionStorage.getItem('create:question-job:owner1:quiz1')).toBe(mocks.start.mock.calls[0][3].requestId);
    expect(JSON.stringify(sessionStorage)).not.toContain(config.customPrompt);
  });

  it('does not show a previous learning object result after switching objects', async () => {
    let resolve!: (job: QuestionGenerationJob) => void;
    const first = receipt();
    mocks.list.mockResolvedValueOnce([first]).mockResolvedValue([]);
    const hook = renderHook(({ id }) => useQuestionGenerationJob(id, 'owner1'), { initialProps: { id: 'quiz1' } });
    await act(async () => {});
    mocks.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    act(() => { void hook.result.current.refresh(); });
    hook.rerender({ id: 'quiz2' });
    await act(async () => { resolve(receipt('succeeded')); });
    expect(hook.result.current.job).toBeNull();
  });

  it.each(['interrupted', 'running'] as const)('asks the server to fence an unregistered request and respects a %s result', async status => {
    sessionStorage.setItem('create:question-job:owner1:quiz1', 'missing-request');
    mocks.get.mockRejectedValue(Object.assign(new Error('No receipt'), { status: 404 }));
    const hook = renderHook(() => useQuestionGenerationJob('quiz1', 'owner1'));
    await act(async () => {});
    expect(hook.result.current.unregistered).toBe(true);
    expect(hook.result.current.isBusy).toBe(true);
    mocks.abandon.mockResolvedValue(receipt(status, 'missing-request'));
    await act(async () => { await hook.result.current.closeUnregistered(); });
    expect(mocks.abandon).toHaveBeenCalledWith('quiz1', 'missing-request');
    expect(hook.result.current.isBusy).toBe(status === 'running');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('does not forget an unregistered request when the server cannot fence it', async () => {
    sessionStorage.setItem('create:question-job:owner1:quiz1', 'missing-request');
    mocks.get.mockRejectedValue(Object.assign(new Error('No receipt'), { status: 404 }));
    mocks.abandon.mockRejectedValue(new Error('offline'));
    const hook = renderHook(() => useQuestionGenerationJob('quiz1', 'owner1'));
    await act(async () => { });
    await act(async () => { await hook.result.current.closeUnregistered(); });
    expect(hook.result.current.isBusy).toBe(true);
    expect(sessionStorage.getItem('create:question-job:owner1:quiz1')).toBe('missing-request');
    expect(hook.result.current.recoveryMessage).toContain('could not confirm');
  });

  it('keeps explicit authorization failures actionable', async () => {
    mocks.start.mockRejectedValue(Object.assign(new Error('Sign in again.'), { status: 401 }));
    const hook = await single();
    expect(hook.outcome()?.error?.message).toBe('Sign in again.');
    expect(sessionStorage.getItem('create:question-job:owner1:quiz1')).toBeNull();
  });
});
