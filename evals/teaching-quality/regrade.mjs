#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cases } from './corpus.mjs';
import { hash, markdownReport, regradeReport, teacherReviewCSV } from './runner.mjs';

try {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node evals/teaching-quality/regrade.mjs input-report.json output-directory');
  const original = JSON.parse(await readFile(resolve(input), 'utf8'));
  const report = regradeReport(original, cases);
  report.regrade.graderHash = hash(await readFile(new URL('./grade.mjs', import.meta.url), 'utf8'));
  const out = resolve(output);
  if (resolve(input) === resolve(out, 'report.json')) throw new Error('Choose a new directory to preserve the original report.');
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'),
    writeFile(resolve(out, 'report.md'), markdownReport(report)),
    writeFile(resolve(out, 'teacher-review.csv'), teacherReviewCSV(report))
  ]);
  console.log(JSON.stringify({ outputDirectory: out, newLogicalModelCalls: 0, summary: report.summary }, null, 2));
  if (report.summary.final.passed !== report.summary.requested) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
