import { describe, expect, jest, test } from '@jest/globals';
import { OpenAIEmbeddingProvider } from '../../services/openAIEmbeddingProvider.js';

describe('OpenAIEmbeddingProvider', () => {
  test('passes the configured dimensions and preserves input order across batches', async () => {
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      dimensions: 3,
      batchSize: 2
    });
    const create = jest.fn()
      .mockResolvedValueOnce({
        data: [
          { index: 1, embedding: [2, 2, 2] },
          { index: 0, embedding: [1, 1, 1] }
        ]
      })
      .mockResolvedValueOnce({
        data: [{ index: 0, embedding: [3, 3, 3] }]
      });
    provider.client = { embeddings: { create } };

    await expect(provider.embed(['first', 'second', 'third'])).resolves.toEqual([
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3]
    ]);
    expect(create).toHaveBeenNthCalledWith(1, {
      model: 'text-embedding-3-small',
      input: ['first', 'second'],
      encoding_format: 'float',
      dimensions: 3
    });
  });

  test('rejects a provider response with the wrong vector size', async () => {
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      dimensions: 3
    });
    provider.client = {
      embeddings: {
        create: jest.fn().mockResolvedValue({
          data: [{ index: 0, embedding: [1, 2] }]
        })
      }
    };

    await expect(provider.embed('test')).rejects.toThrow('returned 2 dimensions; expected 3');
  });
});

