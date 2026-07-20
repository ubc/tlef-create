import { describe, expect, test } from '@jest/globals';
import {
  buildOpenAIStreamingRequest,
  isGpt5Family,
  parseCoursePromptReviewResponse
} from '../../services/llmService.js';

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
      useResponsesApi: true
    });

    expect(request).toEqual({
      model: 'gpt-5.4-nano',
      input: 'Generate a question',
      max_output_tokens: 4000,
      stream: true
    });
    expect(request.temperature).toBeUndefined();
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
