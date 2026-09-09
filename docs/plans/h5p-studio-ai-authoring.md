# Native H5P Studio AI authoring and workflow refinement

Date: 2026-09-07. Status: beta implementation; not a claim that every content type
has passed end-to-end acceptance. No production data migration or deployment.

## Product decisions

- Preserve CREATE's white surfaces, dark text and black primary buttons.
- Keep the Dashboard statistics. Use persisted Quiz questions and processing
  state for the next action; do not overrule real questions with stale progress
  flags or inflate counts with stale aggregate stats. Refresh after question
  events and while materials process.
- Studio has three navigable steps: Create a draft → Review & edit → Preview &
  download. Save & preview persists current changes before launching the player.
  Download from the editor also saves first. Invalid editor fields stop the
  transition. Clicking the active preview step must not toggle back to editing.
- Broaden AI authoring through the native H5P document model, not by adding every
  lesson, media player and survey to the scored Quiz Question enum.
- Quiz generation remains the grounded, evidence-linked path. Its Explore AI
  activities link passes owner-checked Quiz context to Studio; the new draft is
  independent, with a Back to source Quiz link.

## Architecture

1. `GET /api/create/h5p-editor/ai/catalog` discovers installed runnable libraries,
   their semantics, dependency closure, required core API and declared JS/CSS.
   Select the newest healthy installed version of each machine name. Dependencies
   that are not runnable are nested building blocks, not top-level choices.
2. `POST /api/create/h5p-editor/ai/generate` accepts `library`, `instructions`,
   optional `quizId` and optional `templateContentId`. All routes authenticate;
   referenced Quiz and template must belong to the current user.
3. `h5pStudioSemantics.js` translates semantics into a bounded JSON Schema for
   the model. Critically, list field names are not extra JSON wrappers, and a
   field named `library` can itself contain `{ library, params }`.
4. `h5pStudioAIService.js` uses the existing per-user LLM provider/key path, parses
   a native `{ title, params }` response, validates against installed semantics
   and permits one repair attempt. Defaults come from the library, not guesses.
5. Save via `saveNativeH5PDocumentAndRecord` and Lumi. The additive
   `H5PContent.source = ai-studio` and optional `aiGeneration` subdocument record
   library/model/contract version/attempt count, not prompts or teaching content.
6. The same owned record opens in the official editor and existing preview/
   download endpoints. Editing source Quiz questions does not mutate this copy.

## Safety and reliability

- No AI-provided executable libraries, paths to server files or install actions.
- A process-local per-user generation lock and 10 requests per 10 minutes limit
  prevent accidental double-click work. Multi-replica deployments should replace
  these local controls with shared job/limit storage before broad rollout.
- Input/schema/response size, nesting, list length, enum and number checks apply
  server-side. Unknown fields are removed and simple HTML is allowlist-sanitized.
- Media file references must come from a saved owner-checked template. Lumi's
  `../content/<source-id>/...` paste mechanism copies the file into a NEW activity.
  Verify retained file references after save; failed copies trigger rollback.
- A failed Mongo record creation rolls back the newly created Lumi content.
  Structural validation failure does not modify the Quiz or template.
- A generated external URL cannot be introduced without a saved template.
  Existing third-party media/embeds still depend on that host's availability.
- The model receives template text/parameters, not media perception. Spatial
  meaning, answers, instructional quality and all browser runtime invariants are
  not proven by JSON validation. Instructors must review the result.
- Generation is a request-bound workflow, not a durable background job. Keep the
  page open. After interrupted requests, check Your content before retrying.
- Lumi's Hub/automatic-upgrade catalog is filtered to the same healthy versions
  as the AI catalog. This prevents saved Dictation 1.3 drafts silently upgrading
  to incomplete 1.4. Unavailable types remain explained in the AI catalog but
  cannot be newly selected from the official editor's Hub.
- Local editor-core integration fix: `LibrarySelector.getParams()` now returns
  `false` when a required child/metadata field fails validation. The original
  vendored implementation called validators but ignored their result. Lumi now
  receives its expected validation signal instead of proceeding toward save.
- Normal Studio media saves also validate required native fields server-side.
  This stops incomplete media templates even when an editor widget fails to
  report invalid input. This validation does not authorize file access; Lumi's
  owned-file checks still apply. Only the explicit template-preparation endpoint
  may create an intentionally incomplete starting draft.

## Installed-library maintenance

Agamotto 1.6.8 browser assets were built from the exact upstream tag:
https://github.com/otacke/h5p-agamotto/tree/1.6.8 (archive commit prefix 3c461db).
The upstream and local `library.json` matched. Build used the upstream lockfile,
`npm ci --ignore-scripts`, then the reviewed webpack `npm run build`; copied the
generated JS, CSS and referenced SVG files together. Asset tests cover declared
files and local CSS references. No metadata version was lowered.

Dictation 1.3.9 was built using its upstream lockfile and webpack configuration:
https://github.com/otacke/h5p-dictation/tree/1.3.9 (commit prefix 7ecf6e2).
Its original descriptor explicitly supports core 1.27. Installed the compiled
assets, semantics, original descriptor, icon, languages, upgrades and MIT license
alongside (not over) 1.4. `POST /api/create/h5p-editor/ai/template` creates an
owned, intentionally incomplete draft of the compatible version and opens it in
the official editor. This is needed because Lumi's new-content web component
ignores a preset library and always opens the Hub. Required media must be filled
and saved before AI adaptation. Preparing this template does not call the LLM.

Branching Scenario upstream 1.10.1:
https://github.com/h5p/h5p-branching-scenario/tree/1.10.1
requires core 1.28. Do not copy its bundle into the incomplete local descriptor
and assume it works on 1.27. An older 1.8.14 runtime was also checked, but its
required official editor has additional version-specific dependencies missing
from this checkout. Leave native Branching Scenario gated, rather than mixing
descriptor versions. Dictation 1.4 has the same core-version boundary, so the
catalog selects the independently installed official 1.3.9.
Interactive Book 1.13 is incomplete; use the healthy installed 1.11 for now.

## Verification and next acceptance work

- Unit tests: installed catalog, actual JSON shape, nested library allowlist,
  official defaults, Guess the Answer empty media regression, unsafe HTML,
  invalid output repair, owned-template media references.
- API tests: authentication boundary wiring, template ownership, input rejection
  before AI usage, new native draft persistence and rollback. Tests use a mocked
  authenticated principal; this is not an end-to-end SAML authorization test.
- Frontend tests: type search/selection, template and maintenance guidance,
  generation failure preserves brief; dashboard actual counts/state; preview
  requires a successful save.
- CREATE Guide retrieval tests include Create with AI and media-template terms.
- Live local test: Chart generated the supplied values 12, 8 and 6; official
  editor showed the values, Save & preview rendered the bar chart correctly.
- Live Questionnaire testing found ambiguous list-wrapper instructions. Replaced
  raw editor semantics in the prompt with the actual JSON Schema; the repeated
  real-AI test passed generation, official editing, Save & preview, open-ended
  response, single-choice selection, navigation, submit and success screen.
- Isolated real Lumi filesystem test passed template audio copy → delete test
  source → export ZIP with byte-identical audio → reimport → resave. It uses
  generated silence, not personal media or the live database.
- Live Dictation 1.3.9 template opens the official sound-sample/transcript editor.
  No claim of a full generated Dictation run without a real supplied transcript
  and audio. Repeated local testing confirmed an incomplete template stays in
  the editor with required-field feedback instead of opening the preview.
  Chart still saves and previews successfully after this validation change.
- Final regression run: 32 frontend files / 113 tests passed; 10 focused
  H5P/help backend suites / 103 tests passed. Production frontend build and
  targeted frontend lint passed; existing bundle-size warnings remain.
  `git diff --check` passed. These totals include the current working tree's
  earlier workflow changes, which were preserved, not rewritten wholesale.

Before declaring every content type fully supported: run a representative
generation → official edit → save → player → export → reimport test for EACH
type, test owned-media copies and deletion independence, check keyboard/mobile
use, and test target LMS import. Upgrade core/editor/Lumi and the blocked
libraries together, with a dedicated regression pass. A catalog entry is not
evidence that these acceptance tests passed.
