import { describe, expect, test } from '@jest/globals';
import {
  createToolkitEmbeddingsConfig,
  getUnnamedQdrantVectorSize,
  resolveEmbeddingConfig
} from '../../config/embeddingConfig.js';

describe('embedding configuration', () => {
  test('defaults OpenAI text-embedding-3-small to its native 1536 dimensions', () => {
    const config = resolveEmbeddingConfig({ OPENAI_API_KEY: 'test-key' });

    expect(config).toMatchObject({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      collectionName: 'quiz-materials-openai-text-embedding-3-small-1536',
      apiKey: 'test-key'
    });
  });

  test('uses a dimension-specific collection when OpenAI output is shortened', () => {
    const config = resolveEmbeddingConfig({
      EMBEDDINGS_PROVIDER: 'openai',
      EMBEDDINGS_MODEL: 'text-embedding-3-small',
      EMBEDDINGS_DIMENSIONS: '512',
      EMBEDDINGS_API_KEY: 'embedding-key'
    });

    expect(config.dimensions).toBe(512);
    expect(config.collectionName).toBe('quiz-materials-openai-text-embedding-3-small-512');
    expect(config.apiKey).toBe('embedding-key');
  });

  test('preserves the legacy FastEmbed collection for the existing model', () => {
    const config = resolveEmbeddingConfig({ EMBEDDINGS_PROVIDER: 'fastembed' });

    expect(config).toMatchObject({
      provider: 'fastembed',
      model: 'fast-bge-small-en-v1.5',
      dimensions: 384,
      collectionName: 'quiz-materials'
    });
  });

  test('requires an explicit dimension for unknown models', () => {
    expect(() => resolveEmbeddingConfig({
      EMBEDDINGS_PROVIDER: 'openai',
      EMBEDDINGS_MODEL: 'custom-embedding-model',
      OPENAI_API_KEY: 'test-key'
    })).toThrow('EMBEDDINGS_DIMENSIONS is required');
  });

  test('rejects dimensions larger than the selected OpenAI model supports', () => {
    expect(() => resolveEmbeddingConfig({
      EMBEDDINGS_MODEL: 'text-embedding-3-small',
      EMBEDDINGS_DIMENSIONS: '3072',
      OPENAI_API_KEY: 'test-key'
    })).toThrow('cannot exceed 1536');
  });

  test('builds the toolkit bridge for the OpenAI provider', () => {
    const logger = { info() {}, debug() {}, warn() {}, error() {} };
    const config = resolveEmbeddingConfig({ OPENAI_API_KEY: 'test-key' });
    const toolkitConfig = createToolkitEmbeddingsConfig(config, logger);

    expect(toolkitConfig).toMatchObject({
      providerType: 'ubc-genai-toolkit-llm',
      batchSize: 256,
      llmConfig: {
        provider: 'openai',
        apiKey: 'test-key',
        embeddingModel: 'text-embedding-3-small'
      }
    });
  });

  test('supports the deployment LLM_API_KEY alias and reads Qdrant vector size', () => {
    const config = resolveEmbeddingConfig({ LLM_API_KEY: 'deployment-key' });

    expect(config.apiKey).toBe('deployment-key');
    expect(getUnnamedQdrantVectorSize({
      result: { config: { params: { vectors: { size: 1536, distance: 'Cosine' } } } }
    })).toBe(1536);
    expect(getUnnamedQdrantVectorSize({
      result: { config: { params: { vectors: { named: { size: 1536 } } } } }
    })).toBeUndefined();
  });
});
