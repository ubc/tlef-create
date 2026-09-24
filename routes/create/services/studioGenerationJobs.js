import StudioGenerationJob from '../models/StudioGenerationJob.js';

const LEASE_MS = 120_000;
const MAX_RUN_MS = 15 * 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const interrupted = 'Generation was interrupted. Check Your content, then explicitly start a new attempt. CREATE will not automatically spend more AI credits.';
export const serializeStudioJob = job => ({
  requestId: job.requestId, status: job.status, contentId: job.contentId || null,
  message: job.message || '', createdAt: job.createdAt
});

// A durable receipt, not an automatically replayed job queue. Browser disconnects
// do not cancel work. A lost server lease stops the old worker before persistence;
// restart recovery reports interruption rather than silently paying for a replay.
export function createStudioJobService(Model = StudioGenerationJob, now = () => new Date()) {
  const expire = owner => Model.updateMany({ owner, status: 'running', $or: [
    { leaseUntil: { $lt: now() } }, { createdAt: { $lt: new Date(+now() - MAX_RUN_MS) } }
  ] }, {
    $set: { status: 'interrupted', message: interrupted }
  });
  return {
    async get(owner, requestId) {
      await expire(owner);
      return Model.findOne({ owner, requestId });
    },
    async start(owner, requestId, work) {
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '')) {
        throw Object.assign(new Error('A valid generation request ID is required.'), { status: 400, code: 'H5P_AI_INPUT' });
      }
      await Model.init(); // Unique indexes enforce cross-process admission.
      await expire(owner);
      const existing = await Model.findOne({ owner, requestId });
      if (existing) return existing;
      if (await Model.countDocuments({ owner, createdAt: { $gte: new Date(+now() - 600_000) } }) >= 10) {
        throw Object.assign(new Error('Please wait before generating more Studio drafts.'), { status: 429, code: 'H5P_AI_RATE_LIMIT' });
      }
      let job;
      try {
        job = await Model.create({ owner, requestId, status: 'running', leaseUntil: new Date(+now() + LEASE_MS), expiresAt: new Date(+now() + RETENTION_MS) });
      } catch (error) {
        if (error.code !== 11000) throw error;
        const duplicate = await Model.findOne({ owner, requestId });
        if (duplicate) return duplicate;
        throw Object.assign(new Error('Another Studio draft is still generating. Return to its task before starting a new one.'), { status: 409, code: 'H5P_AI_BUSY' });
      }
      // Recheck inside the owner's exclusive slot: concurrent fast jobs cannot
      // both observe the last free quota slot before one releases its lease.
      if (await Model.countDocuments({ owner, createdAt: { $gte: new Date(+now() - 600_000) } }) > 10) {
        await Model.updateOne({ _id: job._id }, { $set: { status: 'failed', message: 'Please wait before generating more Studio drafts.' } });
        throw Object.assign(new Error('Please wait before generating more Studio drafts.'), { status: 429, code: 'H5P_AI_RATE_LIMIT' });
      }
      const filter = { _id: job._id, owner, status: 'running', leaseUntil: { $gte: now() } };
      let leaseLost = false;
      const assertActive = async () => {
        if (leaseLost || +now() - +job.createdAt >= MAX_RUN_MS || !await Model.exists({ ...filter, leaseUntil: { $gte: now() } })) {
          throw Object.assign(new Error(interrupted), { code: 'H5P_AI_INTERRUPTED' });
        }
      };
      const heartbeat = setInterval(async () => {
        try {
          if (+now() - +job.createdAt >= MAX_RUN_MS) {
            leaseLost = true;
            await Model.updateOne({ _id: job._id, status: 'running' }, { $set: { status: 'interrupted', message: interrupted } });
            clearInterval(heartbeat);
            return;
          }
          const result = await Model.updateOne({ ...filter, leaseUntil: { $gte: now() } }, { $set: { leaseUntil: new Date(+now() + LEASE_MS) } });
          if (!result.matchedCount) leaseLost = true;
        } catch { leaseLost = true; }
      }, 30_000);
      heartbeat.unref?.();
      // Every rejection is consumed; callers can recover by reading the receipt.
      void (async () => {
        try {
          const contentId = await work(assertActive);
          await assertActive();
          await Model.updateOne({ _id: job._id, status: 'running' }, { $set: { status: 'succeeded', contentId } });
        } catch (error) {
          const safe = ['H5P_AI_INVALID', 'H5P_AI_INPUT', 'H5P_AI_TEMPLATE_REQUIRED', 'NO_API_KEY'].includes(error.code);
          await Model.updateOne({ _id: job._id, status: 'running' }, { $set: {
            status: error.code === 'H5P_AI_INTERRUPTED' ? 'interrupted' : 'failed',
            message: safe ? error.message : 'The draft could not be completed. Your original content is unchanged. Check Your content before trying again.'
          } });
        } finally { clearInterval(heartbeat); }
      })().catch(() => { /* Database outage: the lease will expire as interrupted. */ });
      return job;
    }
  };
}

export default createStudioJobService();
