import { normalizeModelServiceError } from './modelServiceErrors.js';

// The toolkit's OpenAI provider does not expose SDK retry configuration. Keep
// its response shape while using an explicitly bounded single-message request.
export async function sendOpenAIMessageOnce(config, prompt, options = {}) {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.endpoint || 'https://api.openai.com/v1', maxRetries: 0 });
  const { systemPrompt, responseFormat, maxTokens, signal, model, ...parameters } = options;
  if (maxTokens != null) {
    delete parameters.max_completion_tokens;
    delete parameters.max_tokens;
  }
  const messages = [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), { role: 'user', content: prompt }];
  try {
    const response = await client.chat.completions.create({
      ...parameters, model: model || config.model, messages, stream: false,
      ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
      ...(responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {})
    }, { signal });
    return {
      content: response.choices[0]?.message?.content || '', model: response.model,
      usage: { promptTokens: response.usage?.prompt_tokens, completionTokens: response.usage?.completion_tokens, totalTokens: response.usage?.total_tokens },
      metadata: { provider: 'openai', id: response.id, created: response.created }
    };
  } catch (error) { throw normalizeModelServiceError(error); }
}
