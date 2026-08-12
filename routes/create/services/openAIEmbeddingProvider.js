import OpenAI from 'openai';

export class OpenAIEmbeddingProvider {
  constructor({ apiKey, endpoint, model, dimensions, batchSize = 256 }) {
    this.client = new OpenAI({
      apiKey,
      ...(endpoint ? { baseURL: endpoint } : {})
    });
    this.model = model;
    this.dimensions = dimensions;
    this.batchSize = batchSize;
  }

  async embed(texts) {
    const inputs = Array.isArray(texts) ? texts : [texts];
    const embeddings = [];

    for (let offset = 0; offset < inputs.length; offset += this.batchSize) {
      const batch = inputs.slice(offset, offset + this.batchSize);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        encoding_format: 'float',
        dimensions: this.dimensions
      });

      const ordered = [...response.data].sort((left, right) => left.index - right.index);
      for (const item of ordered) {
        if (!Array.isArray(item.embedding) || item.embedding.length !== this.dimensions) {
          throw new Error(
            `Embedding model ${this.model} returned ${item.embedding?.length ?? 0} dimensions; expected ${this.dimensions}`
          );
        }
        embeddings.push(item.embedding);
      }
    }

    return embeddings;
  }
}

export default OpenAIEmbeddingProvider;
