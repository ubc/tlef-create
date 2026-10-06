import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createMaterialIndexRecovery } from '../../services/materialIndexRecovery.js';
import { safeQuestionFailure } from '../../services/questionGenerationFailure.js';
process.env.RAG_SKIP_AUTO_INIT = 'true';
const { QuizRAGService } = await import('../../services/ragService.js');

afterEach(() => jest.restoreAllMocks());

function retrievalFixture() {
  const service = new QuizRAGService({ autoInitialize: false });
  const count = jest.fn(async () => ({ count: 3 }));
  const search = jest.fn(async () => []);
  service.ragModule = { ragProvider: { config: { collectionName: 'current-1536' }, client: { count, search } } };
  service.embeddings = { embed: jest.fn(async () => [[1, 0]]) };
  return { service, count, search };
}

describe('active material retrieval index', () => {
  test('checks each selected material in the current collection with original owner, without purchasing embeddings', async () => {
    const { service, count } = retrievalFixture();
    expect(await service.assertMaterialsIndexed(['selected-a', 'selected-b'], { userId: 'owner' })).toEqual({ materialCount: 2 });
    expect(count).toHaveBeenCalledTimes(2);
    expect(count.mock.calls[0]).toEqual(['current-1536', { exact: true, filter: { must: [
      { should: [{ key: 'materialId', match: { any: ['selected-a'] } }, { key: 'metadata.materialId', match: { any: ['selected-a'] } }] },
      { should: [{ key: 'uploadedBy', match: { any: ['owner'] } }, { key: 'metadata.uploadedBy', match: { any: ['owner'] } }] }
    ] } }]);
    expect(service.embeddings.embed).not.toHaveBeenCalled();
  });
  test('completed material from an older index fails before embedding or semantic search', async () => {
    const { service, count, search } = retrievalFixture();
    count.mockResolvedValue({ count: 0 });
    await expect(service.assertMaterialsIndexed(['selected'], { userId: 'owner' })).rejects.toMatchObject({ code: 'MATERIAL_INDEX_MISSING' });
    expect(count).toHaveBeenCalledTimes(1);
    expect(service.embeddings.embed).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
  test('an unreadable index is distinct from an empty index and never leaks connection details', async () => {
    const { service, count } = retrievalFixture();
    count.mockRejectedValue(new Error('PRIVATE connection credential'));
    const error = await service.assertMaterialsIndexed(['selected']).catch(value => value);
    expect(error.code).toBe('MATERIAL_RETRIEVAL_UNAVAILABLE');
    expect(JSON.stringify(safeQuestionFailure(error))).not.toContain('PRIVATE');
  });
  test.each([[401, 'EMBEDDING_AUTH_FAILED'], [429, 'MODEL_SERVICE_LIMIT_REACHED'], [500, 'MATERIAL_EMBEDDING_UNAVAILABLE']])('preserves safe embedding diagnosis for HTTP %s', async (status, code) => {
    const { service, search } = retrievalFixture();
    service.embeddings.embed.mockRejectedValue(Object.assign(new Error('PRIVATE provider response'), { status }));
    const result = await service.retrieveRelevantContent('Synthetic objective', 'multiple-choice', { materialIds: ['selected'] });
    expect(result).toMatchObject({ chunks: [], errorCode: code });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(search).not.toHaveBeenCalled();
  });
});

function recoveryFixture() {
  const source = { _id: '507f1f77bcf86cd799439011', uploadedBy: '507f1f77bcf86cd799439012', folder: '507f1f77bcf86cd799439013',
    type: 'text', content: 'Synthetic saved source', processingStatus: 'completed', updatedAt: new Date('2026-01-01'), processingMetadata: { chunkCount: 3 } };
  const findOne = jest.fn(() => ({ select: () => ({ lean: async () => structuredClone(source) }) }));
  const exists = jest.fn(async () => true);
  const rag = { initialize: jest.fn(async () => {}), processAndEmbedMaterial: jest.fn(async (_source, options) => {
    await options.assertActive(); return { success: true, chunksCount: 3 };
  }), assertMaterialsIndexed: jest.fn(async () => {}), embeddingConfig: { provider: 'test', model: 'synthetic', dimensions: 3 } };
  const restore = createMaterialIndexRecovery({ MaterialModel: { findOne }, FolderModel: { exists }, loadRag: async () => rag });
  const args = { userId: source.uploadedBy, materialId: source._id };
  return { source, findOne, exists, rag, restore, args };
}

describe('owned cached source index restoration', () => {
  test('reuses the formal processing boundary without changing approved Material version', async () => {
    const { source, findOne, rag, restore, args } = recoveryFixture();
    const before = structuredClone(source);
    expect(await restore(args)).toMatchObject({ materialId: args.materialId, chunksCount: 3, restored: true });
    expect(findOne).toHaveBeenCalledWith({ _id: args.materialId, uploadedBy: args.userId });
    expect(rag.processAndEmbedMaterial).toHaveBeenCalledWith(expect.objectContaining({ content: source.content }), expect.objectContaining({ indexOnly: true, assertActive: expect.any(Function) }));
    expect(source).toEqual(before);
    expect(rag.assertMaterialsIndexed).toHaveBeenCalledWith([args.materialId], expect.objectContaining({ userId: args.userId }));
  });
  test('refuses other owners or courses before touching the index', async () => {
    const f = recoveryFixture(); f.exists.mockResolvedValue(false);
    await expect(f.restore(f.args)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.rag.initialize).not.toHaveBeenCalled();
    expect(f.rag.processAndEmbedMaterial).not.toHaveBeenCalled();
  });
  test('detects a changed cached source before destructive index cleanup', async () => {
    const f = recoveryFixture();
    f.rag.initialize.mockImplementation(async () => { f.source.content = 'Changed source'; });
    await expect(f.restore(f.args)).rejects.toMatchObject({ code: 'MATERIAL_SOURCE_CHANGED' });
    expect(f.rag.processAndEmbedMaterial).not.toHaveBeenCalled();
  });
  test('partial writes do not claim recovery and provider details do not cross the boundary', async () => {
    const f = recoveryFixture();
    f.rag.processAndEmbedMaterial.mockResolvedValue({ success: false, error: 'PRIVATE provider error', chunksCount: 2 });
    const error = await f.restore(f.args).catch(value => value);
    expect(error.code).toBe('MATERIAL_INDEX_RESTORE_FAILED');
    expect(error.message).not.toContain('PRIVATE');
    expect(f.rag.assertMaterialsIndexed).not.toHaveBeenCalled();
  });
});
