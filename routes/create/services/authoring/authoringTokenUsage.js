import { randomUUID } from 'node:crypto';
import ModelTokenReceipt from '../../models/ModelTokenReceipt.js';
import { AuthoringRun } from '../../models/StudioAuthoring.js';
import { getAuthoringOperationScope } from './authoringOperations.js';

const fields = ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens', 'cacheWriteTokens'];
const validCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const firstCount = (...values) => values.map(validCount).find(value => value !== null) ?? null;

export function normalizeModelTokenUsage(usage) {
  const value = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = firstCount(value.input_tokens, value.prompt_tokens, value.inputTokens, value.promptTokens, value.prompt_eval_count);
  const outputTokens = firstCount(value.output_tokens, value.completion_tokens, value.outputTokens, value.completionTokens, value.eval_count);
  return {
    inputTokens, outputTokens,
    // Reasoning and cached inputs are subsets, never additional total tokens.
    totalTokens: inputTokens !== null && outputTokens !== null ? validCount(inputTokens + outputTokens)
      : firstCount(value.total_tokens, value.totalTokens),
    reasoningTokens: firstCount(value.output_tokens_details?.reasoning_tokens, value.completion_tokens_details?.reasoning_tokens, value.reasoningTokens),
    cachedInputTokens: firstCount(value.input_tokens_details?.cached_tokens, value.prompt_tokens_details?.cached_tokens, value.cachedInputTokens, value.cachedTokens),
    cacheWriteTokens: firstCount(value.input_tokens_details?.cache_write_tokens, value.prompt_tokens_details?.cache_write_tokens, value.cache_write_tokens, value.cacheWriteTokens)
  };
}

export function summarizeModelTokenReceipts(receipts = [], { activeRunIds = [], untrackedRuns = 0, recordingFailed = false, active = false } = {}) {
  const activeIds = new Set(activeRunIds.map(String));
  // Idempotent snapshots or duplicate terminal delivery must not count twice.
  const unique = [...new Map(receipts.map(receipt => [String(receipt._id), receipt])).values()];
  const reported = unique.filter(receipt => validCount(receipt.totalTokens) !== null);
  const pendingCalls = unique.filter(receipt => receipt.status === 'pending' && activeIds.has(String(receipt.runId))).length;
  const unknownCalls = unique.length - reported.length - pendingCalls;
  const partial = untrackedRuns > 0 || recordingFailed || unknownCalls > 0 || pendingCalls > 0
    || reported.some(receipt => validCount(receipt.inputTokens) === null || validCount(receipt.outputTokens) === null);
  const sum = field => {
    const known = unique.map(receipt => validCount(receipt[field])).filter(value => value !== null);
    if (!known.length) return field === 'totalTokens' || field === 'inputTokens' || field === 'outputTokens'
      ? (!unique.length && !untrackedRuns && !recordingFailed && !active ? 0 : null) : null;
    return validCount(known.reduce((total, value) => total + value, 0));
  };
  return {
    ...Object.fromEntries(fields.map(field => [field, sum(field)])),
    calls: unique.length, reportedCalls: reported.length, pendingCalls, unknownCalls, untrackedRuns,
    status: reported.length ? (partial ? 'partial' : 'complete')
      : (pendingCalls || active ? 'pending' : partial ? 'unavailable' : 'complete'),
    models: [...new Set(unique.map(receipt => receipt.model).filter(Boolean))]
  };
}

export function createModelTokenReceiptRecorder({ Receipt = ModelTokenReceipt, Run = AuthoringRun, scopeFor = getAuthoringOperationScope } = {}) {
  return async function withModelTokenReceipt({ provider, model }, work) {
    const scope = scopeFor();
    if (!scope) return work({ capture() {} });
    const receipt = {
      _id: randomUUID(), owner: scope.owner, sessionId: scope.sessionId, runId: scope.runId,
      operationId: scope.parentId, stage: scope.operationName || 'model_call',
      provider: String(provider || '').slice(0, 80), model: String(model || '').slice(0, 180),
      status: 'pending', startedAt: new Date(), ...normalizeModelTokenUsage(null)
    };
    const filter = { _id: receipt._id, owner: receipt.owner, sessionId: receipt.sessionId, runId: receipt.runId };
    try { await Receipt.updateOne(filter, { $setOnInsert: receipt }, { upsert: true, runValidators: true }); }
    catch { /* The final upsert can still recover this receipt. */ }
    let succeeded = false;
    try {
      const result = await work({ capture(value = {}) {
        const normalized = normalizeModelTokenUsage(value.usage);
        // A later terminal event without usage must not erase known counters.
        for (const field of fields) if (normalized[field] !== null) receipt[field] = normalized[field];
        if (typeof value.responseId === 'string') receipt.responseId = value.responseId.slice(0, 180);
        if (typeof value.model === 'string') receipt.model = value.model.slice(0, 180);
      } });
      succeeded = true;
      return result;
    } finally {
      receipt.status = receipt.totalTokens === null ? 'unavailable' : 'reported';
      receipt.outcome = succeeded ? 'succeeded' : 'failed';
      receipt.completedAt = new Date();
      try { await Receipt.updateOne(filter, { $set: receipt }, { upsert: true, runValidators: true }); }
      catch {
        // Receipt outages cannot discard a paid response or trigger a retry.
        try { await Run.updateOne({ _id: scope.runId, owner: scope.owner, sessionId: scope.sessionId },
          { $set: { tokenUsageRecordingFailed: true } }); } catch { /* Report remaining pending/unknown receipts conservatively. */ }
      }
    }
  };
}

export const withModelTokenReceipt = createModelTokenReceiptRecorder();

export async function readAuthoringTokenUsage(owner, sessionId) {
  try {
    const [receipts, runs] = await Promise.all([
      ModelTokenReceipt.find({ owner, sessionId }).select(fields.join(' ') + ' runId model status').lean(),
      AuthoringRun.find({ owner, sessionId }).select('status tokenUsageVersion tokenUsageRecordingFailed').lean()
    ]);
    const activeRunIds = runs.filter(run => ['queued', 'running', 'waiting'].includes(run.status)).map(run => String(run._id));
    const summaryFor = selected => summarizeModelTokenReceipts(receipts.filter(receipt => selected.some(run => String(run._id) === String(receipt.runId))), {
      activeRunIds, active: selected.some(run => activeRunIds.includes(String(run._id))),
      untrackedRuns: selected.filter(run => run.tokenUsageVersion !== 1).length,
      recordingFailed: selected.some(run => run.tokenUsageRecordingFailed)
    });
    return { task: summaryFor(runs), runs: Object.fromEntries(runs.map(run => [String(run._id), summaryFor([run])])) };
  } catch {
    return { task: summarizeModelTokenReceipts([], { recordingFailed: true }), runs: {} };
  }
}
