const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
const DEFAULT_FASTEMBED_MODEL = 'fast-bge-small-en-v1.5';

const OPENAI_MODEL_DIMENSIONS = Object.freeze({
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072
});

function parsePositiveInteger(value, fallback, variableName) {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer`);
  }

  return parsed;
}

function sanitizeCollectionSegment(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveEmbeddingConfig(env = process.env) {
  const provider = String(env.EMBEDDINGS_PROVIDER || 'openai').trim().toLowerCase();

  if (!['openai', 'fastembed'].includes(provider)) {
    throw new Error('EMBEDDINGS_PROVIDER must be either "openai" or "fastembed"');
  }

  const model = String(
    env.EMBEDDINGS_MODEL || (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_FASTEMBED_MODEL)
  ).trim();

  const knownDimension = provider === 'openai'
    ? OPENAI_MODEL_DIMENSIONS[model]
    : model === DEFAULT_FASTEMBED_MODEL ? 384 : undefined;

  if (!knownDimension && !env.EMBEDDINGS_DIMENSIONS) {
    throw new Error(
      `EMBEDDINGS_DIMENSIONS is required because CREATE does not know the output size of ${model}`
    );
  }

  const dimensions = parsePositiveInteger(
    env.EMBEDDINGS_DIMENSIONS,
    knownDimension,
    'EMBEDDINGS_DIMENSIONS'
  );

  if (provider === 'openai' && knownDimension && dimensions > knownDimension) {
    throw new Error(
      `EMBEDDINGS_DIMENSIONS cannot exceed ${knownDimension} for ${model}`
    );
  }

  const defaultCollectionName = provider === 'fastembed'
    && model === DEFAULT_FASTEMBED_MODEL
    && dimensions === 384
    ? 'quiz-materials'
    : `quiz-materials-${sanitizeCollectionSegment(provider)}-${sanitizeCollectionSegment(model)}-${dimensions}`;

  const collectionName = String(
    env.EMBEDDINGS_COLLECTION_NAME || defaultCollectionName
  ).trim();

  if (!collectionName) {
    throw new Error('EMBEDDINGS_COLLECTION_NAME cannot be empty');
  }

  const apiKey = provider === 'openai'
    ? env.EMBEDDINGS_API_KEY || env.OPENAI_API_KEY || env.LLM_API_KEY
    : undefined;

  if (provider === 'openai' && !apiKey) {
    throw new Error(
      'EMBEDDINGS_API_KEY, OPENAI_API_KEY, or LLM_API_KEY is required when EMBEDDINGS_PROVIDER=openai'
    );
  }

  return Object.freeze({
    provider,
    model,
    dimensions,
    collectionName,
    apiKey,
    apiEndpoint: provider === 'openai'
      ? env.EMBEDDINGS_API_ENDPOINT
        || env.OPENAI_API_ENDPOINT
        || (env.LLM_PROVIDER === 'openai' ? env.LLM_API_ENDPOINT : undefined)
      : undefined,
    batchSize: parsePositiveInteger(env.EMBEDDINGS_BATCH_SIZE, 256, 'EMBEDDINGS_BATCH_SIZE')
  });
}

export function createToolkitEmbeddingsConfig(config, logger) {
  if (config.provider === 'fastembed') {
    return {
      providerType: 'fastembed',
      fastembedConfig: {
        model: config.model
      },
      batchSize: config.batchSize,
      logger
    };
  }

  return {
    providerType: 'ubc-genai-toolkit-llm',
    llmConfig: {
      provider: 'openai',
      apiKey: config.apiKey,
      endpoint: config.apiEndpoint,
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      embeddingModel: config.model,
      logger
    },
    batchSize: config.batchSize,
    logger
  };
}

export const EMBEDDING_MODEL_DEFAULT_DIMENSIONS = OPENAI_MODEL_DIMENSIONS;

export function getUnnamedQdrantVectorSize(collectionPayload) {
  const vectors = collectionPayload?.result?.config?.params?.vectors;
  return typeof vectors?.size === 'number' ? vectors.size : undefined;
}
