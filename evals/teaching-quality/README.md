# Fixed teaching-quality evaluation

This versioned seven-case corpus uses only invented teaching material. It does not load course records, uploaded files, credentials into reports, or student answers. It evaluates current application components without changing model settings or saving any learning object.

## What is measured

| Layer | Examples | Meaning |
|---|---|---|
| Engineering | Native Documentation pages, response input, export page; MCQ answer mode and feedback fields | Fixed structural contract passed; browser appearance and exported packages require separate QA |
| Deterministic facts | Independently authored answer keys, 12 + 5 − 3 = 14, fictional upward gravity, explicit scenario exclusions, supplied S1 citation | Known synthetic contract passed; text matching is deliberately limited and does not establish general semantic truth |
| Teacher rubric | Alignment, clarity, useful reasoning, grounding | Initially pending. Human reviewer scores 0–2 with rationale in `teacher-review.csv` |

The application’s existing AI feedback review is an evaluated product step, **not an evaluation judge or ground truth**. A draft with a wrong known answer fails even if it says `ai-feedback-reviewed`. Every case has reference output, explicit expectations and at least one targeted negative example.

Cases: `documentation-three-step`, `mcq-single`, `mcq-multiple`, `arithmetic-feedback`, `hypothetical-premise`, `cold-glass-request`, `source-grounding`. Option wording is intentionally fixed by the test instructions to allow exact answer-key checking. Do not interpret this as a test of unrestricted creative authoring.

## Run without a model

From the repository root:

```sh
node --test evals/teaching-quality/harness.test.mjs
node evals/teaching-quality/run.mjs
node evals/teaching-quality/run.mjs --fixture repair
node evals/teaching-quality/run.mjs --fixture counterexample
```

The default mock run loads no environment file, imports no application LLM service, makes no network calls and consumes no model tokens. Its pass rate only verifies the harness. The counterexample run intentionally exits with status 1 because its outputs should fail. The repair fixture demonstrates separate first-pass failures and final passes; it is simulated, not evidence that the app repairs those defects.

## Opt-in live runs

Coordinate with anyone running live QA before starting. This script is outside the backend watcher, but application code changes can make comparisons invalid. The runner records SHA-256 fingerprints of the relevant source files.

```sh
node evals/teaching-quality/run.mjs --live
node evals/teaching-quality/run.mjs --live --cases cold-glass-request --repetitions 2 --max-calls 4 --out artifacts/teaching-quality-live-repeats
node evals/teaching-quality/run.mjs --live --cases documentation-three-step,mcq-single,mcq-multiple,arithmetic-feedback,hypothetical-premise,cold-glass-request,source-grounding --max-calls 16 --out artifacts/teaching-quality-live-full
```

Live mode explicitly reads the app `.env` using its existing environment-key configuration. The adapter calls `llmService.getEnvLLMConfig()` and does not choose or override a model. It does not query per-user keys or impersonate a user. The current default is two cases (cold glass and arithmetic), one repetition each, with four **logical completion calls** total. A MCQ usually uses one generation and one product feedback review. Documentation can use one generation plus at most one existing structural repair. The provider SDK may retry transport internally; the count is not a claim about billable HTTP attempts.

Limits are checked before work: 1–3 repetitions, 1–16 logical calls per run, at most 120 seconds per completion and 10 minutes per run. The adapter performs no fallback regeneration. Once the call budget is exhausted, remaining cases are reported blocked rather than passing. A full seven-case baseline normally needs 13 calls, or 14 if Documentation repairs once; even then it is only a tiny smoke sample. Use explicit run directories to avoid replacing a previous report.

The isolated adapter reuses production Studio generation/normalization and question prompt building/parsing/feedback review. It supplies fixed synthetic evidence directly. It does **not** exercise authentication, retrieval quality, question-memory reservation, database writes, end-to-end job retry or H5P browser rendering. Raw initial model JSON is graded as the first pass. The final normalized/reviewed result is separately graded. A completed feedback review that revises text is recorded as a repair even if the first pass already satisfied all deterministic checks; this is not necessarily a recovered error.

## Reports and interpreting results

Outputs are `report.json` (synthetic outputs and metrics), `report.md` (summary), and `teacher-review.csv` (blank reviewer worksheet). The report records case/repetition, first-pass/final checks, blocked outcomes, review/repair stages, latency, configured model source, corpus hash and code hashes. JSON retains all synthetic text so teachers can inspect what was actually produced.

Token usage is `null` with an explicit reason because the current production `streamCompletion` result does not expose provider usage. Requested token ceilings are shown separately and must never be presented as measured consumption. The returned model name may echo configuration rather than identify an actual provider snapshot. Mock latency is explicitly zero/simulated; live latency is wall-clock time.

Teacher review has no automatic overall score. For a meaningful model comparison, use the same corpus and source hashes, repeat each case, blind the outputs if practical, have instructors independently score them, resolve disagreements, and retain both first-pass and final results. A small pass rate or a better model name alone does not prove teaching quality. Do not use an AI-authored rubric score as a replacement for independent validation.

The first live smoke run exposed a grader blind spot: a distractor claiming that adding 8 to 12 and then removing 3 produces 20. Corpus/grader version 1.0.1 adds that specific family of independently calculable negative cases. This post-run change must remain visible; it is not a preregistered pass-rate comparison. Preserve the initial report and regrade its saved synthetic outputs without another paid call:

```sh
node evals/teaching-quality/regrade.mjs artifacts/teaching-quality-2026-09-20/live-retry/report.json artifacts/teaching-quality-2026-09-20/live-retry-regraded
```

Regrading writes a new directory, retains original latency/model-call observations, and records old/new corpus hashes plus zero new calls. General natural-language distractor reasoning still needs teacher review, even when all supported equation patterns pass.

After the live-discovered error, the production feedback review contract now declares bounded arithmetic expressions separately. The application verifies these with `arithmeticVerification.js` and renders checked equations. A malformed declaration, unsupported expression, division by zero and false equality are different rejection reasons; empty declarations do not establish mathematical correctness. The evaluation adapter records those safe codes and visible structured review output for synthetic cases. It never records raw provider errors, credentials, HTTP headers or hidden reasoning.

The dated summary at `artifacts/teaching-quality-2026-09-20/summary.md` documents the initial grader blind spot and one post-fix live run whose exact local rejection cause was not retained. That result must not be represented as proof of a particular arithmetic error being caught. The new error diagnostics have deterministic regression coverage; no further blind model retry was used to replace the missing evidence.

All seven cases now have at least one live observation in that dated summary, across the documented fix stages. The final five-case run used nine logical calls: four cases satisfied the bounded checks, while the source case retained correct supplied facts but omitted the explicitly requested bracketed `[S1]` marker. Treat that as a citation-format failure, not proof of fabricated facts. Human review also needs to catch answer-revealing stems and misleading scientific wording that deterministic checks do not cover. A later offline replay of its captured review verified removal of redundant constant identities such as `5 = 5`; it made zero model calls.
