import { useCallback, useEffect, useRef, useState } from 'react';
import { questionsApi, type QuestionGenerationJob, type StreamingQuestionConfig } from '../services/api';
import { GenerationOutcomeUnconfirmedError } from '../utils/questionGenerationOutcome';

export const isGenerationJobActive = (job: QuestionGenerationJob) => job.status === 'running' || job.status === 'committing';
const POLL_MS = 2500;

// Only the opaque receipt is retained locally. Prompts, source text and keys
// stay out of browser recovery storage; the owner-scoped API is authoritative.
function storedRequest(key: string | null): string | null {
  try { return key ? sessionStorage.getItem(key) : null; } catch { return null; }
}
function storeRequest(key: string | null, requestId: string | null) {
  try {
    if (key && requestId) sessionStorage.setItem(key, requestId);
    else if (key) sessionStorage.removeItem(key);
  } catch { /* Recovery also discovers the latest job from the server. */ }
}

export function useQuestionGenerationJob(
  quizId: string,
  ownerId?: string,
  onSettled?: (job: QuestionGenerationJob) => void
) {
  const key = ownerId ? `create:question-job:${ownerId}:${quizId}` : null;
  const [job, setJob] = useState<QuestionGenerationJob | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [unregistered, setUnregistered] = useState(false);
  const scope = useRef({ quizId, key, epoch: 0 });
  const request = useRef<string | null>(null);
  const currentJob = useRef<QuestionGenerationJob | null>(null);
  const busy = useRef(false);
  const notified = useRef<string | null>(null);
  const watched = useRef<string | null>(null);
  const callbacks = useRef(onSettled);
  callbacks.current = onSettled;
  const pending = useRef<{
    requestId: string;
    resolve: (job: QuestionGenerationJob) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const accept = useCallback((next: QuestionGenerationJob) => {
    if (next.quizId !== scope.current.quizId) return;
    // A slow status response must not regress a receipt already confirmed.
    const previous = currentJob.current;
    if (previous?.requestId === next.requestId && !isGenerationJobActive(previous) && isGenerationJobActive(next)) return;
    request.current = next.requestId;
    currentJob.current = next;
    setJob(next);
    setRecoveryMessage(null);
    setUnregistered(false);
    busy.current = isGenerationJobActive(next);
    setIsBusy(busy.current);
    if (busy.current) {
      watched.current = next.requestId;
      storeRequest(scope.current.key, next.requestId);
      return;
    }
    storeRequest(scope.current.key, null);
    if (pending.current?.requestId === next.requestId) {
      const waiting = pending.current;
      pending.current = null;
      if (next.status === 'succeeded') waiting.resolve(next);
      else waiting.reject(Object.assign(new Error(next.message || 'Generation did not publish. Your saved questions were preserved.'), { code: 'GENERATION_JOB_FAILED' }));
    }
    if (watched.current === next.requestId && notified.current !== next.requestId) {
      notified.current = next.requestId;
      callbacks.current?.(next);
    }
  }, []);

  const refresh = useCallback(async () => {
    const context = scope.current;
    const expected = request.current;
    try {
      const next = expected && (!currentJob.current || isGenerationJobActive(currentJob.current))
        ? await questionsApi.getGenerationJob(expected)
        : (await questionsApi.listGenerationJobs(context.quizId))[0];
      if (scope.current !== context || request.current !== expected) return;
      if (next) accept(next);
      else {
        busy.current = false;
        setIsBusy(false);
        setRecoveryMessage(null);
      }
    } catch (error) {
      if (scope.current !== context || request.current !== expected) return;
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      setUnregistered(status === 404 && Boolean(expected));
      setRecoveryMessage(status === 401
        ? 'Sign in again to recover this task. It will not be submitted again.'
        : status === 404 && expected
          ? 'The server has no receipt for this submission. Check again, or safely close the unregistered request before starting a new task.'
        : expected
          ? 'Checking the saved task status. A lost connection does not mean generation failed. Do not submit it again.'
          : 'Task status is unavailable. Check again before starting another generation.');
    }
  }, [accept]);

  useEffect(() => {
    const context = { quizId, key, epoch: scope.current.epoch + 1 };
    scope.current = context;
    request.current = storedRequest(key);
    watched.current = request.current;
    currentJob.current = null;
    notified.current = null;
    busy.current = true;
    setJob(null);
    setIsBusy(true);
    setRecoveryMessage(null);
    setUnregistered(false);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastIdleCheck = 0;
    const poll = async () => {
      if (busy.current || Date.now() - lastIdleCheck >= 30_000) {
        await refresh();
        lastIdleCheck = Date.now();
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (scope.current === context) scope.current = { ...context, epoch: context.epoch + 1 };
      if (pending.current) {
        pending.current.reject(new GenerationOutcomeUnconfirmedError());
        pending.current = null;
      }
    };
  }, [quizId, key, refresh]);

  const start = useCallback((configs: StreamingQuestionConfig[], mode: 'append' | 'replace' = 'append'): Promise<QuestionGenerationJob> => {
    if (scope.current.quizId !== quizId || scope.current.key !== key) return Promise.reject(new Error('The learning object changed. Start generation from the current page.'));
    if (busy.current || pending.current) return Promise.reject(new Error('A generation task is active or its status is being checked. Please wait for its result.'));
    const context = scope.current;
    const requestId = crypto.randomUUID();
    const sessionId = `questions-${requestId}`;
    request.current = requestId;
    watched.current = requestId;
    currentJob.current = null;
    busy.current = true;
    setJob(null);
    setIsBusy(true);
    setRecoveryMessage(null);
    setUnregistered(false);
    storeRequest(context.key, requestId);
    return new Promise((resolve, reject) => {
      pending.current = { requestId, resolve, reject };
      // Submission happens exactly once. Recovery only reads the receipt.
      void questionsApi.startQuestionGeneration(context.quizId, sessionId, configs, { requestId, mode }).then(result => {
        if (scope.current !== context || request.current !== requestId) return;
        accept(result.job);
      }).catch(error => {
        if (scope.current !== context || request.current !== requestId) return;
        if (currentJob.current && !isGenerationJobActive(currentJob.current)) return;
        const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408) {
          pending.current = null;
          request.current = null;
          storeRequest(context.key, null);
          busy.current = false;
          setIsBusy(false);
          reject(error instanceof Error ? error : new Error('Generation request was refused.'));
          // In particular, a second tab may already own the active task.
          void refresh();
        } else {
          setRecoveryMessage('The submission response was lost. Recovering the saved task without submitting it again.');
          void refresh();
        }
      });
    });
  }, [accept, refresh, quizId, key]);

  const closeUnregistered = useCallback(async () => {
    const context = scope.current;
    const requestId = request.current;
    if (!requestId) return;
    try {
      // The server fences the old ID before we let a new request be submitted.
      // If the old request won the race, this returns its actual running job.
      const confirmed = await questionsApi.abandonUnconfirmedGeneration(context.quizId, requestId);
      if (scope.current === context && request.current === requestId) accept(confirmed);
    } catch (error) {
      if (scope.current === context) setRecoveryMessage(`The server could not confirm this request. ${error instanceof Error ? error.message : 'Reconnect and check task status.'} No new generation was submitted.`);
    }
  }, [accept]);

  return { job, isBusy, recoveryMessage, unregistered, closeUnregistered, start, refresh };
}
