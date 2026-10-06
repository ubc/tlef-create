import { jest } from '@jest/globals';
import { normalizeModelTokenUsage, summarizeModelTokenReceipts, createModelTokenReceiptRecorder } from '../../services/authoring/authoringTokenUsage.js';
import { withAuthoringOperations, getAuthoringOperationScope } from '../../services/authoring/authoringOperations.js';

const scope = { owner: 'owner-1', runId: 'run-1', sessionId: 'session-1', parentId: 'operation-1', operationName: 'review_question' };
const usage = { input_tokens: 100, output_tokens: 40, total_tokens: 140,
  input_tokens_details: { cached_tokens: 60, cache_write_tokens: 20 }, output_tokens_details: { reasoning_tokens: 15 } };
const reported = (id, values = {}) => ({ _id: id, runId: 'run-1', status: 'reported', model: 'gpt-6-luna', ...normalizeModelTokenUsage(usage), ...values });
const memoryStore = () => {
  const documents = new Map();
  const Receipt = { updateOne: jest.fn(async (filter, update) => {
    documents.set(filter._id, { ...(documents.get(filter._id) || structuredClone(update.$setOnInsert)), ...structuredClone(update.$set) });
    return { matchedCount: 1 };
  }) };
  return { documents, Receipt, Run: { updateOne: jest.fn() } };
};

describe('provider token counter normalization', () => {
  test('sums input and output only, retaining reasoning and cached subsets', () => {
    expect(normalizeModelTokenUsage(usage)).toEqual({ inputTokens: 100, outputTokens: 40, totalTokens: 140,
      cachedInputTokens: 60, cacheWriteTokens: 20, reasoningTokens: 15 });
  });
  test('accepts Chat counters and never invents absent subset counters', () => {
    expect(normalizeModelTokenUsage({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15,
      completion_tokens_details: { reasoning_tokens: 1 } })).toEqual({ inputTokens: 12, outputTokens: 3, totalTokens: 15,
      reasoningTokens: 1, cachedInputTokens: null, cacheWriteTokens: null });
  });
  test('supports toolkit and Ollama counters, including explicit zero', () => {
    expect(normalizeModelTokenUsage({ promptTokens: 12, completionTokens: 3 }).totalTokens).toBe(15);
    expect(normalizeModelTokenUsage({ prompt_eval_count: 0, eval_count: 0 }).totalTokens).toBe(0);
    expect(normalizeModelTokenUsage(null).totalTokens).toBeNull();
  });
  test('rejects strings, negative, fractional and unsafe counts', () => {
    expect(normalizeModelTokenUsage({ input_tokens: '20', output_tokens: -1, total_tokens: Infinity }).totalTokens).toBeNull();
    expect(normalizeModelTokenUsage({ promptTokens: 0.5, completionTokens: Number.MAX_SAFE_INTEGER + 1 }).inputTokens).toBeNull();
  });
});

describe('durable task usage summaries', () => {
  test('deduplicates receipt identities and includes failed paid attempts', () => {
    const failed = reported('repair', { outcome: 'failed' });
    expect(summarizeModelTokenReceipts([reported('draft'), failed, failed])).toMatchObject({
      calls: 2, reportedCalls: 2, inputTokens: 200, outputTokens: 80, totalTokens: 280, status: 'complete' });
  });
  test('reports a known subtotal when another call has no usage', () => {
    expect(summarizeModelTokenReceipts([reported('draft'), { _id: 'outage', runId: 'run-1', status: 'unavailable' }]))
      .toMatchObject({ totalTokens: 140, unknownCalls: 1, reportedCalls: 1, status: 'partial' });
  });
  test('pending receipts become unknown after their execution terminates', () => {
    const receipts = [{ _id: 'pending', runId: 'run-1', status: 'pending' }];
    expect(summarizeModelTokenReceipts(receipts, { activeRunIds: ['run-1'] }))
      .toMatchObject({ totalTokens: null, pendingCalls: 1, unknownCalls: 0, status: 'pending' });
    expect(summarizeModelTokenReceipts(receipts))
      .toMatchObject({ totalTokens: null, pendingCalls: 0, unknownCalls: 1, status: 'unavailable' });
  });
  test('distinguishes free executions from unrecorded historical executions', () => {
    expect(summarizeModelTokenReceipts([])).toMatchObject({ totalTokens: 0, status: 'complete' });
    expect(summarizeModelTokenReceipts([], { untrackedRuns: 1 })).toMatchObject({ totalTokens: null, status: 'unavailable' });
    expect(summarizeModelTokenReceipts([reported('new')], { untrackedRuns: 1 })).toMatchObject({ totalTokens: 140, status: 'partial' });
  });
  test('a total-only provider receipt does not fabricate input/output breakdowns', () => {
    expect(summarizeModelTokenReceipts([{ _id: 'total-only', runId: 'run-1', status: 'reported', totalTokens: 10 }]))
      .toMatchObject({ totalTokens: 10, inputTokens: null, outputTokens: null, status: 'partial' });
  });
  test('preserves a reported input subtotal when the provider omits output and total', () => {
    expect(summarizeModelTokenReceipts([{ _id: 'input-only', runId: 'run-1', status: 'unavailable', inputTokens: 12 }]))
      .toMatchObject({ inputTokens: 12, outputTokens: null, totalTokens: null, unknownCalls: 1, status: 'unavailable' });
  });
});

describe('one receipt per actual model invocation', () => {
  test('counts concurrent requests once and writes only allowlisted counters', async () => {
    const store = memoryStore();
    const record = createModelTokenReceiptRecorder({ ...store, scopeFor: () => scope });
    await Promise.all([1, 2].map(index => record({ provider: 'openai', model: 'gpt-6-luna' }, async receipt => {
      receipt.capture({ usage, responseId: `response-${index}`, model: 'gpt-6-luna', prompt: 'private', apiKey: 'secret' });
      receipt.capture({ responseId: `response-${index}` });
      return 'paid result';
    })));
    const receipts = [...store.documents.values()];
    expect(receipts).toHaveLength(2);
    expect(summarizeModelTokenReceipts(receipts).totalTokens).toBe(280);
    expect(receipts.every(receipt => receipt.owner === scope.owner && receipt.runId === scope.runId
      && receipt.operationId === scope.parentId && receipt.stage === 'review_question')).toBe(true);
    expect(JSON.stringify(receipts)).not.toMatch(/private|secret|apiKey|prompt/);
  });
  test('keeps usage when a known paid response is incomplete or fails validation', async () => {
    const store = memoryStore();
    const record = createModelTokenReceiptRecorder({ ...store, scopeFor: () => scope });
    const error = new Error('incomplete output');
    await expect(record({ provider: 'openai', model: 'gpt-6-luna' }, async receipt => {
      receipt.capture({ usage }); throw error;
    })).rejects.toBe(error);
    expect([...store.documents.values()][0]).toMatchObject({ totalTokens: 140, status: 'reported', outcome: 'failed' });
  });
  test('does not discard a paid result or replay the model after receipt writes fail', async () => {
    const Receipt = { updateOne: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const Run = { updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) };
    const work = jest.fn(async receipt => { receipt.capture({ usage }); return 'checked result'; });
    const record = createModelTokenReceiptRecorder({ Receipt, Run, scopeFor: () => scope });
    await expect(record({ provider: 'openai', model: 'gpt-6-luna' }, work)).resolves.toBe('checked result');
    expect(work).toHaveBeenCalledTimes(1);
    expect(Run.updateOne).toHaveBeenCalledWith({ _id: scope.runId, owner: scope.owner, sessionId: scope.sessionId },
      { $set: { tokenUsageRecordingFailed: true } });
  });
  test('does not create linked receipts outside the authoring task context', async () => {
    const store = memoryStore();
    const record = createModelTokenReceiptRecorder({ ...store, scopeFor: () => undefined });
    await record({ provider: 'openai', model: 'gpt-6-luna' }, async receipt => receipt.capture({ usage }));
    expect(store.Receipt.updateOne).not.toHaveBeenCalled();
  });
  test('a detached job retains its original execution after the outer scope returns', async () => {
    const store = memoryStore();
    const record = createModelTokenReceiptRecorder({ ...store, scopeFor: getAuthoringOperationScope });
    let job;
    await withAuthoringOperations({ _id: 'original-run', owner: 'original-owner', sessionId: 'original-session' }, async () => {
      job = new Promise(resolve => setTimeout(() => resolve(record({ provider: 'openai', model: 'gpt-6-luna' },
        async receipt => receipt.capture({ usage }))), 5));
    });
    await withAuthoringOperations({ _id: 'new-run', owner: 'new-owner', sessionId: 'new-session' }, async () => job);
    expect([...store.documents.values()][0]).toMatchObject({ runId: 'original-run', owner: 'original-owner', sessionId: 'original-session' });
  });
});
