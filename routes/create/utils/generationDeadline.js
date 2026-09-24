export function assertGenerationActive(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Question generation was cancelled.');
}

export function generationOutcomeUnconfirmed(cause) {
  const error = new Error('CREATE has not confirmed the result. Refresh Review before retrying; generation may still finish.', { cause });
  error.code = 'GENERATION_OUTCOME_UNCONFIRMED';
  error.errorType = error.code;
  return error;
}

// Bound retrieval/model/review work. Once persistence starts we must wait for its
// actual result, rather than announce failure while a database commit continues.
export async function runWithGenerationDeadline(work, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Generation timeout after ${timeoutMs / 1000}s. No question was saved.`);
      error.code = 'GENERATION_TIMEOUT';
      error.errorType = 'generation-timeout';
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const beginPersistence = () => {
    assertGenerationActive(controller.signal);
    clearTimeout(timer);
  };
  try {
    return await Promise.race([
      Promise.resolve().then(() => work({ signal: controller.signal, beginPersistence })),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}
