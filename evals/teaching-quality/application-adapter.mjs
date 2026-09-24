import { performance } from 'node:perf_hooks';
import { safeErrorCode } from './runner.mjs';

function error(code) { return Object.assign(new Error(code), { code }); }
export function transportDiagnostic(cause) {
  const allowedCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNRESET', 'EPERM']);
  const chain = [cause, cause?.cause, cause?.cause?.cause];
  return {
    httpStatus: chain.map(item => item?.status).find(status => Number.isInteger(status) && status >= 400 && status <= 599) ?? null,
    networkCode: chain.map(item => item?.code).find(code => allowedCodes.has(code)) ?? null
  };
}
export function adapterFailure(cause) {
  const nestedCode = safeErrorCode(cause?.cause);
  const qualityFailureReasons = new Set(['ARITHMETIC_INVALID_SCHEMA', 'ARITHMETIC_UNSUPPORTED_EXPRESSION', 'ARITHMETIC_DIVISION_BY_ZERO', 'ARITHMETIC_FALSE_EQUALITY', 'FEEDBACK_TEXT_LIMIT']);
  return { errorCode: nestedCode !== 'EVAL_ADAPTER_ERROR' ? nestedCode : safeErrorCode(cause),
    qualityCheck: cause?.qualityCheck === 'arithmetic' ? 'arithmetic' : null,
    qualityFailureReason: qualityFailureReasons.has(cause?.qualityFailureReason) ? cause.qualityFailureReason : null };
}
function parseJSON(content, extract) {
  try { return JSON.parse(extract(content)); }
  catch { throw error('EVAL_PARSE'); }
}

export function createCompletionBudget({ call, maxCalls, timeoutMs }) {
  let usedCalls = 0;
  let timedOut = false;
  return async (options, { remainingMs = timeoutMs, onStart = () => {} } = {}) => {
    if (timedOut) throw error('EVAL_TIMEOUT');
    if (usedCalls >= maxCalls) throw error('EVAL_CALL_BUDGET');
    const availableMs = Math.min(timeoutMs, remainingMs);
    if (availableMs <= 0) throw error('EVAL_RUN_BUDGET');
    usedCalls++;
    onStart();
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(error('EVAL_TIMEOUT'));
        reject(error('EVAL_TIMEOUT'));
      }, availableMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(() => call({ ...options, signal: controller.signal })), deadline]);
    } catch (cause) {
      throw controller.signal.aborted ? error('EVAL_TIMEOUT') : Object.assign(error('EVAL_TRANSPORT'), { diagnostic: transportDiagnostic(cause) });
    } finally { clearTimeout(timer); }
  };
}

// Keep the app's verbose prompts and configuration out of eval logs. Only this
// separate, sequential CLI process is affected, never the running server.
async function quiet(operation) {
  const saved = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error'].map(key => [key, console[key]]));
  for (const key of Object.keys(saved)) console[key] = () => {};
  try { return await operation(); }
  finally { Object.assign(console, saved); }
}

export async function createApplicationAdapter({ maxCalls = 4, timeoutMs = 120000 } = {}) {
  const { default: service } = await quiet(() => import('../../routes/create/services/llmService.js'));
  const { reviewQuestionFeedback } = await import('../../routes/create/services/questionFeedbackReview.js');
  const { generateStudioActivity } = await import('../../routes/create/services/h5pStudioAIService.js');
  const { extractBalancedJson, getQuestionCompletionOptions } = await import('../../routes/create/utils/openAIRequestUtils.js');
  const config = service.getEnvLLMConfig();
  if (!config.model || !['openai', 'ollama'].includes(config.provider) || (config.provider === 'openai' && !config.apiKey)) throw error('EVAL_CONFIG');
  const budgetedCompletion = createCompletionBudget({ maxCalls, timeoutMs,
    call: options => service.streamCompletion({ ...options, llmConfig: config }) });
  return async (testCase, { remainingMs = timeoutMs } = {}) => quiet(async () => {
    let firstOutput = null;
    let finalOutput = null;
    const calls = [];
    let repairUsed = false;
    const deadline = performance.now() + remainingMs;
    const model = { provider: config.provider, requested: config.model, source: 'llmService.getEnvLLMConfig; environment credentials not persisted' };
    const complete = async (options, phase) => {
      const call = { phase, latencyMs: 0, model: config.model, outputTokenLimit: options.maxTokens,
        tokens: null, tokenSource: 'unavailable: application streamCompletion does not expose provider usage', outcome: 'started' };
      const start = performance.now();
      try {
        const response = await budgetedCompletion(options, { remainingMs: deadline - performance.now(), onStart: () => calls.push(call) });
        call.outcome = 'completed';
        call.model = response.model || config.model;
        // Only visible structured output for synthetic inputs, never provider
        // headers, request config, prompts, reasoning traces or raw errors.
        try { call.structuredOutput = parseJSON(response.content, extractBalancedJson); }
        catch { call.structuredOutput = null; }
        return response;
      } catch (cause) {
        call.outcome = 'error';
        call.diagnostic = cause.diagnostic || null;
        throw cause;
      } finally { call.latencyMs = Math.round(performance.now() - start); }
    };
    try {
      if (testCase.surface === 'studio') {
        const result = await generateStudioActivity({ ...testCase.request, complete: async options => {
          const response = await complete(options, calls.length ? 'structural-repair' : 'generation');
          if (calls.length === 1) {
            try { firstOutput = parseJSON(response.content, extractBalancedJson); } catch { /* The app may repair malformed first output. */ }
          }
          return response;
        } });
        finalOutput = { title: result.document.metadata.title, params: result.document.parameters };
        repairUsed = result.provenance.attempts > 1;
      } else {
        const request = testCase.request;
        const prompt = await service.buildExpertPrompt(request.learningObjective, request.questionType, request.relevantContent,
          'moderate', request.courseContext || '', request.previousQuestions || [], request.customPrompt,
          request.selectionMode, 2, 2, request.customPrompt);
        const completionOptions = getQuestionCompletionOptions(config.model, false);
        const response = await complete({ prompt, ...completionOptions, temperature: service.getTemperatureForQuestionType(request.questionType) }, 'generation');
        firstOutput = parseJSON(response.content, extractBalancedJson);
        const normalized = service.parseAndValidateResponse(response.content, request.questionType, request.selectionMode);
        finalOutput = await reviewQuestionFeedback(normalized, { questionType: request.questionType, relevantContent: request.relevantContent,
          instructorRequest: request.customPrompt, instructorContext: [request.learningObjective, request.courseContext, request.customPrompt].filter(Boolean).join('\n\n'),
          complete: options => complete(options, 'feedback-review') });
        const feedback = question => ({ explanation: question.explanation,
          options: question.content?.options?.map(option => ({ chosenFeedback: option.chosenFeedback, notChosenFeedback: option.notChosenFeedback })) });
        repairUsed = JSON.stringify(feedback(normalized)) !== JSON.stringify(feedback(finalOutput));
      }
      return { firstOutput, finalOutput, calls, model, repairUsed, outcome: 'completed', simulated: false };
    } catch (cause) {
      // Review wraps transport/budget errors; preserve the operational reason.
      return { firstOutput, finalOutput: null, calls, model, repairUsed, outcome: 'blocked', ...adapterFailure(cause), simulated: false };
    }
  });
}
