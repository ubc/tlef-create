import { describe, expect, test } from '@jest/globals';
import {
  buildOpenAIIncompleteResponseError,
  buildOpenAIStreamingRequest,
  extractResponsesOutputText,
  getLearningObjectiveCompletionOptions,
  isOpenAIOutputBudgetError,
  isGpt5Family,
  parseCoursePromptReviewResponse
} from '../../utils/openAIRequestUtils.js';

describe('OpenAI streaming request configuration', () => {
  test('recognizes GPT-5 family model names', () => {
    expect(isGpt5Family('gpt-5.4-nano')).toBe(true);
    expect(isGpt5Family('gpt-4o-mini')).toBe(false);
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
