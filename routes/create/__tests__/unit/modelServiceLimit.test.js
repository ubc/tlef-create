import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import { normalizeModelServiceError } from '../../utils/modelServiceErrors.js';

describe('model usage-limit boundary', () => {
  test('the real SDK sends one local HTTP request for a quota error, without hidden retries', async () => {
    let requests = 0;
    const server = createServer((req, res) => {
      requests++;
      req.resume();
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'Synthetic quota exhausted.' } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
      await expect(llmService.streamCompletion({ prompt: 'Synthetic local request.',
        llmConfig: { provider: 'openai', model: 'gpt-6-luna', apiKey: 'local-test-only', endpoint }, signal: AbortSignal.timeout(5000) }))
        .rejects.toMatchObject({ code: 'MODEL_SERVICE_LIMIT_REACHED', status: 429, message: expect.stringContaining('No automatic retry') });
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  test('keeps unrelated transport failures unchanged instead of mislabelling them as quota errors', () => {
    const error = new Error('Connection closed.');
    expect(normalizeModelServiceError(error)).toBe(error);
  });
  test('the non-streaming facade also sends only one HTTP request after a quota error', async () => {
    let requests = 0;
    const server = createServer((req, res) => {
      requests++; req.resume();
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'insufficient_quota', message: 'Synthetic quota exhausted.' } }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const client = llmService.createLLMForConfig({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'local-test-only', endpoint: `http://127.0.0.1:${server.address().port}/v1` });
      await expect(client.sendMessage('Synthetic local request.', { responseFormat: 'json', signal: AbortSignal.timeout(5000) }))
        .rejects.toMatchObject({ code: 'MODEL_SERVICE_LIMIT_REACHED', status: 429 });
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  test('preserves JSON, model, token budget and usage through the facade on a successful local response', async () => {
    let payload;
    const server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      payload = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'local-response', model: 'gpt-6-luna', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const client = llmService.createLLMForConfig({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'local-test-only', endpoint: `http://127.0.0.1:${server.address().port}/v1` });
      const result = await client.sendMessage('Synthetic request.', { systemPrompt: 'Return JSON.', responseFormat: 'json', max_completion_tokens: 8000, reasoning_effort: 'low', signal: AbortSignal.timeout(5000) });
      expect(payload).toMatchObject({ model: 'gpt-6-luna', response_format: { type: 'json_object' }, stream: false, max_completion_tokens: 8000, reasoning_effort: 'low', messages: [{ role: 'system', content: 'Return JSON.' }, { role: 'user', content: 'Synthetic request.' }] });
      expect(payload).not.toHaveProperty('signal'); expect(payload).not.toHaveProperty('responseFormat');
      expect(result).toMatchObject({ content: '{"ok":true}', model: 'gpt-6-luna', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, metadata: { id: 'local-response' } });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  test('classifies a wrapped quota code without copying provider data into its message', () => {
    const error = new Error('PRIVATE request details.', { cause: { error: { code: 'insufficient_quota' } } });
    const result = normalizeModelServiceError(error);
    expect(result.code).toBe('MODEL_SERVICE_LIMIT_REACHED');
    expect(result.message).not.toContain('PRIVATE');
    expect(normalizeModelServiceError(result)).toBe(result);
  });
});
