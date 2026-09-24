import { createHash } from 'node:crypto';
import { gradeCase } from './grade.mjs';
import { corpusVersion } from './corpus.mjs';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function validateRunOptions(options) {
  if (!['mock', 'live'].includes(options.mode)) throw new Error('mode must be mock or live');
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1 || options.repetitions > 3) throw new Error('repetitions must be 1–3');
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 16) throw new Error('max-calls must be 1–16');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120000) throw new Error('timeout-ms must be 1000–120000');
  if (!Number.isInteger(options.maxRunMs) || options.maxRunMs < 1000 || options.maxRunMs > 600000) throw new Error('max-run-ms must be 1000–600000');
  return options;
}

export function createMockAdapter(fixture = 'gold') {
  if (!['gold', 'counterexample', 'repair'].includes(fixture)) throw new Error('fixture must be gold, counterexample or repair');
  return async testCase => {
    const bad = testCase.counterexamples[0].output;
    const first = fixture === 'gold' ? testCase.gold : bad;
    return { firstOutput: structuredClone(first), finalOutput: structuredClone(fixture === 'counterexample' ? bad : testCase.gold),
      outcome: 'completed', calls: [{ phase: 'generation', latencyMs: 0, outputTokenLimit: null, tokens: null, tokenSource: 'mock: no model used', model: 'mock-fixture' },
        ...(fixture === 'repair' ? [{ phase: 'structural-repair', latencyMs: 0, outputTokenLimit: null, tokens: null, tokenSource: 'mock: no model used', model: 'mock-fixture' }] : [])],
      model: { provider: 'mock', requested: 'mock-fixture', source: 'synthetic fixture; no live model' }, repairUsed: fixture === 'repair', simulated: true };
  };
}

const allowedErrors = new Set(['QUESTION_QUALITY_REVIEW', 'H5P_AI_INVALID', 'EVAL_CALL_BUDGET', 'EVAL_TIMEOUT', 'EVAL_RUN_BUDGET', 'EVAL_TRANSPORT', 'EVAL_PARSE', 'EVAL_CONFIG']);
export function safeErrorCode(error) { return allowedErrors.has(error?.code) ? error.code : 'EVAL_ADAPTER_ERROR'; }

export async function runEvaluation({ cases, adapter, mode = 'mock', repetitions = 1, maxCalls = 4, timeoutMs = 120000, maxRunMs = 600000, provenance = {} }) {
  validateRunOptions({ mode, repetitions, maxCalls, timeoutMs, maxRunMs });
  if (!cases.length || cases.some(testCase => testCase.synthetic !== true)) throw new Error('Only the explicitly synthetic corpus may be evaluated.');
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const results = [];
  for (const testCase of cases) {
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      const attemptStart = performance.now();
      let generated;
      if (attemptStart - start >= maxRunMs) generated = { outcome: 'skipped', errorCode: 'EVAL_RUN_BUDGET', calls: [] };
      else {
        try { generated = await adapter(testCase, { remainingMs: maxRunMs - (attemptStart - start) }); }
        catch (error) { generated = { outcome: 'error', errorCode: safeErrorCode(error), calls: [] }; }
      }
      const firstPass = generated.firstOutput ? gradeCase(testCase, generated.firstOutput) : null;
      const final = generated.finalOutput ? gradeCase(testCase, generated.finalOutput) : null;
      // Persist an allowlist, never arbitrary adapter configuration or Error objects.
      results.push({ caseId: testCase.id, title: testCase.title, surface: testCase.surface, repetition,
        outcome: generated.outcome || 'completed', errorCode: generated.errorCode || null,
        qualityCheck: generated.qualityCheck === 'arithmetic' ? 'arithmetic' : null,
        qualityFailureReason: generated.qualityFailureReason || null,
        simulated: generated.simulated === true, model: generated.model || null,
        latencyMs: generated.simulated ? 0 : Math.round(performance.now() - attemptStart),
        calls: (generated.calls || []).map(call => ({ phase: call.phase, latencyMs: call.latencyMs,
          outputTokenLimit: call.outputTokenLimit ?? null, tokens: call.tokens ?? null,
          tokenSource: call.tokenSource || 'unavailable', model: call.model || null, outcome: call.outcome || 'completed',
          diagnostic: call.diagnostic ? { httpStatus: call.diagnostic.httpStatus ?? null, networkCode: call.diagnostic.networkCode ?? null } : null,
          structuredOutput: call.structuredOutput || null })),
        repairUsed: generated.repairUsed === true, firstPass, final,
        firstOutput: generated.firstOutput || null, finalOutput: generated.finalOutput || null,
        teacherReview: { status: 'pending', score: null, rubric: testCase.teacherRubric } });
    }
  }
  const finalChecked = results.filter(result => result.final);
  const firstChecked = results.filter(result => result.firstPass);
  return { schemaVersion: 1, corpusVersion, corpusHash: hash(cases), startedAt, mode,
    limits: { repetitions, maxCalls, timeoutMs, maxRunMs }, provenance,
    notice: mode === 'mock' ? 'Harness validation only. These results are not evidence of model quality.' : 'A small synthetic sample is not a teaching-quality guarantee. Teacher review remains pending.',
    summary: { requested: results.length, completed: results.filter(result => result.outcome === 'completed').length,
      blockedOrErrored: results.filter(result => result.outcome !== 'completed').length,
      firstPass: { passed: firstChecked.filter(result => result.firstPass.passed).length, evaluated: firstChecked.length },
      final: { passed: finalChecked.filter(result => result.final.passed).length, evaluated: finalChecked.length },
      repaired: results.filter(result => result.repairUsed).length,
      teacherReviewed: 0, latencyMs: Math.round(performance.now() - start), logicalModelCalls: mode === 'mock' ? 0 : results.reduce((sum, result) => sum + result.calls.length, 0) }, results };
}

export function markdownReport(report) {
  const lines = ['# CREATE teaching-quality evaluation', '', report.notice, '',
    `Corpus: ${report.corpusVersion} · Mode: ${report.mode} · Started: ${report.startedAt}`, '',
    `First pass: ${report.summary.firstPass.passed}/${report.summary.firstPass.evaluated} evaluated. Final: ${report.summary.final.passed}/${report.summary.final.evaluated} evaluated. Blocked/errors: ${report.summary.blockedOrErrored}. Repairs: ${report.summary.repaired}. Teacher reviews: 0.`, '',
    '| Case / repetition | First pass | Final | Outcome | Repair | Latency ms | Calls |', '|---|---:|---:|---|---|---:|---:|'];
  for (const result of report.results) lines.push(`| ${result.caseId} / ${result.repetition} | ${result.firstPass ? result.firstPass.passed ? 'pass' : 'fail' : 'unavailable'} | ${result.final ? result.final.passed ? 'pass' : 'fail' : 'unavailable'} | ${result.errorCode || result.outcome} | ${result.repairUsed ? 'yes' : 'no'} | ${result.latencyMs} | ${result.simulated ? 0 : result.calls.length} |`);
  lines.push('', '## Failed deterministic checks', '');
  let failures = 0;
  for (const result of report.results) for (const stage of ['firstPass', 'final']) for (const check of result[stage]?.checks || []) {
    if (!check.passed) { failures++; lines.push(`- ${result.caseId} / ${result.repetition} / ${stage}: ${check.id} — ${check.detail}`); }
  }
  if (!failures) lines.push('None in available outputs. Missing or blocked outputs are listed above, never counted as passes.');
  lines.push('', '## Interpretation limits', '',
    '- Engineering checks verify requested structure, not rendered layout or export interoperability.',
    '- Deterministic checks use fixed synthetic facts, answer keys, and explicit text contracts. Topic/citation keyword checks do not prove semantic correctness or entailment.',
    '- Teacher rubric scores are blank until a human reviews the saved outputs. Application AI feedback review is a product step, not a trusted ground-truth judge.',
    '- Token usage is null when the production completion boundary does not expose provider usage. Requested output limits are budgets, not measured tokens.',
    '- Each live call records the app-configured model; the current streaming boundary may echo the requested model rather than a provider snapshot ID.',
    '- This evaluates native Studio authoring and question prompt/parse/feedback components, not authentication, retrieval, database persistence, novelty reservation, browser display, or app job recovery.',
    '- Human rubric: see teacher-review.csv; raw synthetic outputs and phase metrics: report.json.', '');
  return lines.join('\n');
}

export function teacherReviewCSV(report) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['case_id', 'repetition', 'criterion', 'score_0_2', 'reviewer', 'rationale']];
  for (const result of report.results) for (const criterion of result.teacherReview.rubric) rows.push([result.caseId, result.repetition, criterion.id, '', '', '']);
  return rows.map(row => row.map(quote).join(',')).join('\n') + '\n';
}

export function regradeReport(original, cases) {
  const report = structuredClone(original);
  report.mode = `${original.mode.replace(/-regrade$/, '')}-regrade`;
  report.regrade = { evaluatedAt: new Date().toISOString(), sourceReportHash: hash(original),
    originalCorpusVersion: original.corpusVersion, originalCorpusHash: original.corpusHash,
    corpusVersion, corpusHash: hash(cases), newLogicalModelCalls: 0 };
  report.results = report.results.map(result => {
    const testCase = cases.find(item => item.id === result.caseId);
    if (!testCase || !testCase.synthetic) throw new Error('Saved output does not belong to the synthetic corpus.');
    return { ...result, firstPass: result.firstOutput ? gradeCase(testCase, result.firstOutput) : null,
      final: result.finalOutput ? gradeCase(testCase, result.finalOutput) : null };
  });
  for (const stage of ['firstPass', 'final']) {
    const evaluated = report.results.filter(result => result[stage]);
    report.summary[stage] = { passed: evaluated.filter(result => result[stage].passed).length, evaluated: evaluated.length };
  }
  report.notice += ' Saved outputs were regraded offline; original generation timestamps, model-call counts and latencies are preserved. No new model call was made.';
  return report;
}
