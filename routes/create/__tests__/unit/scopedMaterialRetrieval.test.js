import { describe, expect, jest, test } from '@jest/globals';
import { qdrantMetadataFilter, readQdrantChunk } from '../../utils/qdrantScope.js';
process.env.RAG_SKIP_AUTO_INIT = 'true';
const { QuizRAGService } = await import('../../services/ragService.js');

const field = (value, key) => key.split('.').reduce((object, part) => object?.[part], value);
function scopedFixture(points) {
  const service = new QuizRAGService({ autoInitialize: false });
  service.embeddings = { embed: jest.fn(async () => [new Float32Array([1, 0, 0])]) };
  const search = jest.fn(async (_collection, options) => points
    .filter(point => options.filter.should.some(condition => condition.match.any.includes(field(point.payload, condition.key))))
    .filter(point => point.score >= options.score_threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit));
  service.ragModule = {
    retrieveContext: jest.fn(() => { throw new Error('Unscoped toolkit path must not run'); }),
    ragProvider: { config: { collectionName: 'test-only' }, client: { search } }
  };
  return { service, search };
}

describe('selected-material Qdrant retrieval', () => {
  test('filters before top-K so unrelated high-scoring materials cannot starve selected evidence', async () => {
    const unrelated = Array.from({ length: 20 }, (_, index) => ({ score: 1 - index / 1000, payload: { content: 'Unrelated material', materialId: 'outside-course' } }));
    const { service, search } = scopedFixture([
      ...unrelated,
      { score: 0.8, payload: { content: 'First assigned source', materialId: 'selected-a', materialName: 'A', sourceFile: 'a.pdf', pageNumber: 2, pageStart: 2, pageEnd: 2, sourceChunkIndex: 4, chunkIndex: 0, sectionTitle: 'Chunk 0' } },
      { score: 0.7, payload: { content: 'Second assigned source', metadata: { materialId: 'selected-b', materialName: 'B', section: 'chunk_6', chunkIndex: 0 } } },
      { score: 0.1, payload: { content: 'Below threshold', materialId: 'selected-a' } }
    ]);
    const result = await service.retrieveRelevantContent('Explain condensation', 'multiple-choice', { materialIds: ['selected-a', 'selected-b'], topK: 2, minScore: 0.3 });
    expect(result.chunks.map(chunk => chunk.content)).toEqual(['First assigned source', 'Second assigned source']);
    expect(result.chunks.map(chunk => chunk.score)).toEqual([0.8, 0.7]);
    expect(result.chunks[0].metadata).toMatchObject({ materialId: 'selected-a', sourceFile: 'a.pdf', pageNumber: 2, pageStart: 2, pageEnd: 2, chunkIndex: 4, sectionTitle: 'Chunk 5' });
    expect(result.chunks[1].metadata).toMatchObject({ materialId: 'selected-b', chunkIndex: 6, sectionTitle: 'Chunk 7' });
    expect(search).toHaveBeenCalledWith('test-only', expect.objectContaining({
      limit: 2, score_threshold: 0.3, with_payload: true, with_vector: false, vector: [1, 0, 0],
      filter: qdrantMetadataFilter('materialId', ['selected-a', 'selected-b'])
    }));
    expect(service.ragModule.retrieveContext).not.toHaveBeenCalled();
  });

  test('legacy quiz scope remains bounded and an omitted scope never performs a global search', async () => {
    const { service, search } = scopedFixture([
      { score: 0.8, payload: { content: 'Legacy quiz source', metadata: { quizId: 'selected-quiz', materialId: 'source' } } }
    ]);
    expect((await service.retrieveRelevantContent('Question', 'multiple-choice', { quizId: 'selected-quiz' })).chunks).toHaveLength(1);
    search.mockClear();
    expect(await service.retrieveRelevantContent('Question', 'multiple-choice')).toMatchObject({ chunks: [], error: 'RAG search unavailable' });
    expect(search).not.toHaveBeenCalled();
  });

  test('does not fall back to an unscoped search when the selected-material search fails', async () => {
    const { service, search } = scopedFixture([]);
    search.mockRejectedValue(new Error('Qdrant unavailable'));
    expect(await service.retrieveRelevantContent('Question', 'multiple-choice', { materialIds: ['selected-a'] })).toMatchObject({ chunks: [], error: 'RAG search unavailable' });
    expect(service.ragModule.retrieveContext).not.toHaveBeenCalled();
  });

  test('retains genuine section headings and outer source indices across toolkit internal chunks', () => {
    const point = { score: 0.75, payload: { content: 'Original excerpt.', materialId: 'source', sectionTitle: '2. Energy transfer', chunkIndex: 1, sourceChunkIndex: 8 } };
    expect(readQdrantChunk(point)).toMatchObject({ content: 'Original excerpt.', score: 0.75, metadata: { chunkIndex: 8, sectionTitle: '2. Energy transfer' } });
    expect(point.payload.chunkIndex).toBe(1);
  });
});
