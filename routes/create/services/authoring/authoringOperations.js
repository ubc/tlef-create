import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AuthoringRun } from '../../models/StudioAuthoring.js';
import sseService from '../sseService.js';
const context = new AsyncLocalStorage();
export const withAuthoringOperations = (run, work) => context.run({ runId: String(run._id), sessionId: String(run.sessionId), owner: String(run.owner) }, work);
export const getAuthoringOperationScope = () => context.getStore();

// Record actual operation boundaries, not generated explanations or hidden
// reasoning. The authoritative snapshot also contains these items for replay.
export async function authoringOperation(name, label, work, summarize) {
  const scope = context.getStore();
  if (!scope) return work();
  const operation = { id: randomUUID(), runId: scope.runId, name, label, status: 'running', startedAt: new Date(), parentId: scope.parentId };
  const filter = { _id: scope.runId, owner: scope.owner, sessionId: scope.sessionId };
  const started = await AuthoringRun.updateOne(filter, { $push: { operations: { $each: [operation], $slice: -160 } } });
  if (!started.matchedCount) throw new Error('Authoring run is no longer available.');
  const emit = () => sseService.emit('authoring-operation', { ...scope, operation: { ...operation } });
  emit();
  let failed = false;
  try {
    const result = await context.run({ ...scope, parentId: operation.id, operationName: name }, work);
    // Callers supply a bounded, user-facing outcome. Never serialize raw model
    // requests, material content or errors into operation telemetry.
    if (summarize) try { operation.summary = String(summarize(result) || '').slice(0, 600); } catch { /* Telemetry cannot discard the result. */ }
    return result;
  }
  catch (error) { failed = true; throw error; }
  finally {
    operation.status = failed ? 'failed' : 'completed';
    operation.completedAt = new Date(); operation.durationMs = +operation.completedAt - +operation.startedAt;
    // Losing a final telemetry write must not discard an already paid result.
    try {
      await AuthoringRun.updateOne({ ...filter, 'operations.id': operation.id }, { $set: { 'operations.$': operation } });
      emit();
    } catch { /* The saved start remains visible; never invent completion. */ }
  }
}
