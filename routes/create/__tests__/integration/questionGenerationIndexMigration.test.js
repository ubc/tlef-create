import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Job from '../../models/QuestionGenerationJob.js';
import { createQuestionJobService } from '../../services/questionGenerationJobs.js';

// Use an explicit Jest config without the repository's default integration setup.
// Only this fresh random database is ever created, read or dropped by this suite.
dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });
const databaseName = `tlef_qa_question_indexes_${randomUUID().replaceAll('-', '')}`;
let connection;
let caseNumber = 0;

beforeAll(async () => {
  connection = await mongoose.createConnection(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', {
    dbName: databaseName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000
  }).asPromise();
  if (connection.name !== databaseName) throw new Error('Refusing to use a non-isolated database.');
}, 15000);

afterAll(async () => {
  if (connection?.readyState === 1 && connection.name === databaseName && databaseName.startsWith('tlef_qa_question_indexes_')) {
    await connection.dropDatabase();
  }
  await connection?.close();
});

async function fixture(legacyIndexes) {
  const number = ++caseNumber;
  const collectionName = `receipt_migration_${number}`;
  await connection.createCollection(collectionName);
  const collection = connection.db.collection(collectionName);
  await collection.createIndex({ legacyMarker: 1 }, { name: 'instructor_existing_lookup' });
  for (const [key, options] of legacyIndexes) await collection.createIndex(key, options);
  const originalIndexes = await collection.indexes();
  const schema = Job.schema.clone();
  schema.set('autoIndex', true);
  const Model = connection.model(`QaReceiptMigration${number}`, schema, collectionName);
  const initializationError = await Model.init().then(() => null, error => error);
  const service = createQuestionJobService({ JobModel: Model, QuizModel: { exists: async () => true } });
  const owner = new mongoose.Types.ObjectId();
  const quizId = new mongoose.Types.ObjectId();
  return { Model, collection, originalIndexes, initializationError, service, owner, quizId };
}

async function expectExistingIndexesPreserved(fixture) {
  const indexes = await fixture.collection.indexes();
  for (const original of fixture.originalIndexes) {
    expect(indexes.find(index => index.name === original.name)).toEqual(original);
  }
}

async function expectConstraintsEnforced(fixture) {
  const base = {
    owner: fixture.owner, quiz: fixture.quizId, requestId: randomUUID(), requestHash: 'synthetic-hash',
    sessionId: randomUUID(), mode: 'append', status: 'running', active: true,
    leaseToken: randomUUID(), items: []
  };
  await fixture.Model.create(base);
  // These are database constraints, not merely service prechecks.
  await expect(fixture.Model.create({ ...base, requestId: randomUUID(), sessionId: randomUUID() }))
    .rejects.toMatchObject({ code: 11000 });
  await expect(fixture.Model.create({ ...base, quiz: new mongoose.Types.ObjectId(), active: false, sessionId: randomUUID() }))
    .rejects.toMatchObject({ code: 11000 });
  await expect(fixture.Model.create({ ...base, quiz: new mongoose.Types.ObjectId(), requestId: randomUUID(), active: false }))
    .rejects.toMatchObject({ code: 11000 });
  // Completed receipts for the same quiz must remain possible and permanent.
  await fixture.Model.create({ ...base, requestId: randomUUID(), sessionId: randomUUID(), status: 'succeeded', active: false });
}

describe('question receipt index migration compatibility', () => {
  test('keeps a legacy ordinary quiz_1 index and adds the named active unique constraint', async () => {
    const f = await fixture([[{ quiz: 1 }, { name: 'quiz_1' }]]);
    expect(f.initializationError).toBeNull();
    const receipt = await f.service.abandon({ owner: f.owner, quizId: f.quizId, requestId: randomUUID() });
    expect(receipt.abandoned).toBe(true);
    await expectExistingIndexesPreserved(f);
    expect(await f.collection.indexes()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'question_generation_active_quiz', unique: true, partialFilterExpression: { active: true } })
    ]));
    await expectConstraintsEnforced(f);
  });

  test.each([{ active: true }, { active: { $eq: true } }])('accepts the equivalent legacy partial unique quiz_1 constraint %j without renaming or dropping it', async filter => {
    const f = await fixture([[{ quiz: 1 }, { name: 'quiz_1', unique: true, partialFilterExpression: filter }]]);
    // MongoDB rejects an equivalent partial index with a different name.
    expect([85, 86]).toContain(f.initializationError?.code);
    const receipt = await f.service.abandon({ owner: f.owner, quizId: f.quizId, requestId: randomUUID() });
    expect(receipt.abandoned).toBe(true);
    await expectExistingIndexesPreserved(f);
    await expectConstraintsEnforced(f);
  });

  test.each([
    ['request identity', [{ owner: 1, requestId: 1 }, { name: 'owner_1_requestId_1' }]],
    ['session identity', [{ sessionId: 1 }, { name: 'sessionId_1' }]],
    ['all active jobs', [{ quiz: 1 }, { name: 'question_generation_active_quiz', unique: true, partialFilterExpression: { active: true, mode: 'append' } }]],
  ])('does not admit a request when the %s unique invariant is missing or weaker', async (_label, conflictingIndex) => {
    const f = await fixture([conflictingIndex]);
    expect([85, 86]).toContain(f.initializationError?.code);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(f.service.abandon({ owner: f.owner, quizId: f.quizId, requestId: randomUUID() }))
        .rejects.toMatchObject({ code: f.initializationError.code });
      expect(await f.Model.countDocuments()).toBe(0);
      expect(log).toHaveBeenCalledWith('[QuestionGenerationJobs] Receipt storage initialization failed.', {
        code: f.initializationError.code, reason: 'INDEX_DEFINITION_CONFLICT'
      });
      await expectExistingIndexesPreserved(f);
    } finally { log.mockRestore(); }
  });

  test('does not reinterpret non-index initialization failures even when all constraints are present', async () => {
    const f = await fixture([]);
    const failure = Object.assign(new Error('Synthetic unrelated failure'), { code: 11000 });
    const init = jest.spyOn(f.Model, 'init').mockRejectedValue(failure);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(f.service.abandon({ owner: f.owner, quizId: f.quizId, requestId: randomUUID() })).rejects.toBe(failure);
      expect(await f.Model.countDocuments()).toBe(0);
      expect(log).toHaveBeenCalledWith('[QuestionGenerationJobs] Receipt storage initialization failed.', {
        code: 11000, reason: 'INDEX_UNIQUENESS_CONFLICT'
      });
    } finally { init.mockRestore(); log.mockRestore(); }
  });
});
