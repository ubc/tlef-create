# AGENTS.md — TLEF-CREATE

Read this file before changing the repository. It records the current product
and code architecture, including active feature work that is newer than the
README. Prefer the running code and the canonical files named below when older
planning documents disagree.

## What this project is

TLEF-CREATE is an instructor-facing application that turns course materials
into grounded learning objectives, an editable AI quiz blueprint, generated
questions, evidence/coverage views, and deployable learning objects.

The repository contains both sides of the application:

- React 18 + TypeScript + Vite frontend in `src/`
- Node.js + Express + Mongoose backend in `server.js` and `routes/create/`

The UI increasingly uses **Learning Object** for the artifact an instructor is
building. Backend models, API paths, Redux slices, and older documents still use
`Quiz`. Treat those as the same domain object unless a file explicitly refers to
an H5P Question Set container.

This repository is not BiocBot. CREATE Guide is the product-help assistant in
this app; it is separate from course-material question answering products.

## Current product workflow

An instructor creates a course (`Folder` in the backend), adds course materials,
creates a learning object (`Quiz`), and works through five tabs:

1. **Materials** — assign processed course materials to the learning object.
2. **Learning Objectives** — generate from materials, import/paste, add manually,
   edit, regenerate, or enrich objectives with subpoints and evidence.
3. **Generate Questions** — choose delivery target and format, generate or edit
   an AI Blueprint, then stream question generation.
4. **Review & Edit** — inspect, edit, regenerate, add, reorder, preview, and
   export questions.
5. **Coverage Map** — inspect material → evidence → objective → subpoint →
   question relationships in graph or list form.

`src/components/QuizView.tsx` owns the tab workflow and URL `?tab=` behavior.
Tabs stay mounted where noted, so state and side effects can remain active while
another tab is visible.

## Architecture map

```text
src/
  App.tsx                         Protected client routes and auth state
  components/                    Product pages and workflow UI
  components/generation/         Blueprint and question-generation UI
  components/review/             Review, editing, evidence, and export UI
  components/help/CreateGuide.tsx
                                  Global read-only help chat widget
  constants/questionTypeCapabilities.ts
                                  Canonical delivery/format/type matrix
  services/api.ts                Typed frontend API boundary
  store/                         Redux Toolkit slices and selectors
  hooks/useSSE.ts                Shared generation-workflow streaming client

server.js                        Express entry point, sessions, Passport, startup
routes/create/
  createRoutes.js                `/api/create` router and controller mounts
  controllers/                   HTTP validation, ownership, response handling
  services/                      AI, RAG, planning, export, jobs, and domain logic
  models/                        Mongoose schemas
  middleware/                    Auth, validation, rate limits, and audit capture
  utils/                         Shared backend utilities
  h5p-libs/                      Vendored H5P runtime libraries
  h5p-core/                      Vendored H5P core runtime

docs/help/                       Canonical instructor-facing CREATE Guide corpus
docs/plans/                      Feature designs and implementation records
```

Normal request flow is component → `src/services/api.ts` → controller → service
→ Mongoose/Qdrant/LLM. Keep controllers thin when adding substantial logic.

## Core data model

- `User`: CWL identity, role, environment-key permission, and usage stats.
- `Folder`: instructor-owned course, materials, learning objects, optional
  Canvas course/module links, and aggregate stats.
- `Material`: PDF/DOCX/URL/text source, processing state, parser metadata, and
  Qdrant document identifier.
- `Quiz`: learning object, assigned materials, objectives, questions, blueprint
  settings, delivery target/format, chapters, generation history, and exports.
- `LearningObjective`: ordered objective plus subpoints, source outline mapping,
  Bloom level, prompt provenance, coverage diagnostics, and source references.
- `GenerationPlan`: older persisted plan representation. Current editable
  blueprint rows also live in `Quiz.settings.planItems`.
- `Question`: generated/manual question content, objective link, plan slice,
  novelty metadata, source references, review status, and edit history.
- `CoursePromptOverride`: versioned per-course prompts by workflow step and
  teaching purpose.
- `BugReport`: user-submitted issue with open/in-progress/resolved/closed state.
- `AuditEvent`: privacy-limited mutation audit record.
- `HelpInteraction`: schema prepared for help analytics/ratings. Do not assume
  that persistence or rating endpoints exist until the controller implements
  them.

## Materials and RAG flow

1. Material controllers accept PDF, DOCX, URL, or text input and create a
   `Material` record.
2. Processing parses content, preserves PDF page/section metadata where
   possible, chunks it, creates embeddings, and indexes it in Qdrant collection
   `quiz-materials`.
3. Material status must reach `completed` before generation relies on it.
4. LO generation builds a broader material inventory instead of trusting one
   narrow semantic query. It maps instructional sections to objectives or
   subpoints and can run a coverage repair pass.
5. Blueprint/question generation retrieves question-specific evidence and
   stores source references on generated records.

`routes/create/services/ragService.js` is the canonical RAG boundary. Preserve
`materialId`, `materialName`, `sourceFile`, `chunkIndex`, `pageNumber`,
`pageStart`, `pageEnd`, `excerpt`, `relevanceScore`, `section`, and `sectionId`
when source-reference data crosses a service, schema, or frontend type.

There are both Agenda-backed jobs and an in-process material processing service
in the codebase. Trace the controller call site before changing queue behavior;
do not assume both paths have identical file-retention or retry semantics.

## Learning-objective, blueprint, and question generation

- LO generation/enrichment starts in `objectiveController.js` and uses
  `llmService.js`, `ragService.js`, course prompts, material inventories,
  outline coverage validation, and repair logic.
- The editable blueprint is owned by `QuestionGeneration.tsx`,
  `AIConfigPanel.tsx`, and `PlanEditor.tsx`; backend planning is in
  `planController.js` and question-budget helpers.
- Automatic question count is evidence/complexity based. It is a recommendation
  and must still satisfy controller limits and at least one valid allocation per
  objective.
- Streaming generation begins through `streamingController.js`, is coordinated
  by `questionStreamingService.js`, and emits via `sseService.js` to
  `useSSE.ts`.
- Manual blueprint rows may intentionally use a custom prompt without a linked
  learning objective. Both streaming and non-streaming fallback paths must
  accept a null LO when a non-empty custom prompt exists; normalize optional
  text before previews, metadata derivation, or logging.
- Persist that contract in `Quiz.settings.planItems`: `learningObjective` may be
  null only when `customPrompt` is non-empty, and `selectionMode`,
  `customPrompt`, and `useCustomPromptOnly` must survive save/restore. A failed
  Blueprint save must abort question generation before replacement deletes any
  existing questions.
- Long-running generation UI scrolls to the live trace when work begins and to
  the newly rendered result/action area when it completes. Keep single-item
  regeneration anchored to its existing card instead of moving the whole page.
- Repetition control uses objective subpoints/planned slices plus
  `questionMemoryService.js`; do not remove plan-slice or novelty metadata as
  cosmetic fields.
- Course prompt overrides are constraints layered onto system behavior. Prompt
  source/version should remain visible in backend metadata without exposing
  hidden system messages or credentials.

## Delivery targets, formats, and question types

`src/constants/questionTypeCapabilities.ts` is the frontend source of truth for
the compatibility matrix. Current delivery choices are:

- H5P Package: Column, Interactive Book, Question Set, Standalone
- Canvas LTI: Mixed Activity

Current user-facing question types are Multiple Choice, True/False, Flashcard,
Summary, Discussion, Matching, Ordering, Fill in the Blank, Mark the Words,
Single Choice Set, Essay, Sort Paragraphs, Crossword, Branching Scenario, and
Documentation Tool.

Do not infer that every type works in every H5P container. When adding or
changing a type, audit all of these together:

1. `questionTypeCapabilities.ts`
2. frontend plan/add/edit/interactive renderers
3. backend constants, schemas, LLM prompt and response validation
4. H5P conversion, dependencies, preview, and export
5. PDF/Markdown/Word export when applicable
6. compatibility docs and tests

Question Set is a target container, not a normal generated question type.
Canvas LTI Mixed Activity is a CREATE runtime and is not an official H5P
container. See `docs/create-supported-question-types.md` for the detailed
compatibility rationale.

## Two different reference systems

Do not mix these concepts:

### Course-evidence references

LOs and questions store references to instructor-owned source materials.
`SourceReferencePreviewModal.tsx` resolves a reference through
`POST /api/create/materials/:materialId/reference/resolve`. PDFs render the cited
page with `PdfPagePreview.tsx` and token-level highlights; other sources show
the extracted context. The backend resolver prefers excerpt similarity, then
page number, then chunk index.

### CREATE Guide citations

CREATE Guide cites product documentation from `docs/help/*.md` plus generated
facts from `questionTypeCapabilities.ts`. These citations explain how to use the
product; they are not course evidence.

## CREATE Guide current state

- `Layout.tsx` mounts a global floating `CreateGuide` widget on authenticated
  pages.
- `POST /api/create/help/chat` returns authenticated SSE events.
- `helpKnowledgeService.js` hashes and reloads the allowlisted local help corpus,
  performs lexical/context retrieval, and provides source/navigation metadata.
- `helpChatService.js` grounds a read-only assistant in retrieved help chunks and
  falls back to a static excerpt when the configured LLM is unavailable.
- Conversation history is bounded and stored in browser `sessionStorage`.
- `HelpManual.tsx` builds the authenticated `/help` route directly from
  `docs/help/*.md`, with search, table of contents, safe Markdown rendering, and
  stable document/section anchors.
- Source cards navigate to `/help?doc=...&section=...`; the matching manual
  section scrolls into view and receives a temporary citation highlight.
- User Account **Help & Support** is a normal link to `/help`. The manual's
  report CTA opens `/account?report=1`, which opens the existing report modal.

Keep the backend `slugifyHeading()` and frontend `slugifyHelpHeading()` rules
equivalent. A heading rename changes its citation target, so update retrieval
tests whenever cited headings or document IDs change. The synthetic capability
document maps to sections in `question-types.md` while continuing to read facts
from the canonical TypeScript registry.

For every user-visible workflow change, update the relevant `docs/help/*.md`
file and add retrieval regression coverage for new terminology. The help corpus
must explain labels users can actually see, expected results, and recovery from
common failures.

## Bug-report workflow

The current user flow is User Account → Report Question Bug → report modal →
`adminApi.submitReport()` → `POST /api/create/admin/reports` → `BugReport`.
Authenticated users can submit; admins list reports, mark them in progress or
resolved, and view platform statistics in `AdminDashboard`.

Current report types are `bug`, `incorrect`, `unclear`, and `other`. Reports
contain free-form description and optional email but do not currently capture
route, learning-object/question ID, browser metadata, attachments, reproduction
steps, expected/actual result, or automatic error logs. Do not claim those are
collected unless the schema and UI are extended.

## Authentication, authorization, and privacy

- Passport/SAML authentication and Mongo-backed sessions are configured in
  `server.js` and `routes/create/middleware/passport.js`.
- Frontend auth expiry is propagated through `src/utils/authEvents.ts`.
- Most API endpoints require `authenticateToken`; controllers must also enforce
  ownership using the signed-in user, not merely validate object IDs.
- Per-user LLM keys are stored encrypted. Admin/environment-key permission is a
  separate authorization decision.
- Mutation audit metadata is allowlisted in `auditService.js`. Never write
  prompts, material text, API keys, cookies, or other private content into audit
  records.
- Product-help retrieval may read only the allowlisted help corpus and the
  capability registry. It must not retrieve course material, `.env`, API keys,
  or arbitrary source files.

## External services and local ports

Defaults come from `.env.example`:

- Frontend Vite: `http://localhost:8092`
- Express API: `http://localhost:8051/api/create`
- MongoDB: `localhost:27017`, database `tlef-create`
- Qdrant: `http://localhost:6333`, collection `quiz-materials`
- Local SimpleSAMLphp IdP: `http://localhost:6122`
- Ollama fallback: `http://localhost:11434`
- Optional Canvas: `http://localhost`; optional LTI public runtime on port 7737

The app can use OpenAI-compatible endpoints or Ollama. `llmService.js` resolves
the effective provider/model/key and supports per-user credentials. Redis is
listed in dependencies/environment configuration but is not currently a core
runtime path; verify call sites before treating it as required.

Never commit `.env`, private keys, session secrets, API keys, uploaded source
files, or local database/vector data.

## Commands

```bash
npm install
cp .env.example .env
npm run dev                 # frontend and backend together
npm run dev:frontend        # Vite only
npm run dev:backend         # nodemon/Express only
npm run build               # production frontend build
npm run lint
npm test                    # Vitest frontend tests
npm run test:backend        # Jest backend suite, serial
npm run saml:fetch-cert     # fetch the local IdP certificate
npm start                   # production-style Express server
```

Backend integration tests require suitable MongoDB and other backing services.
Prefer focused unit tests while iterating, then run the proportional broader
suite and `npm run build` for frontend changes.

Useful focused tests for the current help/reference work:

```bash
cd routes/create
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand \
  __tests__/unit/helpKnowledgeService.test.js \
  __tests__/unit/referenceResolver.test.js
```

## Repository conventions

- Frontend code is TypeScript/TSX; backend code is ESM JavaScript.
- Use `src/services/api.ts` instead of scattered component-level API clients.
- Use shared `successResponse`, `errorResponse`, and `notFoundResponse` helpers
  for normal API envelopes.
- Add controllers to `createRoutes.js` before the API 404 handler.
- Reuse Redux slices/selectors and PubSub/SSE conventions instead of creating a
  second state channel for the same domain data.
- Keep user-facing terminology consistent within a surface. When backend `Quiz`
  must remain, translate to Learning Object at the UI boundary.
- Keep code comments in English.
- Update `.env.example` whenever a new environment variable is introduced.
- Avoid editing `routes/create/h5p-libs/` or `h5p-core/` unless the task is
  specifically a vendored H5P library/runtime change.
- Treat the application-level `dist/`, uploads, `local_cache/`, coverage output,
  and database/vector storage as generated or runtime data. Vendored H5P
  libraries are the exception: their nested `h5p-libs/*/dist/` browser bundles
  are runtime source assets and must be committed.

## Vendored H5P asset integrity

H5P preview dependency resolution reads each vendored library's `library.json`
and emits every declared `preloadedJs` and `preloadedCss` path. A descriptor
without its compiled asset causes `H5P.newRunnable()` to create a placeholder;
parent libraries can then fail when they call the missing child's API.

Keep library metadata and browser bundles on the same upstream patch version.
Do not add a dependency from a newer patch to an older descriptor. When adding
or updating a compiled H5P library, commit all declared JS/CSS and any local
assets referenced by its CSS, then extend `h5pLibraryAssets.test.js` coverage.

## Working-tree safety

This repo is often used with substantial staged and unstaged feature work.
Before editing, run `git status --short` and inspect overlapping diffs. Preserve
all unrelated user changes. Never reset, checkout, reformat, or rewrite a dirty
file merely to simplify a task.

When a plan document says a feature is implemented, verify the controller,
route, UI, and tests in the current working tree. Conversely, untracked files
may be essential parts of active feature work even though they are not in
`HEAD` yet.
