# Course workflow and H5P Studio: one learning object, explicit versions

Status: product proposal with the first navigation increment implemented locally, 2026-09-20. Full content unification is not implemented.

## Problem and evidence

The instructor thinks they are editing a course activity. CREATE currently gives them two independently saved representations: guided `Quiz`/`Question` records and native `H5PContent`/Lumi parameters. A successful Studio save does not update the guided questions, coverage or course export. This makes it easy to teach from a different version than the one reviewed in the course workflow.

Evidence, with its limits:

| Evidence | Observation | Confidence / limitation |
| --- | --- | --- |
| User screenshots and reported behavior | Documentation Tool showed only title/heading; returning to draft lost instructions and selection | Direct report from a small number of sessions; no population-level frequency claim |
| Current `h5pEditorController` and `H5PContent` | Native records have owner, folder, quiz, source fingerprint and last edit time; saving does not write `Question` | Verified in code |
| Current Review handoff | Existing Studio drafts can be reopened or copied afresh; source changes are detected | Verified in code; freshness is not synchronization |
| Current Course view | Linked native activities were absent from the course inventory | Verified in code; addressed by this increment |
| Supported native H5P semantics | Arbitrary nested media, branching, documentation pages and host-specific behaviors exceed the guided question schema | Architectural constraint; reverse adapters require per-type evidence |

The evidence supports fixing discoverability and version clarity now. It does not establish that instructors want every native edit translated into guided questions, nor that a lossless general translation is possible.

## Product decision

Make Studio an advanced authoring surface associated with a course learning object. Keep one activity identity, but distinguish its editing representation and saved versions. Do not silently merge native H5P edits into guided questions.

The recommended sequence is **shared course inventory → explicit delivery version → supported conversion adapters**. The first increment exposes activities already linked by stored course ownership; it does not claim bidirectional synchronization.

| Approach | Benefit | Main cost / risk | Decision |
| --- | --- | --- | --- |
| Shared entry points, independent versions | Easy to find and continue existing work; no conversion loss | Two representations still exist | Implement now |
| Explicit saved native version for H5P delivery | Instructor selects exactly what students receive; preview and H5P download agree | Version history, switching rules, export and coverage labels needed | Next architectural increment |
| Automatic two-way synchronization | Familiar single-document expectation | Arbitrary H5P cannot be mapped losslessly to questions/LO evidence; loops and conflicts can silently destroy edits | Do not promise globally; evaluate per type |

## Users and goals

Primary user: an instructor iteratively creating an activity from course evidence, reviewing questions, and refining native H5P behavior. This is a task-based user description, not a research-derived demographic persona.

Goals and acceptance targets (targets, not measured outcomes):

1. Every existing linked Studio activity is reachable from its course without searching the global inventory.
2. The interface identifies which saved representation powers each preview and export before delivery.
3. A failed generation, source refresh or version switch never silently deletes instructor edits.
4. Coverage claims remain traceable to the exact guided revision used; native-only changes never inherit unverified coverage claims.
5. New native versions can be evaluated against fixed teaching-quality examples and visually tested with the supported runtime.

Out of scope for the first increment: automatic content conversion, moving existing standalone activities between courses, changing Canvas delivery to native H5P, hiding guided questions, a new grading system, or claiming AI-certified correctness.

## Current increment: course discovery

Implemented:

- Course page lists owner-scoped Studio activities whose stored `folder` matches the course.
- Each card opens the existing native content ID; no copy or model invocation occurs.
- When the source learning object still exists, a second link opens its Review tab.
- The page says Studio saves a separate version and guided questions still power course coverage and course exports.
- Loading failure is distinct from an empty inventory; retry is available.
- Course switches ignore late responses for the previous course.
- Scope query parameters are validated, and all queries retain authenticated owner filtering.

Limit: the existing API returns the most recent 200 activities. Pagination is needed before claiming an unbounded inventory. Standalone/imported content without a stored course association is not inferred to belong to a course based on its title.

Acceptance examples:

- Given a native activity associated with course A, opening course A shows a link to that exact content ID.
- Given a linked source that still exists, its source link opens the actual learning object Review page.
- Given a request for another instructor's course ID, no other instructor's activity is returned.
- Given a slow request for course A followed by navigation to B, A's results never populate B.
- Given a failed listing request, the page shows retry, not a false zero-content result.

## Next increment: explicit delivery versions

Proposed model (not yet shipped):

- Learning object owns stable activity identity and course ownership.
- Guided revisions and native revisions are immutable saved snapshots with source revision and editor provenance.
- A delivery selection references one specific saved revision; a later edit makes a new draft rather than changing already selected delivery silently.
- Native content IDs and packaged dependencies remain associated with their saved revision.
- A compare-and-swap revision check prevents two tabs from publishing over each other.
- Preview, H5P export and download all read the selected revision. Other exports clearly disclose unsupported native-only structure.

Proposed P0 acceptance:

- After choosing a native revision for H5P delivery, course H5P preview and downloaded package use the same snapshot.
- Editing either surface afterwards does not mutate the chosen snapshot. A visible action selects a newer revision.
- Source changes show a stale-source notice and offer a new draft; existing Studio edits survive.
- Switching back to guided delivery preserves the native revision and confirms the version being selected.
- If a native revision cannot produce a supported Word/PDF/Markdown or Canvas representation, the corresponding action explains this instead of exporting stale guided questions under the same version label.
- Coverage for guided source revision X remains labelled X. Native changes without question/evidence mappings are labelled unverified and do not improve coverage scores.
- Existing records migrate to clearly identified independent legacy versions; no content regeneration or irreversible conversion is required.

Proposed P1 acceptance:

- Stable item IDs allow known adapters (start with Multiple Choice, True/False and Dialog Cards) to show a field-level proposed update before applying it.
- An adapter round-trip suite proves preserved text, answer correctness, feedback, media and stable identity for each advertised type.
- Unsupported native fields remain native; a lossy conversion requires an explicit reviewable choice and retains the original snapshot.

## Roadmap and dependencies

| Horizon | Deliverable | Dependency | Release gate |
| --- | --- | --- | --- |
| Now | Runtime compatibility, durable generation, fixed evaluation corpus; shared course Studio inventory | Existing ownership and revision metadata | Asset/runtime checks, safe publication tests, browser smoke checks |
| Next | Select and preview a delivery revision from the learning object | Agreed activity/version schema, immutable native snapshot storage, export routing | Same-version preview/export, conflict and rollback tests, instructor usability review |
| Later | Per-type guided/native update adapters; richer version comparison | Stable item mapping plus semantic round-trip fixtures | No silent loss for every advertised adapter |

No dates or velocity estimates are inferred. The current request sets the priorities; a full version migration should be implemented as its own reviewable increment after this reliability work is validated.

## Measurement plan

Collect only consented/product-appropriate event metadata, not prompts, source text or student answers. Instrumentation below is proposed, not currently claimed to exist.

- Course-to-Studio continuation: fraction of course-linked editing sessions opened from a course entry.
- Version confusion: support reports where the preview/export differs from the instructor's intended saved version.
- Recoverability: interrupted task receipts reaching an explicit terminal status; duplicate paid starts per request must be zero.
- Safety: failed/conflicted replacement tasks changing the published question manifest must be zero.
- Teaching quality: first-pass structural/factual checks, post-review checks, rejection counts and human rubric ratings reported separately on a fixed corpus.

Establish baseline observations before setting improvement percentages. A small synthetic corpus is a regression alarm, not a claim of general instructional effectiveness.

## Remaining product questions

1. For delivery, should an instructor select one default revision per learning object or different revisions for H5P and Canvas? Recommend one explicit choice per delivery target because their renderers differ.
2. When importing standalone H5P, should the instructor attach it to an existing learning object or create a native-only one? Recommend both, with explicit ownership validation and no inferred association.
3. Which native edits must round-trip first? Start from observed instructor tasks and supported-field preservation, not the number of library types.

## Methods and sources

Used the publicly available [write-spec](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/write-spec/SKILL.md), [synthesize-research](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/synthesize-research/SKILL.md), and [roadmap-update](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/roadmap-update/SKILL.md) skills to separate evidence from inference, express testable acceptance criteria, and sequence dependencies. They were read and applied; no additional plugin was installed.
