import { afterAll, beforeAll, test, expect } from '@jest/globals';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import JSZip from 'jszip';

// Real Lumi and installed H5P libraries, isolated content storage and MongoDB.
// No model, embeddings, material processing or user course is involved.
const storage = await mkdtemp(path.join(tmpdir(), 'create-authoring-native-'));
const previousStorage = process.env.H5P_STORAGE_ROOT;
process.env.H5P_STORAGE_ROOT = storage;
const { initializeLumi, getEditor, toLumiUser, renderContent } = await import('../../services/lumiService.js');
const { AuthoringSession: Session, AuthoringRun: Run, AuthoringVersion: Version } = await import('../../models/StudioAuthoring.js');
const { default: Content } = await import('../../models/H5PContent.js');
const { createVersion, acceptVersion, readNative, saveManualVersion, cloneDocument } = await import('../../services/authoring/artifactVersionService.js');
const dbName = `tlef_qa_authoring_native_${randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });
  const uri = new URL(process.env.E2E_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
  if (!['localhost', '127.0.0.1'].includes(uri.hostname)) throw new Error('This suite requires a local temporary database.');
  await mongoose.connect(uri.toString(), { dbName, serverSelectionTimeoutMS: 5000 });
  await Promise.all([Session.init(), Run.init(), Version.init(), Content.init()]);
  await initializeLumi();
}, 30000);
afterAll(async () => {
  try { if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase(); }
  finally {
    await mongoose.disconnect(); await rm(storage, { recursive: true, force: true });
    if (previousStorage === undefined) delete process.env.H5P_STORAGE_ROOT;
    else process.env.H5P_STORAGE_ROOT = previousStorage;
  }
});

test('real H5P versions can be previewed, edited immutably, cloned and downloaded as packages', async () => {
  const owner = new mongoose.Types.ObjectId();
  const session = await Session.create({ owner, requestId: randomUUID(), courseId: new mongoose.Types.ObjectId(), title: 'QA water activity' });
  const run = await Run.create({ owner, sessionId: session._id, requestId: randomUUID(), kind: 'create', status: 'succeeded' });
  session.activeRunId = run._id; await session.save();
  const snapshot = { name: 'QA water activity', learningObjectives: [], chapters: [], questions: [{
    _id: String(new mongoose.Types.ObjectId()), type: 'multiple-choice', questionText: 'Which process turns liquid water into vapour?',
    content: { options: [{ text: 'Evaporation', isCorrect: true }, { text: 'Condensation', isCorrect: false }] },
    correctAnswer: 'Evaporation', explanation: 'Evaporation changes liquid water into vapour.'
  }] };
  const first = await createVersion({ session, run, snapshot, title: snapshot.name, assertActive: async () => {} });
  await acceptVersion(session, first, run, async () => {});
  const native = await readNative(first.contentId, owner);
  expect(native.library).toMatch(/^H5P.Column /);
  expect(JSON.stringify(native.params.params)).toContain('Evaporation');
  const html = await renderContent(first.contentId, toLumiUser({ id: String(owner) }));
  expect(html).toContain('H5PIntegration');
  const record = await Content.findOne({ lumiContentId: first.contentId });
  const saved = await saveManualVersion(record, { library: native.library, parameters: native.params.params,
    metadata: { ...native.params.metadata, title: 'QA manual version' }, title: 'QA manual version' }, { id: String(owner) });
  expect(saved.result.id).not.toBe(first.contentId);
  expect((await readNative(first.contentId, owner)).params.metadata.title).toBe('QA water activity');
  expect((await readNative(saved.result.id, owner)).params.metadata.title).toBe('QA manual version');
  const cloned = await cloneDocument(first.contentId, owner);
  expect(cloned.parameters).toEqual(native.params.params);
  const chunks = [];
  const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const exported = finished(output);
  await getEditor().exportContent(saved.result.id, output, toLumiUser({ id: String(owner) }));
  await exported;
  const archive = await JSZip.loadAsync(Buffer.concat(chunks));
  const manifest = JSON.parse(await archive.file('h5p.json').async('string'));
  expect(manifest.mainLibrary).toBe('H5P.Column');
  expect(manifest.title).toBe('QA manual version');
  expect(await archive.file('content/content.json').async('string')).toContain('Evaporation');
  expect(await Version.countDocuments({ sessionId: session._id })).toBe(2);
}, 30000);
