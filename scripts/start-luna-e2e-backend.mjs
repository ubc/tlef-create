import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';

dotenv.config({ quiet: true });
if (process.env.LLM_PROVIDER !== 'openai' || process.env.OPENAI_MODEL !== 'gpt-6-luna' || !process.env.OPENAI_API_KEY) {
  throw new Error('The live-model test requires LLM_PROVIDER=openai, OPENAI_MODEL=gpt-6-luna and an existing API key.');
}
const runId = process.env.LUNA_E2E_RUN_ID;
if (!runId || !/^[a-z0-9-]{8,40}$/.test(runId)) throw new Error('LUNA_E2E_RUN_ID must be an 8–40 character test identifier.');
const mongo = new URL(process.env.MONGODB_URI || '');
const qdrant = new URL(process.env.QDRANT_URL || 'http://localhost:6333');
if (!['localhost', '127.0.0.1'].includes(mongo.hostname) || !['localhost', '127.0.0.1'].includes(qdrant.hostname)) {
  throw new Error('Live browser test requires localhost-only MongoDB and Qdrant.');
}
const dbName = `tlef-create-luna-e2e-${runId}`;
const collection = `create-luna-e2e-${runId}`;
const apiPort = process.env.LUNA_E2E_API_PORT || '8051';
const frontendPort = process.env.LUNA_E2E_FRONTEND_PORT || '8092';
mongo.pathname = `/${dbName}`;
const storage = await fs.mkdtemp(path.join(os.tmpdir(), `create-luna-e2e-${runId}-`));
Object.assign(process.env, {
  NODE_ENV: 'test', PORT: apiPort, FRONTEND_URL: `http://localhost:${frontendPort}`,
  MONGODB_URI: mongo.toString(), EMBEDDINGS_COLLECTION_NAME: collection,
  H5P_STORAGE_ROOT: storage, SAML_AVAILABLE: 'false', AUTO_LOGIN_ENABLED: 'true',
  ADMIN_CWLS: 'luna-e2e-admin', SESSION_SECRET: process.env.E2E_SESSION_SECRET || 'local-luna-e2e-session-secret',
  LTI_CLIENT_ID: ''
});
await fs.mkdir('test-results/luna-live', { recursive: true });
await fs.writeFile('test-results/luna-live/isolation.json', JSON.stringify({ runId, dbName, collection, storage }, null, 2));
let cleaning = false;
const cleanup = async () => {
  if (cleaning) return;
  cleaning = true;
  try {
    if (mongoose.connection.readyState === 1) await mongoose.connection.getClient().db(dbName).dropDatabase();
    const response = await fetch(new URL(`/collections/${collection}`, qdrant), {
      method: 'DELETE', headers: process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {},
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok && response.status !== 404) console.error('Luna QA collection cleanup failed:', response.status);
  } catch (error) { console.error('Luna QA cleanup failed:', error.message); }
  finally {
    await mongoose.disconnect().catch(() => {});
    rmSync(storage, { recursive: true, force: true });
    process.exit(0);
  }
};
process.once('exit', () => rmSync(storage, { recursive: true, force: true }));
await import('../server.js');
// The application's normal shutdown exits before asynchronous QA cleanup can finish.
process.removeAllListeners('SIGTERM');
process.on('SIGTERM', () => { void cleanup(); });
