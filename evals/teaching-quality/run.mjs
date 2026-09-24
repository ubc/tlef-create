#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './corpus.mjs';
import { createMockAdapter, hash, markdownReport, runEvaluation, teacherReviewCSV, validateRunOptions } from './runner.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const values = { mode: 'mock', fixture: 'gold', repetitions: 1, maxCalls: 4, timeoutMs: 120000, maxRunMs: 600000 };
const names = { '--mode': 'mode', '--fixture': 'fixture', '--repetitions': 'repetitions', '--max-calls': 'maxCalls', '--timeout-ms': 'timeoutMs', '--max-run-ms': 'maxRunMs', '--cases': 'caseIds', '--out': 'out' };
const numbers = new Set(['repetitions', 'maxCalls', 'timeoutMs', 'maxRunMs']);
try {
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--help') {
      console.log('node evals/teaching-quality/run.mjs [--live] [--cases id,id] [--repetitions 1..3] [--max-calls 1..16] [--fixture gold|counterexample|repair] [--out directory]\nDefault: mock gold; no model, credentials, database, or network. Live defaults to cold-glass-request and arithmetic-feedback, with 4 logical calls total.');
      process.exit(0);
    }
    if (argv[index] === '--live') { values.mode = 'live'; continue; }
    const key = names[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Unknown option or missing value; use --help.');
    const value = argv[++index];
    values[key] = numbers.has(key) ? Number(value) : value;
  }
  validateRunOptions(values);
  const ids = values.caseIds?.split(',') || (values.mode === 'live' ? ['cold-glass-request', 'arithmetic-feedback'] : cases.map(item => item.id));
  if (new Set(ids).size !== ids.length || ids.some(id => !cases.some(item => item.id === id))) throw new Error('Unknown or duplicate case ID.');
  const selected = ids.map(id => cases.find(item => item.id === id));
  if (values.mode === 'live' && values.fixture !== 'gold') throw new Error('Fixtures are available only in mock mode.');
  const out = resolve(values.out || `artifacts/teaching-quality-${new Date().toISOString().slice(0, 10)}/${values.mode}-${values.fixture}`);
  let adapter;
  if (values.mode === 'live') {
    // Load the same app environment only after explicit live opt-in. Never print it.
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: resolve(projectRoot, '.env'), quiet: true });
    const { createApplicationAdapter } = await import('./application-adapter.mjs');
    adapter = await createApplicationAdapter(values);
  } else adapter = createMockAdapter(values.fixture);
  const codeFiles = ['evals/teaching-quality/corpus.mjs', 'evals/teaching-quality/grade.mjs', 'evals/teaching-quality/runner.mjs', 'evals/teaching-quality/application-adapter.mjs',
    'routes/create/services/llmService.js', 'routes/create/services/questionFeedbackReview.js', 'routes/create/services/h5pStudioAIService.js'];
  const codeHashes = Object.fromEntries(await Promise.all(codeFiles.map(async file => [file, hash(await readFile(resolve(projectRoot, file), 'utf8'))])));
  const report = await runEvaluation({ ...values, cases: selected, adapter, provenance: { node: process.version, codeHashes,
    liveTransport: 'Application completion boundary; provider SDK retries may occur inside one logical call. No harness retry.',
    modelSource: values.mode === 'live' ? 'Application environment; no override' : 'No model used' } });
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'),
    writeFile(resolve(out, 'report.md'), markdownReport(report)),
    writeFile(resolve(out, 'teacher-review.csv'), teacherReviewCSV(report))
  ]);
  console.log(JSON.stringify({ mode: report.mode, outputDirectory: out, ...report.summary }, null, 2));
  if (report.summary.blockedOrErrored || report.summary.final.passed !== report.summary.requested) process.exitCode = 1;
} catch (error) {
  // Provider errors may include URLs or headers. Do not persist their messages.
  console.error(values.mode === 'live' ? 'Live evaluation could not start. Check application configuration and the documented limits; no credentials were logged.' : error.message);
  process.exitCode = 1;
}
