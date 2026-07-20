export function isGpt5Family(model = '') {
  return model.toLowerCase().startsWith('gpt-5');
}

export function buildOpenAIStreamingRequest({
  model,
  prompt,
  temperature,
  maxTokens,
  useResponsesApi,
  reasoningEffort = null
}) {
  if (useResponsesApi) {
    return {
      model,
      input: prompt,
      max_output_tokens: maxTokens,
      stream: true,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {})
    };
  }

  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: maxTokens,
    stream: true,
    ...(!isGpt5Family(model) ? { temperature } : {})
  };
}

export function extractResponsesOutputText(response = {}) {
  if (typeof response.output_text === 'string' && response.output_text) {
    return response.output_text;
  }

  return (Array.isArray(response.output) ? response.output : [])
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('');
}

export function getLearningObjectiveCompletionOptions(model, retry = false) {
  if (!isGpt5Family(model)) {
    return { maxTokens: 2600, reasoningEffort: null };
  }

  return {
    // GPT-5 output budgets include both hidden reasoning and visible JSON.
    // Reserve enough room for both, then double it for the single bounded retry.
    maxTokens: retry ? 24000 : 12000,
    // GPT-5.4 nano supports `none` and is intended for extraction-style work.
    // Older GPT-5 aliases do not all support `none`, so keep those on `low`.
    reasoningEffort: model.toLowerCase().startsWith('gpt-5.4-nano') ? 'none' : 'low'
  };
}

export function isOpenAIOutputBudgetError(error) {
  return error?.code === 'OPENAI_MAX_OUTPUT_TOKENS';
}

export function buildOpenAIIncompleteResponseError(model, reason = 'unknown') {
  const error = new Error(
    reason === 'max_output_tokens'
      ? `Model ${model} used its output budget before completing the visible response`
      : `Model ${model} returned an incomplete response (${reason})`
  );
  error.code = reason === 'max_output_tokens'
    ? 'OPENAI_MAX_OUTPUT_TOKENS'
    : 'OPENAI_RESPONSE_INCOMPLETE';
  error.incompleteReason = reason;
  return error;
}

export function parseCoursePromptReviewResponse(content = '') {
  const withoutFence = String(content)
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const jsonMatch = withoutFence.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Prompt review did not return a JSON object');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const normalizeItems = value => (
    Array.isArray(value)
      ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 5)
      : []
  );
  const revisedPrompt = typeof parsed.revisedPrompt === 'string'
    ? parsed.revisedPrompt.trim().slice(0, 12000)
    : '';

  return {
    warnings: normalizeItems(parsed.warnings),
    suggestions: normalizeItems(parsed.suggestions),
    revisedPrompt,
    changeSummary: normalizeItems(parsed.changeSummary)
  };
}
