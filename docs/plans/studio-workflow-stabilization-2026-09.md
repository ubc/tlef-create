# Guided workflow and native Studio stabilization

## Scope

This pass covers three priorities: the guided Quiz authoring journey, installed
native H5P type acceptance, and Studio generation recovery/source boundaries.
The existing white background / black primary-button design is unchanged.

## Delivered behavior

1. Browser acceptance covers material ingestion, assignment, objective generation,
   ASSESS + Question Set selection, AI Blueprint, question generation, return to
   configuration, refresh, review, native preview and package export.
2. Native type acceptance exercises deterministic AI output through the actual
   Studio schema validator and Lumi persistence, then import, official editing,
   save/preview, download and reimport. Media fixtures are copied from an isolated
   template which is deleted before export. Media, JSON group shape, optional
   fields, nested editor initialization and early Save availability were fixed.
3. Mongo-backed Studio generation receipts support refresh/disconnect recovery.
   A unique owner/request ID prevents replay; a unique running-owner index prevents
   simultaneous generation across app instances. A two-minute renewable lease
   detects lost workers; a fifteen-minute ceiling prevents indefinitely running
   receipts. Expired workers are fenced before/after draft persistence.
4. Restart recovery reports interruption; it does **not** automatically replay
   a paid AI request. Poll failures offer Check generation status. Receipt IDs
   live in the same tab's sessionStorage; receipts expire after seven days.
5. Studio shows an independent-draft notice and checks the source Quiz fingerprint.
   It distinguishes current, changed, unavailable and unknown source versions.
   Editing a Studio draft never synchronizes back into Quiz questions/objectives.
   Ownership is checked independently for the draft, receipt and source Quiz.

## Operational constraints

- Mongo indexes must be created successfully; the service waits for them before
  accepting generation. All replicas need shared H5P content/temp storage via
  `H5P_STORAGE_ROOT`, as well as the same reviewed vendored libraries.
- Receipts are metadata, not a queue containing teaching instructions. Server
  restart cannot resume a provider stream. A provider call already in flight may
  still consume tokens even when a receipt expires; CREATE prevents its late
  persistence and does not silently start another call.
- If persistence succeeds just before a receipt update loses database access,
  the activity may appear in Your content while the receipt becomes interrupted.
  The recovery copy explicitly asks users to check existing content first.
- Existing malformed drafts are not mass-migrated or deleted. Regenerate from a
  valid source/template when an old draft used an incorrect native JSON shape.

## Repeatable verification

Stop local services on 8051/8092 before running Playwright. Its launcher starts
its own API and production frontend, uses the E2E database, separate embedding
collection and temporary H5P storage, and supplies fixed local model responses.
It never needs a paid model call. Local MongoDB/Qdrant and ffmpeg are required.

```sh
npx playwright test --workers=1
npm test -- --run src/components/h5p/StudioAIComposer.test.tsx src/pages/H5PStudio.test.tsx src/utils/h5pEditorReady.test.ts
```

For backend tests, do **not** use the legacy global integration setup against
local instructor data. Override setup explicitly:

```sh
cd routes/create
NODE_OPTIONS=--experimental-vm-modules npx jest \
  --config '{"testEnvironment":"node","transform":{},"setupFilesAfterEnv":[]}' \
  --runInBand __tests__/unit/h5pStudioAI.test.js \
  __tests__/unit/h5pStudioRoutes.test.js \
  __tests__/unit/h5pEditorRuntimeAssets.test.js \
  __tests__/unit/helpKnowledgeService.test.js \
  __tests__/integration/studioJobRecovery.test.js
```

The receipt integration test allocates and drops only its own UUID-named local
database. It tests independent service instances, duplicate IDs, owner isolation,
lease loss, maximum runtime, quota and failure-message privacy.

## Acceptance boundaries

### Verification result (September 16, 2026)

- Complete browser suite: **39 passed, 3 explicitly skipped** (includes auth
  setup). The 34 locally testable native types all passed.
- Related frontend suites: **27 passed** across seven files.
- Backend H5P/help/recovery regression: **144 passed** across twelve suites;
  runtime-asset/help tests were also rerun after the asset revision change.
- Production frontend build and whitespace/diff checks passed.
- Full TypeScript checking is not clean: the unchanged HEAD baseline itself
  reports 6,126 diagnostics with the current installed compiler/types, primarily
  missing JSX intrinsic element typing. The baseline was checked through a
  read-only compiler host, not by resetting the working tree. This separate
  repository-wide typing/toolchain issue is not represented as passing.

Synthetic responses verify engineering contracts, not teaching accuracy or live
model reliability. The local matrix does not certify every nested combination,
accessibility conformance, or external LMS acceptance. Branching Scenario remains
gated by installed runtime requirements. Iframe Embedder and Twitter User Feed
require separately authorized third-party acceptance and are explicitly skipped.
No deployment or push is part of this pass.

### Live-model follow-up (September 16, 2026)

Three synthetic activities were generated through the production completion and
Studio validation services using the configured `gpt-5-nano`: Chart and Multiple
Choice validated on attempt one; Question Set validated on attempt two. All three
were persisted in isolated temporary Lumi storage and exported with valid ZIP
integrity, the expected main library and parseable content JSON. No instructor
course data was used or changed.

Manual content inspection found pedagogical defects despite valid JSON: a question
stem revealed its answer, score-independent feedback praised incorrect responses,
and an explanation introduced an inaccurate astronomy claim. The authoring prompt
now explicitly requires genuine assessment tasks, unambiguous distractors,
grounded explanations, action-aware answer feedback and neutral full-range score
feedback. A regression test protects these instructions; prompt constraints do
not constitute factual validation, and instructor review remains necessary.
One subsequent live Question Set sample validated after one repair. Its two stems
were actual questions and full-range feedback was neutral. Some answer feedback
remained generic and hints sometimes gave away the answer, so this small sample
is evidence of improvement, not certification of pedagogical quality. The focused
Studio AI regression suite passed all 17 tests.

The independent Lumi desktop control connection timed out. Export ZIP validation
is not a substitute for opening and answering these live samples in an independent
host. External-host acceptance remains outstanding.
