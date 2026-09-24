import { describe, expect, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import {
  buildOpenAIIncompleteResponseError,
  buildOpenAIStreamingRequest,
  extractResponsesOutputText,
  getLearningObjectiveCompletionOptions,
  getQuestionCompletionOptions,
  isOpenAIOutputBudgetError,
  isGpt5Family,
  supportsOpenAIStructuredOutputs,
  parseCoursePromptReviewResponse
} from '../../utils/openAIRequestUtils.js';

describe('OpenAI streaming request configuration', () => {
  test('only enables strict output schemas on compatible official text models', () => {
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06', 'gpt-4.1', 'gpt-5.4-nano', 'o1', 'o3-mini']) {
      expect(supportsOpenAIStructuredOutputs(model, 'https://api.openai.com/v1/')).toBe(true);
    }
    for (const model of ['gpt-4o-2024-05-13', 'gpt-4o-audio-preview', 'o1-preview', 'o1-mini', 'gpt-4-turbo']) {
      expect(supportsOpenAIStructuredOutputs(model, 'https://api.openai.com/v1')).toBe(false);
    }
    expect(supportsOpenAIStructuredOutputs('gpt-5.4-nano', 'http://localhost:4000/v1')).toBe(false);
  });
  test('uses strict schema output on both transports without conflating it with JSON mode', () => {
    const jsonSchema = { name: 'review', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
    const options = { model: 'gpt-5-nano', prompt: 'Return JSON.', maxTokens: 8000, jsonMode: true, jsonSchema };
    expect(buildOpenAIStreamingRequest({ ...options, useResponsesApi: true }).text.format).toEqual({ type: 'json_schema', ...jsonSchema, strict: true });
    expect(buildOpenAIStreamingRequest({ ...options, useResponsesApi: false }).response_format).toEqual({ type: 'json_schema', json_schema: { ...jsonSchema, strict: true } });
  });
  test('opts structured workflows into JSON mode on both API transports', () => {
    const options = { model: 'gpt-5-nano', prompt: 'Return JSON.', maxTokens: 12000, jsonMode: true };
    expect(buildOpenAIStreamingRequest({ ...options, useResponsesApi: true }).text).toEqual({ format: { type: 'json_object' } });
    expect(buildOpenAIStreamingRequest({ ...options, useResponsesApi: false }).response_format).toEqual({ type: 'json_object' });
    expect(buildOpenAIStreamingRequest({ ...options, jsonMode: false, useResponsesApi: false })).not.toHaveProperty('response_format');
  });
  test('recognizes newer GPT model families that omit custom temperature', () => {
    expect(isGpt5Family('gpt-5.4-nano')).toBe(true);
    expect(isGpt5Family('gpt-6-luna')).toBe(true);
    expect(isGpt5Family('gpt-4o-mini')).toBe(false);
  });

  test('does not send unsupported sampling temperature to GPT-6 chat requests', () => {
    const request = buildOpenAIStreamingRequest({ model: 'gpt-6-luna', prompt: 'Return JSON.', temperature: 0.3, maxTokens: 8000 });
    expect(request).not.toHaveProperty('temperature');
  });

  test('uses Responses API parameters without temperature for GPT-5 models', () => {
    const request = buildOpenAIStreamingRequest({
      model: 'gpt-5.4-nano',
      prompt: 'Generate a question',
      temperature: 0.7,
      maxTokens: 4000,
      useResponsesApi: true,
      reasoningEffort: 'none'
    });

    expect(request).toEqual({
      model: 'gpt-5.4-nano',
      input: 'Generate a question',
      max_output_tokens: 4000,
      stream: true,
      reasoning: { effort: 'none' }
    });
    expect(request.temperature).toBeUndefined();
  });
  test('does not send unsupported sampling temperature to o-series reasoning models', () => {
    const request = buildOpenAIStreamingRequest({ model: 'o3-mini', prompt: 'Return JSON.', temperature: 0.1, maxTokens: 8000 });
    expect(request).not.toHaveProperty('temperature');
  });

  test('allocates a reasoning-safe LO budget for GPT-5.4 nano with one larger retry', () => {
    expect(getLearningObjectiveCompletionOptions('gpt-5.4-nano')).toEqual({
      maxTokens: 12000,
      reasoningEffort: 'none'
    });
    expect(getLearningObjectiveCompletionOptions('gpt-5.4-nano', true)).toEqual({
      maxTokens: 24000,
      reasoningEffort: 'none'
    });
    expect(getLearningObjectiveCompletionOptions('gpt-4o-mini')).toEqual({
      maxTokens: 2600,
      reasoningEffort: null
    });
  });

  test('allocates visible-output room and low reasoning for GPT-5 nano questions', () => {
    expect(getQuestionCompletionOptions('gpt-5-nano')).toEqual({
      maxTokens: 8000,
      reasoningEffort: 'low'
    });
    expect(getQuestionCompletionOptions('gpt-5-nano', true)).toEqual({
      maxTokens: 12000,
      reasoningEffort: 'low'
    });
    expect(getQuestionCompletionOptions('gpt-4o-mini')).toEqual({
      maxTokens: 2000,
      reasoningEffort: null
    });
  });

  test('does not restore a custom temperature through toolkit defaults for GPT-5 nano', () => {
    const config = {
      provider: 'openai',
      model: 'gpt-5-nano',
      apiKey: 'test-key',
      endpoint: 'https://api.openai.com/v1'
    };
    const requestLLM = llmService.createLLMForConfig(config);
    const options = llmService.getSendMessageOptions(0.7, 8000, config, 'low');

    expect(requestLLM.config.defaultOptions.temperature).toBeUndefined();
    expect(options).toEqual({
      max_completion_tokens: 8000,
      reasoning_effort: 'low'
    });
  });

  test('recovers final Responses API text when no delta event was delivered', () => {
    expect(extractResponsesOutputText({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '{"objectives":[]}' }]
      }]
    })).toBe('{"objectives":[]}');
  });

  test('classifies max-output incomplete responses as retryable budget errors', () => {
    const error = buildOpenAIIncompleteResponseError('gpt-5.4-nano', 'max_output_tokens');

    expect(error.message).toContain('used its output budget');
    expect(error.incompleteReason).toBe('max_output_tokens');
    expect(isOpenAIOutputBudgetError(error)).toBe(true);
  });

  test('uses Chat Completions parameters for GPT-4o mini', () => {
    const request = buildOpenAIStreamingRequest({
      model: 'gpt-4o-mini',
      prompt: 'Generate a question',
      temperature: 0.6,
      maxTokens: 2000,
      useResponsesApi: false
    });

    expect(request.max_completion_tokens).toBe(2000);
    expect(request.temperature).toBe(0.6);
    expect(request.messages).toEqual([
      { role: 'user', content: 'Generate a question' }
    ]);
  });
});

describe('course prompt AI review parsing', () => {
  test('parses fenced structured warnings and suggestions', () => {
    const result = parseCoursePromptReviewResponse(`\`\`\`json
      {
        "warnings": ["The output format is ambiguous."],
        "suggestions": ["Request evidence references."],
        "revisedPrompt": "Use the supplied evidence and return the required format.",
        "changeSummary": ["Added evidence and output guidance."],
        "ignored": "field"
      }
    \`\`\``);

    expect(result).toEqual({
      warnings: ['The output format is ambiguous.'],
      suggestions: ['Request evidence references.'],
      revisedPrompt: 'Use the supplied evidence and return the required format.',
      changeSummary: ['Added evidence and output guidance.']
    });
  });

  test('rejects a response without a JSON object', () => {
    expect(() => parseCoursePromptReviewResponse('Looks good.')).toThrow(
      'Prompt review did not return a JSON object'
    );
  });
});
