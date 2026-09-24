import mongoose from 'mongoose';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import StudioGenerationJob from '../../models/StudioGenerationJob.js';
import { createStudioJobService } from '../../services/studioGenerationJobs.js';

// Run with setupFilesAfterEnv: []: never load the legacy global DB setup.
const dbName = `create-jobs-e2e-${crypto.randomUUID()}`;
let connection;
let Model;
beforeAll(async () => {
  dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });
  const uri = new URL(process.env.E2E_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
  if (!['localhost', '127.0.0.1'].includes(uri.hostname)) throw new Error('Job recovery acceptance requires a local disposable database.');
  uri.pathname = `/${dbName}`;
  connection = await mongoose.createConnection(uri.toString(), { serverSelectionTimeoutMS: 5000 }).asPromise();
  Model = connection.model('StudioGenerationJob', StudioGenerationJob.schema.clone());
  await Model.init();
});
afterAll(async () => {
  if (connection) {
    // Only this test's freshly allocated UUID database can be dropped.
    try {
      if (connection.name === dbName && /^create-jobs-e2e-[a-f0-9-]+$/.test(dbName)) await connection.dropDatabase();
    } finally { await connection.close(); }
  }
});
const owner = () => new mongoose.Types.ObjectId().toString();
const waitFor = async (service, user, id, status) => {
  for (let i = 0; i < 100; i++) {
    const job = await service.get(user, id);
    if (job?.status === status) return job;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Job did not reach ${status}`);
};

describe('persistent Studio receipts with real isolated Mongo indexes', () => {
  test('two app instances admit one job; duplicate IDs recover without another AI call', async () => {
    const a = createStudioJobService(Model), b = createStudioJobService(Model);
    const user = owner(), id = crypto.randomUUID();
    let release;
    let calls = 0;
    const hold = new Promise(resolve => { release = resolve; });
    const work = async check => { calls++; await hold; await check(); return 'owned-draft'; };
    await Promise.all([a.start(user, id, work), b.start(user, id, work)]);
    expect(calls).toBe(1);
    await expect(b.start(user, crypto.randomUUID(), work)).rejects.toMatchObject({ status: 409 });
    expect(await b.get(owner(), id)).toBeNull();
    release();
    expect((await waitFor(b, user, id, 'succeeded')).contentId).toBe('owned-draft');
    await b.start(user, id, work);
    expect(calls).toBe(1);
  });
  test('expired server lease becomes interrupted and fences late persistence', async () => {
    let clock = new Date();
    const service = createStudioJobService(Model, () => clock);
    const user = owner(), id = crypto.randomUUID();
    let release;
    let saved = false;
    const hold = new Promise(resolve => { release = resolve; });
    await service.start(user, id, async check => { await hold; await check(); saved = true; return 'bad'; });
    clock = new Date(+clock + 130000);
    expect((await service.get(user, id)).status).toBe('interrupted');
    release();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(saved).toBe(false);
    expect((await service.get(user, id)).status).toBe('interrupted');
  });
  test('failure receipts do not contain provider secrets or teaching input', async () => {
    const service = createStudioJobService(Model), user = owner(), id = crypto.randomUUID();
    await service.start(user, id, async () => { throw new Error('private upstream response'); });
    const result = await waitFor(service, user, id, 'failed');
    expect(JSON.stringify(result)).not.toContain('private upstream');
    expect(result.toObject()).not.toHaveProperty('instructions');
  });
  test('a maximum-age receipt cannot remain running just because its lease is fresh', async () => {
    const user = owner(), id = crypto.randomUUID();
    await Model.create({ owner: user, requestId: id, status: 'running', createdAt: new Date(Date.now() - 16 * 60000), leaseUntil: new Date(Date.now() + 120000), expiresAt: new Date(Date.now() + 86400000) });
    const service = createStudioJobService(Model);
    expect((await service.get(user, id)).status).toBe('interrupted');
  });
  test('quota rejection does not call the paid generator', async () => {
    const user = owner();
    await Model.insertMany(Array.from({ length: 10 }, () => ({ owner: user, requestId: crypto.randomUUID(), status: 'failed', leaseUntil: new Date(), expiresAt: new Date(Date.now() + 86400000) })));
    let calls = 0;
    await expect(createStudioJobService(Model).start(user, crypto.randomUUID(), async () => { calls++; })).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(0);
  });
});
