import { afterEach, describe, expect, jest, test } from '@jest/globals';
process.env.RAG_SKIP_AUTO_INIT = 'true';
const { QuizRAGService } = await import('../../services/ragService.js');
const { getChunkSectionLabel } = await import('../../utils/chunkLabels.js');

function fixture() {
  const service = new QuizRAGService({ autoInitialize: false });
  service.embeddingConfig = { provider: 'test', model: 'test', dimensions: 3, collectionName: 'test-only' };
  service.embeddings = {};
  service.documentParser = {};
  const vectors = [];
  service.cleanupMaterialEmbeddings = jest.fn(async () => {
    vectors.length = 0;
    return { success: true };
  });
  service.chunkContent = () => [0, 1, 2].map(index => ({ content: `chunk ${index}`, section: `chunk_${index}` }));
  service.ragModule = { addDocument: jest.fn(async (_content, metadata) => {
    vectors.push(metadata.chunkIndex);
    return [`vector-${vectors.length}`];
  }) };
  const material = {
    _id: 'material', uploadedBy: 'instructor', folder: 'course', name: 'Fixture',
    type: 'text', content: 'Synthetic fixture', processingMetadata: {}, save: jest.fn(async () => {})
  };
  return { service, material, vectors };
}

afterEach(() => jest.restoreAllMocks());

describe('material indexing integrity', () => {
  test('partial/uncertain writes stay failed and a retry replaces rather than duplicates vectors', async () => {
    const { service, material, vectors } = fixture();
    let fail = true;
    service.ragModule.addDocument.mockImplementation(async (_content, metadata) => {
      vectors.push(metadata.chunkIndex);
      if (fail && metadata.chunkIndex === 1) throw new Error('Premature close');
      return ['vector-id'];
    });
    expect(await service.processAndEmbedMaterial(material)).toMatchObject({
      success: false, partial: true, chunksCount: 2, totalChunks: 3, failedChunkIndices: [1]
    });
    expect(material.processingMetadata).toMatchObject({ chunkCount: 3, embeddedChunkCount: 2, failedChunkIndices: [1] });
    fail = false;
    expect(await service.processAndEmbedMaterial(material)).toMatchObject({ success: true, chunksCount: 3 });
    expect(vectors).toEqual([0, 1, 2]);
    expect(material.processingMetadata.failedChunkIndices).toEqual([]);
    expect(service.cleanupMaterialEmbeddings).toHaveBeenCalledTimes(2);
  });

  test('does not write any new vectors when cleanup cannot be confirmed', async () => {
    const { service, material } = fixture();
    service.cleanupMaterialEmbeddings.mockResolvedValue({ success: false, error: 'unavailable' });
    expect(await service.processAndEmbedMaterial(material)).toMatchObject({ success: false, chunksCount: 0 });
    expect(service.ragModule.addDocument).not.toHaveBeenCalled();
  });

  test('an empty embedding response is a failed chunk, not completion', async () => {
    const { service, material } = fixture();
    service.ragModule.addDocument.mockResolvedValue([]);
    expect(await service.processAndEmbedMaterial(material)).toMatchObject({ success: false, chunksCount: 0, failedChunkIndices: [0, 1, 2] });
  });

  test.each(['pdf', 'docx'])('can reindex cached %s text when an older job removed the source file', async type => {
    const { service, material } = fixture();
    material.type = type;
    material.filePath = null;
    expect(await service.processAndEmbedMaterial(material)).toMatchObject({ success: true, chunksCount: 3 });
  });

  test('concurrent retries for the same material share one indexing attempt', async () => {
    const { service, material, vectors } = fixture();
    const results = await Promise.all([service.processAndEmbedMaterial(material), service.processAndEmbedMaterial(material)]);
    expect(results.every(result => result.success)).toBe(true);
    expect(vectors).toEqual([0, 1, 2]);
    expect(service.cleanupMaterialEmbeddings).toHaveBeenCalledTimes(1);
  });

  test('cleanup waits for deletion and propagates failures instead of reporting logging as success', async () => {
    const service = new QuizRAGService({ autoInitialize: false });
    service.ragModule = {};
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503, text: async () => 'unavailable' });
    expect(await service.cleanupMaterialEmbeddings('material')).toMatchObject({ success: false });
    expect(fetchMock.mock.calls[0][0]).toContain('/points/delete?wait=true');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).filter.should).toEqual([
      { key: 'materialId', match: { any: ['material'] } },
      { key: 'metadata.materialId', match: { any: ['material'] } }
    ]);
    fetchMock.mockRejectedValue(new Error('connection reset'));
    expect(await service.cleanupMaterialEmbeddings('material')).toMatchObject({ success: false });
  });

  test('cleanup removes actual flat toolkit payloads and legacy nested points without touching another material', async () => {
    const service = new QuizRAGService({ autoInitialize: false });
    service.ragModule = {};
    let points = [
      { payload: { materialId: 'target', content: 'Flat point' } },
      { payload: { metadata: { materialId: 'target' }, content: 'Legacy point' } },
      { payload: { materialId: 'other', content: 'Unrelated source' } }
    ];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const { filter } = JSON.parse(options.body);
      points = points.filter(point => !filter.should.some(condition => {
        const value = condition.key.split('.').reduce((data, key) => data?.[key], point.payload);
        return condition.match.any.includes(value);
      }));
      return { ok: true, json: async () => ({ result: { status: 'completed' } }) };
    });
    expect(await service.cleanupMaterialEmbeddings('target')).toMatchObject({ success: true });
    expect(points).toEqual([{ payload: { materialId: 'other', content: 'Unrelated source' } }]);
  });
});

describe('chunk display numbering', () => {
  test('keeps zero-based indices while presenting generated chunks from one', () => {
    const service = new QuizRAGService({ autoInitialize: false });
    const chunks = service.chunkContent(Array.from({ length: 4 }, () => 'synthetic paragraph '.repeat(90)).join('\n\n'), { name: 'Fixture' });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.section).toBe(`chunk_${index}`);
      expect(chunk.sectionTitle).toBe(`Chunk ${index + 1}`);
    });
    expect(getChunkSectionLabel({ sectionTitle: 'Chunk 0', chunkIndex: 4 })).toBe('Chunk 5');
    expect(getChunkSectionLabel({ sectionTitle: '2. Condensation', chunkIndex: 4 })).toBe('2. Condensation');
  });

  test('normalizes historical vector labels and enforces material scope for the configured client', async () => {
    const { service } = fixture();
    service.embeddings = { embed: async () => [[1, 0, 0]] };
    service.ragModule = { ragProvider: { config: { collectionName: 'test-only' }, client: { search: jest.fn(async () => [
      { score: 1, payload: { content: 'outside scope', materialId: 'other', chunkIndex: 0 } },
      { score: 0.9, payload: { content: 'allowed source', materialId: 'material', chunkIndex: 0, sectionTitle: 'Chunk 0' } }
    ]) } } };
    const result = await service.retrieveRelevantContent('Learning objective', 'multiple-choice', { materialIds: ['material'] });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].metadata).toMatchObject({ materialId: 'material', chunkIndex: 0, sectionTitle: 'Chunk 1' });
  });
});
