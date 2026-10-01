export const MODEL_SERVICE_LIMIT_MESSAGE = 'The AI service reached a rate limit or usage allowance. Check the provider allowance or wait before retrying. No automatic retry was started.';

// Provider messages can contain request data. Classify only status/code fields
// and expose an application-owned message at the API and receipt boundaries.
export function normalizeModelServiceError(error) {
  if (error?.code === 'MODEL_SERVICE_LIMIT_REACHED') return error;
  const errors = [error, error?.cause];
  const limited = errors.some(value => value && (
    [value.status, value.statusCode, value.code, value.response?.status].some(status => status === 429 || status === '429')
    || [value.code, value.error?.code].some(code => ['insufficient_quota', 'rate_limit_exceeded'].includes(code))
  ));
  return limited ? Object.assign(new Error(MODEL_SERVICE_LIMIT_MESSAGE, { cause: error }), {
    code: 'MODEL_SERVICE_LIMIT_REACHED', status: 429
  }) : error;
}
