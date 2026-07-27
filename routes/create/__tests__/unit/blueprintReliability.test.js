import { describe, expect, test } from '@jest/globals';
import { classifyAIError } from '../../utils/aiErrorUtils.js';
import {
  completeBlueprintWithRetry,
  parseBlueprintResponse
} from '../../utils/blueprintResponseUtils.js';
import {
  buildOpenAIIncompleteResponseError,
  extractBalancedJson,
  getBlueprintCompletionOptions
} from '../../utils/openAIRequestUtils.js';

describe('Blueprint reliability utilities', () => {
  test('allocates reasoning-safe GPT-5 output budgets with one larger retry', () => {
    expect(getBlueprintCompletionOptions('gpt-5.4-nano')).toEqual({
      maxTokens: 12000,
      reasoningEffort: 'none'
    });
    expect(getBlueprintCompletionOptions('gpt-5.4-nano', true)).toEqual({
      maxTokens: 24000,
      reasoningEffort: 'none'
    });
    expect(getBlueprintCompletionOptions('gpt-4o-mini')).toEqual({
      maxTokens: 2400,
      reasoningEffort: null
    });
  });

  test('extracts balanced JSON without consuming trailing prose or braces in strings', () => {
    const content = 'Draft: ```json\n{"planItems":[{"focusArea":"Use {nested} notation"}]}\n``` trailing {text}';
    expect(extractBalancedJson(content)).toBe('{"planItems":[{"focusArea":"Use {nested} notation"}]}');
  });

  test('parses a fenced Blueprint and ignores leading bracketed prose', () => {
    const parsed = parseBlueprintResponse({
      content: '[draft] Here is the result:\n```json\n{"planItems":[{"type":"multiple-choice","learningObjectiveIndex":0,"count":1}]}\n```'
    });
    expect(parsed.planItems).toHaveLength(1);
  });

  test('classifies truncated, provider, credential, and parse failures safely', () => {
    expect(classifyAIError(buildOpenAIIncompleteResponseError('gpt-5.4-nano', 'max_output_tokens')))
      .toMatchObject({ errorCode: 'AI_OUTPUT_INCOMPLETE', statusCode: 502 });
    expect(classifyAIError({ status: 429, message: 'Too many requests' }))
      .toMatchObject({ errorCode: 'AI_RATE_LIMIT', statusCode: 429 });
    expect(classifyAIError({ status: 401, message: 'Incorrect API key' }))
      .toMatchObject({ errorCode: 'AI_CREDENTIAL_ERROR', statusCode: 400 });

    let parseError;
    try {
      parseBlueprintResponse({ content: '{"planItems":[' });
    } catch (error) {
      parseError = error;
    }
    expect(classifyAIError(parseError)).toMatchObject({
      errorCode: 'AI_PARSE_ERROR',
      errorStage: 'parse',
      statusCode: 502
    });
  });

  test('retries exactly once only for an output-budget interruption', async () => {
    const calls = [];
    let retries = 0;
    const result = await completeBlueprintWithRetry({
      model: 'gpt-5.4-nano',
      complete: async (options, context) => {
        calls.push({ options, context });
        if (context.attempt === 1) {
          throw buildOpenAIIncompleteResponseError('gpt-5.4-nano', 'max_output_tokens');
        }
        return { content: '{"planItems":[]}' };
      },
      onRetry: () => { retries += 1; }
    });

    expect(result.content).toContain('planItems');
    expect(retries).toBe(1);
    expect(calls).toEqual([
      {
        options: { maxTokens: 12000, reasoningEffort: 'none' },
        context: { attempt: 1, retry: false }
      },
      {
        options: { maxTokens: 24000, reasoningEffort: 'none' },
        context: { attempt: 2, retry: true }
      }
    ]);
  });

  test('does not retry authentication or rate-limit failures', async () => {
    let attempts = 0;
    await expect(completeBlueprintWithRetry({
      model: 'gpt-5.4-nano',
      complete: async () => {
        attempts += 1;
        const error = new Error('Too many requests');
        error.status = 429;
        throw error;
      }
    })).rejects.toMatchObject({ status: 429 });
    expect(attempts).toBe(1);
  });
});
