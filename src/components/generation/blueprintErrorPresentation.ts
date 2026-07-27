import { ApiError } from '../../services/api';

export function getBlueprintGenerationError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Blueprint Generation Failed',
      message: error instanceof Error ? error.message : 'The Blueprint could not be generated. Please retry.'
    };
  }

  const titles: Record<string, string> = {
    NO_API_KEY: 'AI Key Required',
    AI_CREDENTIAL_ERROR: 'AI Key or Model Unavailable',
    AI_RATE_LIMIT: 'AI Provider Busy',
    AI_TIMEOUT: 'AI Provider Timed Out',
    AI_OUTPUT_INCOMPLETE: 'Incomplete AI Response',
    AI_PARSE_ERROR: 'Incomplete Blueprint Format',
    AI_INVALID_FORMAT: 'Invalid Blueprint Format',
    PLAN_BUDGET_ERROR: 'Blueprint Coverage Error'
  };

  return {
    title: error.code ? titles[error.code] || 'Blueprint Generation Failed' : 'Blueprint Generation Failed',
    message: error.message || 'The Blueprint could not be generated. Please retry.'
  };
}
