export const UNCONFIRMED_GENERATION_MESSAGE = 'CREATE has not confirmed the result. Refresh Review before retrying; generation may still finish.';

export class GenerationOutcomeUnconfirmedError extends Error {
  readonly code = 'GENERATION_OUTCOME_UNCONFIRMED';

  constructor() {
    super(UNCONFIRMED_GENERATION_MESSAGE);
    this.name = 'GenerationOutcomeUnconfirmedError';
  }
}

export function isGenerationOutcomeUnconfirmed(error: unknown): error is GenerationOutcomeUnconfirmedError {
  return error instanceof Error && 'code' in error && error.code === 'GENERATION_OUTCOME_UNCONFIRMED';
}
