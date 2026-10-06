import { afterEach, expect, it, vi } from 'vitest';
import { materialsApi } from './api';

vi.mock('../config/api', () => ({ API_URL: 'http://localhost:8051' }));
afterEach(() => vi.unstubAllGlobals());

it('restores one authenticated material index with an empty request and returns its confirmed receipt', async () => {
  const processing = { materialId: 'material/one', chunksCount: 22, restored: true,
    embeddingProvider: 'openai', embeddingModel: 'embedding-model', embeddingDimensions: 768 };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { processing } }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }));
  vi.stubGlobal('fetch', fetch);
  expect(await materialsApi.reindexMaterial(processing.materialId)).toEqual({ processing });
  expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/api/create/materials/material%2Fone/reindex');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', body: '{}' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
