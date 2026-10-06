import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const responses = jest.fn();
const chat = jest.fn();
const calls = [];
const withModelTokenReceipt = jest.fn(async (request, work) => {
  const call = { request, captured: {} };
  calls.push(call);
  try {
    const result = await work({ capture: value => Object.assign(call.captured, value) });
    call.outcome = 'completed';
    return result;
  } catch (error) {
    call.outcome = 'failed';
    throw error;
  } finally { call.finished = true; }
});
jest.unstable_mockModule('openai', () => ({ default: class {
  responses = { create: responses };
  chat = { completions: { create: chat } };
} }));
jest.unstable_mockModule('../../services/authoring/authoringTokenUsage.js', () => ({ withModelTokenReceipt }));
const { default: llmService } = await import('../../services/llmService.js');
const { sendOpenAIMessageOnce } = await import('../../utils/openAICompletion.js');
const config = { provider: 'openai', model: 'gpt-6-luna', apiKey: 'synthetic-test-only', endpoint: 'https://api.openai.com/v1' };
const request = { prompt: 'Synthetic request.', llmConfig: config, maxTokens: 8000, reasoningEffort: 'low', jsonMode: true };
const events = async function* (...chunks) { yield* chunks; };
const responseUsage = { input_tokens: 100, output_tokens: 30, total_tokens: 130,
  input_tokens_details: { cached_tokens: 60, cache_write_tokens: 20 }, output_tokens_details: { reasoning_tokens: 12 } };
const chatUsage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130,
  prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 12 } };

beforeEach(() => { jest.clearAllMocks(); calls.length = 0; });

describe('actual provider token receipts', () => {
  test('captures native terminal Responses usage once while preserving streamed content and reported subsets', async () => {
    responses.mockResolvedValue(events(
      { type: 'response.created', response: { id: 'response-1', model: 'gpt-6-luna', status: 'in_progress' } },
      { type: 'response.output_text.delta', delta: '{"ok":true}' },
      { type: 'response.completed', response: { id: 'response-1', model: 'gpt-6-luna', status: 'completed', usage: responseUsage } }
    ));
    const onChunk = jest.fn();
    const result = await llmService.streamCompletion(request, onChunk);
    expect(responses).toHaveBeenCalledTimes(1); expect(chat).not.toHaveBeenCalled();
    expect(responses.mock.calls[0][0]).toMatchObject({ stream: true, max_output_tokens: 8000, reasoning: { effort: 'low' } });
    expect(withModelTokenReceipt).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ request: { provider: 'openai', model: 'gpt-6-luna' }, finished: true, outcome: 'completed',
      captured: { usage: responseUsage, responseId: 'response-1', finishReason: 'completed' } });
    expect(result).toMatchObject({ content: '{"ok":true}', usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130,
      cachedTokens: 60, cacheWriteTokens: 20, reasoningTokens: 12 }, providerUsage: responseUsage, metadata: { id: 'response-1' } });
    expect(onChunk).toHaveBeenCalledWith('{"ok":true}', expect.objectContaining({ partial: true }));
  });

  test('retains billed usage before an incomplete response throws without purchasing a retry', async () => {
    responses.mockResolvedValue(events({ type: 'response.incomplete', response: { id: 'incomplete-1', model: 'gpt-6-luna',
      status: 'incomplete', usage: responseUsage, incomplete_details: { reason: 'max_output_tokens' } } }));
    await expect(llmService.streamCompletion(request)).rejects.toMatchObject({ code: 'OPENAI_MAX_OUTPUT_TOKENS' });
    expect(responses).toHaveBeenCalledTimes(1); expect(withModelTokenReceipt).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ outcome: 'failed', finished: true,
      captured: { usage: responseUsage, responseId: 'incomplete-1', finishReason: 'max_output_tokens' } });
  });

  test('captures failed-terminal usage and identity before reporting the provider failure', async () => {
    responses.mockResolvedValue(events({ type: 'response.failed', response: { id: 'failed-1', model: 'gpt-6-luna',
      status: 'failed', usage: responseUsage, error: { message: 'Synthetic provider failure.' } } }));
    await expect(llmService.streamCompletion(request)).rejects.toThrow('Synthetic provider failure.');
    expect(calls[0]).toMatchObject({ outcome: 'failed', captured: { usage: responseUsage, responseId: 'failed-1', finishReason: 'failed' } });
    expect(responses).toHaveBeenCalledTimes(1);
  });

  test('does not manufacture usage from output length or the budget when provider usage is missing', async () => {
    responses.mockResolvedValue(events({ type: 'response.completed', response: { id: 'unknown-1', status: 'completed',
      output_text: '{"ok":true}' } }));
    const result = await llmService.streamCompletion(request);
    expect(result.content).toBe('{"ok":true}');
    expect(result).not.toHaveProperty('usage');
    expect(calls[0].captured.usage).toBeUndefined();
    expect(calls[0].captured.responseId).toBe('unknown-1');
    expect(withModelTokenReceipt).toHaveBeenCalledTimes(1);
  });

  test('requests Chat stream usage and handles its final empty-choices usage chunk', async () => {
    chat.mockResolvedValue(events(
      { id: 'chat-1', model: 'gpt-6-luna', choices: [{ delta: { content: '{"ok":true}' }, finish_reason: null }] },
      { id: 'chat-1', model: 'gpt-6-luna', choices: [{ delta: {}, finish_reason: 'stop' }] },
      { id: 'chat-1', model: 'gpt-6-luna', choices: [], usage: chatUsage }
    ));
    const result = await llmService.streamCompletion({ ...request, llmConfig: { ...config, endpoint: 'https://synthetic-proxy.invalid/v1' } });
    expect(chat.mock.calls[0][0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(responses).not.toHaveBeenCalled(); expect(chat).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ content: '{"ok":true}', usage: { totalTokens: 130, cachedTokens: 60, reasoningTokens: 12 }, providerUsage: chatUsage });
    expect(calls[0].captured).toMatchObject({ usage: chatUsage, responseId: 'chat-1', finishReason: 'stop' });
  });

  test('keeps Chat length-error usage despite its final chunk having no choices', async () => {
    chat.mockResolvedValue(events(
      { id: 'chat-length', choices: [{ delta: { content: '{' }, finish_reason: 'length' }] },
      { id: 'chat-length', choices: [], usage: chatUsage }
    ));
    await expect(llmService.streamCompletion({ ...request, llmConfig: { ...config, endpoint: 'https://synthetic-proxy.invalid/v1' } }))
      .rejects.toMatchObject({ code: 'OPENAI_MAX_OUTPUT_TOKENS' });
    expect(calls[0]).toMatchObject({ outcome: 'failed', captured: { usage: chatUsage, finishReason: 'length' } });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  test('preserves nonstream native usage details and the existing facade fields', async () => {
    chat.mockResolvedValue({ id: 'nonstream-1', model: 'gpt-6-luna', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: chatUsage });
    const result = await sendOpenAIMessageOnce(config, 'Synthetic request.', { max_completion_tokens: 8000, reasoning_effort: 'low', responseFormat: 'json' });
    expect(chat.mock.calls[0][0]).toMatchObject({ stream: false, max_completion_tokens: 8000, reasoning_effort: 'low' });
    expect(result).toMatchObject({ content: '{"ok":true}', model: 'gpt-6-luna', providerUsage: chatUsage,
      usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130, cachedTokens: 60, cacheWriteTokens: 20, reasoningTokens: 12 } });
    expect(calls[0].captured).toMatchObject({ usage: chatUsage, responseId: 'nonstream-1', finishReason: 'stop' });
    expect(withModelTokenReceipt).toHaveBeenCalledTimes(1);
  });

  test('retains true zero counts without converting missing fields to zero', async () => {
    chat.mockResolvedValue({ id: 'zero-1', model: 'gpt-6-luna', choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, completion_tokens_details: { reasoning_tokens: 0 } } });
    const result = await sendOpenAIMessageOnce(config, 'Synthetic request.');
    expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 0, totalTokens: 10, reasoningTokens: 0 });
    expect(result.usage.cachedTokens).toBeUndefined(); expect(result.usage.cacheWriteTokens).toBeUndefined();
  });

  test.each([true, false])('records one Ollama stream invocation with reported usage present=%s', async reported => {
    const usage = reported ? { promptTokens: 12, completionTokens: 4 } : undefined;
    const stream = jest.fn().mockResolvedValue({ content: 'Synthetic output.', model: 'local-model', usage, metadata: { done_reason: 'stop' } });
    const create = jest.spyOn(llmService, 'createLLMForConfig').mockReturnValue({ streamConversation: stream });
    try {
      const result = await llmService.streamCompletion({ prompt: 'Synthetic request.', llmConfig: { provider: 'ollama', model: 'local-model' } });
      expect(result.content).toBe('Synthetic output.'); expect(stream).toHaveBeenCalledTimes(1);
      expect(withModelTokenReceipt).toHaveBeenCalledTimes(1);
      expect(calls[0].captured.usage).toEqual(usage);
      if (reported) expect(result.usage).toMatchObject(usage);
      else expect(result).not.toHaveProperty('usage');
    } finally { create.mockRestore(); }
  });
});
