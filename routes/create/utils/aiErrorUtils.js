const MESSAGE_PATTERNS = {
  rateLimit: /rate.?limit|too many requests|quota/i,
  timeout: /timeout|timed out|aborterror/i,
  credentials: /invalid api key|incorrect api key|authentication|unauthorized|forbidden/i
};

export function classifyAIError(error, fallbackStage = 'llm') {
  const sourceCode = typeof error?.code === 'string' ? error.code : '';
  const sourceStatus = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  const message = typeof error?.message === 'string' ? error.message : 'AI service request failed';
  const errorStage = error?.stage || fallbackStage;

  if (sourceCode === 'NO_API_KEY') {
    return {
      errorCode: 'NO_API_KEY',
      errorStage: 'config',
      statusCode: 400,
      userMessage: 'No AI API key is configured. Add a key in User Account, then retry.'
    };
  }

  if (sourceCode === 'OPENAI_MAX_OUTPUT_TOKENS' || sourceCode === 'OPENAI_RESPONSE_INCOMPLETE') {
    return {
      errorCode: 'AI_OUTPUT_INCOMPLETE',
      errorStage,
      statusCode: 502,
      userMessage: 'The AI response ended before the Blueprint was complete. Please retry.'
    };
  }

  if (sourceCode === 'AI_PARSE_ERROR' || sourceCode === 'AI_INVALID_FORMAT' || sourceCode === 'AI_OUTPUT_EMPTY') {
    return {
      errorCode: sourceCode,
      errorStage: 'parse',
      statusCode: 502,
      userMessage: 'The AI returned an incomplete Blueprint format. Please retry.'
    };
  }

  if (sourceStatus === 429 || MESSAGE_PATTERNS.rateLimit.test(message)) {
    return {
      errorCode: 'AI_RATE_LIMIT',
      errorStage,
      statusCode: 429,
      userMessage: 'The AI provider is temporarily rate-limiting requests. Wait a moment, then retry.'
    };
  }

  if ([401, 403].includes(sourceStatus) || MESSAGE_PATTERNS.credentials.test(message)) {
    return {
      errorCode: 'AI_CREDENTIAL_ERROR',
      errorStage: 'config',
      // Do not return 401: the frontend reserves it for an expired CREATE session.
      statusCode: 400,
      userMessage: 'The configured AI key or model is not authorized. Check User Account settings, then retry.'
    };
  }

  if (sourceCode === 'ETIMEDOUT' || sourceCode === 'ECONNABORTED' || MESSAGE_PATTERNS.timeout.test(message)) {
    return {
      errorCode: 'AI_TIMEOUT',
      errorStage,
      statusCode: 504,
      userMessage: 'The AI provider took too long to respond. Please retry.'
    };
  }

  return {
    errorCode: 'AI_SERVICE_ERROR',
    errorStage,
    statusCode: 503,
    userMessage: 'The AI provider could not generate the Blueprint. Please retry.'
  };
}
