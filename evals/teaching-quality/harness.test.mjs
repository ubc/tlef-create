import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cases } from './corpus.mjs';
import { gradeCase } from './grade.mjs';
import { createMockAdapter, markdownReport, regradeReport, runEvaluation, safeErrorCode, teacherReviewCSV, validateRunOptions } from './runner.mjs';
import { adapterFailure, createCompletionBudget, transportDiagnostic } from './application-adapter.mjs';

for (const testCase of cases) {
  test(`${testCase.id}: independently authored reference satisfies its contract`, () => {
    const result = gradeCase(testCase, testCase.gold);
    assert.equal(result.passed, true, JSON.stringify(result.checks.filter(item => !item.passed)));
    assert.equal(result.teacherReview.status, 'pending');
    assert.equal(result.teacherReview.score, null);
  });
  for (const counterexample of testCase.counterexamples) test(`${testCase.id}: detects ${counterexample.id}`, () => {
    const result = gradeCase(testCase, counterexample.output);
    assert.equal(result.passed, false);
    for (const id of counterexample.fails) assert.equal(result.checks.find(check => check.id === id)?.passed, false, `Expected ${id} to catch this counterexample`);
  });
}

test('a corrupted answer remains wrong even if an AI review label claims success', () => {
  const testCase = cases.find(item => item.id === 'arithmetic-feedback');
  const output = structuredClone(testCase.counterexamples[0].output);
  output.qualityReview = 'ai-feedback-reviewed';
  assert.equal(gradeCase(testCase, output).passed, false);
});

test('raw production MCQ options and normalized content use the same ground truth', () => {
  const testCase = cases.find(item => item.id === 'mcq-single');
  const output = { ...testCase.gold, options: testCase.gold.content.options };
  delete output.content;
  assert.equal(gradeCase(testCase, output).passed, true);
});

test('missing outputs are failures rather than vacuous passes', () => {
  for (const testCase of cases) assert.equal(gradeCase(testCase, null).passed, false);
});

test('mock repairs retain failing first-pass evidence, separate from the final result', async () => {
  const report = await runEvaluation({ cases, adapter: createMockAdapter('repair'), mode: 'mock' });
  assert.deepEqual(report.summary.firstPass, { passed: 0, evaluated: cases.length });
  assert.deepEqual(report.summary.final, { passed: cases.length, evaluated: cases.length });
  assert.equal(report.summary.repaired, cases.length);
  assert.equal(report.summary.logicalModelCalls, 0);
  assert.equal(report.summary.teacherReviewed, 0);
  assert.match(markdownReport(report), /not evidence of model quality/);
  assert.match(teacherReviewCSV(report), /score_0_2/);
  assert.ok(report.results.every(item => item.calls.every(call => call.tokens === null)));
});

test('bounded repetition is explicit and retains separate per-run observations', async () => {
  const report = await runEvaluation({ cases: cases.slice(0, 1), adapter: createMockAdapter(), repetitions: 3 });
  assert.deepEqual(report.results.map(item => item.repetition), [1, 2, 3]);
  const base = { mode: 'live', repetitions: 1, maxCalls: 4, timeoutMs: 120000, maxRunMs: 600000 };
  for (const invalid of [{ repetitions: 0 }, { repetitions: 4 }, { maxCalls: 17 }, { maxCalls: -1 }, { timeoutMs: Infinity }, { maxRunMs: 600001 }]) {
    assert.throws(() => validateRunOptions({ ...base, ...invalid }));
  }
});

test('adapter/provider errors never include raw message, configuration, or secrets in reports', async () => {
  const secret = 'unit-test-secret-that-must-not-be-logged';
  const report = await runEvaluation({ cases: cases.slice(0, 1), adapter: async () => { throw Object.assign(new Error(secret), { headers: { authorization: secret } }); } });
  assert.equal(report.summary.final.evaluated, 0);
  assert.equal(report.summary.blockedOrErrored, 1);
  assert.equal(report.results[0].errorCode, 'EVAL_ADAPTER_ERROR');
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.equal(safeErrorCode({ code: secret }), 'EVAL_ADAPTER_ERROR');
});

test('non-synthetic evaluation inputs are refused before invoking an adapter', async () => {
  let called = false;
  await assert.rejects(runEvaluation({ cases: [{ ...cases[0], synthetic: false }], adapter: () => { called = true; } }), /synthetic/);
  assert.equal(called, false);
});

test('the live completion budget prevents a second call, not merely an extra report row', async () => {
  let calls = 0;
  const complete = createCompletionBudget({ maxCalls: 1, timeoutMs: 1000, call: async () => { calls++; return { content: '{}' }; } });
  await complete({});
  await assert.rejects(complete({}), { code: 'EVAL_CALL_BUDGET' });
  assert.equal(calls, 1);
});

test('timeout aborts the model request, returns promptly, and prevents new requests', async () => {
  let signal;
  let calls = 0;
  const complete = createCompletionBudget({ maxCalls: 2, timeoutMs: 5, call: options => {
    calls++;
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(complete({}), { code: 'EVAL_TIMEOUT' });
  assert.equal(signal.aborted, true);
  await assert.rejects(complete({}), { code: 'EVAL_TIMEOUT' });
  assert.equal(calls, 1);
});

test('expired total run budget blocks the model before any request', async () => {
  let called = false;
  const complete = createCompletionBudget({ maxCalls: 1, timeoutMs: 1000, call: () => { called = true; } });
  await assert.rejects(complete({}, { remainingMs: 0 }), { code: 'EVAL_RUN_BUDGET' });
  assert.equal(called, false);
});

test('transport diagnostics allow only numeric HTTP status and recognized network codes', () => {
  assert.deepEqual(transportDiagnostic({ status: 503, message: 'secret', cause: { code: 'ECONNRESET', headers: { authorization: 'secret' } } }), { httpStatus: 503, networkCode: 'ECONNRESET' });
  assert.deepEqual(transportDiagnostic({ status: 'secret', code: 'secret' }), { httpStatus: null, networkCode: null });
});

test('the live-discovered adding-eight rationale is false for option 20 but valid for option 17', () => {
  const testCase = cases.find(item => item.id === 'arithmetic-feedback');
  const output = structuredClone(testCase.gold);
  output.content.options[1].chosenFeedback = 'This would be the result if you added 8 tokens instead of 5 before removing 3.';
  assert.equal(gradeCase(testCase, output).checks.find(check => check.id === 'facts.distractor-calculation').passed, false);
  output.content.options[1].chosenFeedback = 'This would be the result if you used 12 + 11 before subtracting 3.';
  assert.equal(gradeCase(testCase, output).checks.find(check => check.id === 'facts.distractor-calculation').passed, true);
  output.content.options[1].chosenFeedback = testCase.gold.content.options[1].chosenFeedback;
  output.content.options[3].chosenFeedback = 'This would be the result if you used 12 + 8 before subtracting 3.';
  assert.equal(gradeCase(testCase, output).checks.find(check => check.id === 'facts.distractor-calculation').passed, true);
});

test('offline regrading preserves generation metrics and the original report', async () => {
  const original = await runEvaluation({ cases: cases.slice(0, 1), adapter: createMockAdapter() });
  const serialized = JSON.stringify(original);
  const revised = regradeReport(original, cases);
  assert.equal(revised.regrade.newLogicalModelCalls, 0);
  assert.equal(revised.startedAt, original.startedAt);
  assert.equal(revised.summary.latencyMs, original.summary.latencyMs);
  assert.equal(revised.results[0].latencyMs, original.results[0].latencyMs);
  assert.equal(JSON.stringify(original), serialized);
});

test('quality errors retain their category even when their cause is an ordinary Error', () => {
  const cause = Object.assign(new Error('private details not copied'), {
    code: 'QUESTION_QUALITY_REVIEW', qualityCheck: 'arithmetic', qualityFailureReason: 'ARITHMETIC_FALSE_EQUALITY', cause: new Error('private calculation')
  });
  assert.deepEqual(adapterFailure(cause), { errorCode: 'QUESTION_QUALITY_REVIEW', qualityCheck: 'arithmetic', qualityFailureReason: 'ARITHMETIC_FALSE_EQUALITY' });
  assert.equal(adapterFailure({ code: 'QUESTION_QUALITY_REVIEW', cause: { code: 'EVAL_CALL_BUDGET' } }).errorCode, 'EVAL_CALL_BUDGET');
});
