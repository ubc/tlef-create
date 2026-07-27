import {
  extractBalancedJson,
  getBlueprintCompletionOptions,
  isOpenAIOutputBudgetError
} from './openAIRequestUtils.js';

export async function completeBlueprintWithRetry({ model, complete, onRetry = null }) {
  try {
    return await complete(getBlueprintCompletionOptions(model, false), {
      attempt: 1,
      retry: false
    });
  } catch (error) {
    if (!isOpenAIOutputBudgetError(error)) throw error;
    await onRetry?.(error);
    return complete(getBlueprintCompletionOptions(model, true), {
      attempt: 2,
      retry: true
    });
  }
}

export function parseBlueprintResponse(response) {
  const responseText = typeof response === 'string' ? response : response?.content;
  if (!responseText || typeof responseText !== 'string') {
    const error = new Error('The model did not return blueprint content');
    error.code = 'AI_OUTPUT_EMPTY';
    throw error;
  }

  const objectStart = responseText.indexOf('{');
  const jsonText = extractBalancedJson(objectStart >= 0 ? responseText.slice(objectStart) : responseText);
  if (!jsonText) {
    const error = new Error('The model did not return a complete blueprint JSON object');
    error.code = 'AI_PARSE_ERROR';
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (cause) {
    const error = new Error(`The model returned invalid blueprint JSON: ${cause.message}`);
    error.code = 'AI_PARSE_ERROR';
    error.cause = cause;
    throw error;
  }

  if (!Array.isArray(parsed?.planItems)) {
    const error = new Error('The blueprint JSON is missing the planItems array');
    error.code = 'AI_INVALID_FORMAT';
    throw error;
  }

  return parsed;
}
