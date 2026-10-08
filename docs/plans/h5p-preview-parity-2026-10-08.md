# H5P preview parity — 2026-10-08

## Outcome and scope

Repaired Current question set styling, Question Set navigation icons, and
Interactive Book completion tracking while retaining the shared lightweight
preview runtime. H5P Studio remains the reference for the installed library
versions; upstream H5P examples provide a behavior comparison, not an exact
pixel comparison across versions.

The local QA course contains 40 learning objects, 71 deterministic question
records and 40 independent Studio drafts. No AI requests were made. The matrix
covers 16 question types across all 34 supported type/container combinations:
13 Column, 13 Interactive Book, 5 Question Set and 3 Standalone. Three additional
multi-answer samples and three combined-container samples complete the matrix.
Canvas Mixed Activity is a separate CREATE runtime and is outside this H5P
container comparison.

Artifacts: `output/h5p-preview-comparison-2026-10-07/index.html`,
`manifest.json`, paired screenshots, DOM snapshots, `states.jsonl`,
`performance-before.json`, `performance-after.json`, and `motion-comparison.json`.
The folder date records when this task began; testing continued on October 8.

## Root causes and implementation

1. **Missing core theme.** Current used an incomplete inline theme variable
   subset and omitted the full installed H5P core styles. This removed option
   borders, padding, icons and theme typography. `h5pPreviewStylesService.js`
   combines the eight canonical core styles into one memoized CSS response.
   Its `/core/styles/preview.css` location preserves relative font URLs.
   Versioned requests receive immutable caching; unversioned requests revalidate.
   Preview roots now carry the native iframe/content/density classes. Duplicate
   incomplete inline theme overrides were removed.
2. **Empty Question Set arrows.** Question Set 1.20 creates empty navigation
   buttons through the newer Question theme API. A narrow CSS compatibility
   rule supplies the native theme glyph only for empty Next/Previous buttons.
   Both glyphs use `::after`: the theme reserves `::before` for hidden tooltips.
   Final browser review exposed that collision; the CSS revision was bumped
   and both arrows and actual backward navigation were rechecked on both surfaces.
   Current, native preview and Lumi Studio share this rule. Labeled buttons
   and upstream library bundles are unchanged.
3. **Lost Interactive Book completion source.** The custom shared runtime
   forwarded xAPI events with the dispatcher as the callback context and could
   emit the same external event again along the parent chain. The official
   Book expects the original content instance's `subContentId`. EventDispatcher
   now forwards the original source once while preserving explicit listener
   contexts. The runtime URL revision invalidates stale browser copies.

No additional JavaScript library or editor runtime was added. The changes leave
question persistence, permissions and export data contracts intact. Existing
unrelated authoring and interface changes in the working tree were preserved.

## Browser evidence

Every supported combination has initial screenshots from both surfaces and a
learner interaction/read-only check appropriate to its type. The HTML groups
these by container/type and provides paired step screenshots and recorded DOM
evidence. Combined Column has initial screenshots; its individual types were
played separately. Book and Question Set have additional full navigation flows.

- Multiple Choice: single-answer feedback; multi-answer partial and full
  selection; Question Set retry resets responses. Existing scoring differs:
  Column/Book use a single point for the whole multi-answer question, while
  Question Set scores correct choices individually. This was documented rather
  than silently changing scoring policy.
- Question Set: all six questions, Next/Previous, Finish, Show solution, Retry.
  Both surfaces finish at 10/11 after an intentionally wrong first answer.
- Book: answer, chapter navigation, summary, return to retained feedback. Both
  show 1 of 2 interactions complete and 1/19 after answering the first item.
- Matching/Ordering: native keyboard drag/drop and correct feedback (3/3, 4/4).
- Sort Paragraphs: keyboard reorder, 3/3 adjacent relationships.
- Crossword: native clue keyboard entry, 5/5 on both surfaces. An initial
  automation attempt incorrectly cleared shared crossing letters; final evidence
  uses Home plus sequential typing without clearing. That automation error is
  not recorded as a product defect.
- Single Choice Set: two answers, manual Next, results 2 of 2 correct.
- Documentation Tool: observation, goal, interpretation, assessment and export
  preview containing entered text. This did not test an actual file download.
- Branching Scenario: positive and negative endings on both surfaces; restart
  controls are present. Unit tests also exercise both endings and restart.
- Flashcard, Guess the Answer, Summary, Discussion, True/False, Cloze,
  Mark the Words and Essay: native reveal/read/check behavior as applicable.

Headers, content widths and randomized answer order may differ between the
CREATE wrapper and Studio. These differences are not evidence of runtime failure. Question Set journey
steps 01–15 preserve captures before the final left-arrow adjustment; steps
16/17 show the final corrected buttons and backward navigation.

## Animation comparison

The animations skill was used to preserve native transitions without introducing
another motion dependency. Official sources visited and played:

- https://h5p.org/dialog-cards
- https://h5p.org/question-set
- https://h5p.org/single-choice-set (behavior documentation)

Official Dialog Cards and both local surfaces expose the same card-holder
`transform 0.2s ease-in-out` transition and card-wrap `left 0.3s` transition.
Before/after stills and computed styles were captured. This is not a recorded
video, frame-rate benchmark, or comprehensive reduced-motion/accessibility audit.
Question Set ending videos are optional supplied media; no ending video was
configured in these fixtures. Generated Single Choice Set uses manual Next
(`autoContinue: false`), so it does not automatically advance after feedback.

## Loading measurements

Three warm browser reloads of the same original preview:

| Measure | Before | Final after |
| --- | --- | --- |
| Load times, ms | 415.4 / 266.1 / 377.4 | 409.2 / 344.0 / 270.4 |
| Median, ms | 377.4 | 344.0 |
| JavaScript requests | 28 | 28 |
| Added theme response, raw | — | 43,580 bytes |

The added CSS was cached with zero transfer size on warm reloads. Cold loads
still incur the stylesheet and required fonts. These local small samples show
no observed warm-loading regression; they do not prove a general speedup.

## Automated validation

Node 22.22.3, Jest ESM, serial: seven focused suites, **203 tests passed**.
Suites cover legacy/native preview, native documents, asset headers, pinned
runtime integrity, source-preserving event forwarding and help retrieval.
`npm run build` passed (1997 modules); existing chunk-size and mixed import
warnings remain. No repeat broad tests were necessary after passing these checks.

Reproduction uses `scripts/seed-h5p-preview-matrix.mjs` with its documented
arguments and shared `scripts/fixtures/h5p-render-questions.mjs`. The matrix
script creates a fresh course and does not delete existing user questions.
Do not run the older comparison seeder to recreate this matrix: it has different
cleanup behavior. Fixture generation validates rendering, not AI answer quality.
