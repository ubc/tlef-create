# Studio: learning-objective-first authoring

Status: implemented; focused checks and browser acceptance completed.

## Product requirement

The instructor's request determines the destination. A request for learning
objectives must produce editable objectives without purchasing question
generation. A clear request for questions must proceed through material
understanding, objectives, question planning, generation, validation, bounded
repair and an actual usable preview without requiring repeated Next or Resume
clicks. Missing topic, conflicting requirements and genuinely unavailable
evidence still require an honest explanation or a focused clarification.

Clarifications use **Confirm and continue**. Confirmation submits the selected
and custom answers as a real user message tied to the current clarification;
it does not copy text into the composer. The instructor's unsent chat draft is
preserved. The server validates the card and creates the canonical answer text.

## Design

- Persist the requested destination and its instructor authorization. Keep
  objectives-only, plan-review, question-generation and native-activity intents
  distinct across clarifications, worker recovery and queued messages.
- Read the selected material before proposing objectives. Display a compact
  teaching brief containing material classifications, the actual read scope,
  topics, exclusions, measurable objectives and explicit inferred/default
  assumptions. A sampled reading must not claim complete document coverage.
- Without material, brainstorm a coherent teaching frame from the instructor's
  topic and visible defaults, then produce objectives. Never invent course
  evidence or citations.
- Persist and expose the objective result before planning questions. Offer a
  real objective editor. Pausing to edit must preserve the last accepted
  artifact; saving an objectives-only task must not generate questions.
- Bind every new planned question to a distinct task focus and trusted source
  identifiers. Expand persisted tasks into independent generation inputs.
  Repeated row instructions alone are insufficient to distinguish questions.
- Use validated, source-version-bound excerpts already obtained by planning
  directly. When additional evidence is required, retrieve within the same
  selected material scope. An arbitrary client excerpt is never trusted
  evidence.
- Continue a clearly authorized new question request through the existing
  ownership, quantity, capability, source and persistence gates. An accepted
  artifact revision remains a candidate version until accepted. Publishing
  elsewhere remains a separate action.
- Repair known failures using their actual observations: arithmetic/feedback,
  answer ambiguity, instruction mismatch, insufficient retrieved evidence,
  planned-focus mismatch or duplicate question focus. Retain successful
  questions. Bound item attempts, continuation rounds and deadlines; never
  replay an unknown paid outcome or lower a quality threshold to claim success.
- Record real operation starts and completions, including material inspection,
  objective drafting, objective checking, planning, source retrieval, question
  checks, repair and preview preparation. Display outcomes, not hidden reasoning.

These changes reuse the current domain services, strategy registries, durable
jobs, operation receipts and SSE boundary. Prompt instructions, workflow
admission, planning data and question-repair strategy have separate owners.

## Reference decisions

Measurable, student-centered objectives should describe observable performance
and guide the assessment. This informs the objective prompt and its output
checks, including replacing vague “understand” goals and separating compound
skills. [CMU Eberly Center](https://www.cmu.edu/teaching/designteach/design/learningobjectives.html)

Assessment should match the taught learning outcomes and cognitive level.
Alignment does not require copying the same classroom examples. This informs
distinct question-task planning and preservation of the instructor's scope.
[UBC Assessment Guidebook](https://blogs.ubc.ca/assessmentguidebook/assessment-appendix/constructive-alignment/)

Composable workflows can validate intermediate outputs; agent continuation
should depend on real tool results and have stopping conditions. This informs
the durable stage transitions and bounded recovery loop.
[Anthropic agent engineering](https://www.anthropic.com/engineering/building-effective-agents)

Prompt improvements require representative examples and verifiable expected
outputs, followed by evaluation and iteration. This informs the cases below;
the third-party skill is a reference, not an installed dependency or an
instruction authority for CREATE.
[Anthropic skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)

## Completion audit

No row is complete based only on a prompt statement or a passing test that
does not exercise the promised behavior.

| Requirement | Required evidence |
| --- | --- |
| Direct clarification confirmation | Browser choice/custom input → one canonical submitted message → automatic continuation; existing composer draft preserved; replay/stale-card tests |
| Visible material judgment | Real selected material names, classifications, read scope and grounding provenance in the returned brief and rendered UI |
| LO before plan | Persisted objectives and separate operation events appear before question-plan/generation operations |
| Editable LO result | Real objective text edit/save verified; no question generation for an objectives-only request |
| No-material path | Brainstormed objectives with visible assumptions and no fabricated material citation |
| Minimal interruptions | A clear material-based question request reaches the requested checked count and usable H5P preview without manual plan approval/repeated Resume |
| Complete plan | Requested count, objective/topic coverage, supported types, distinct tasks and trusted source links survive save, reload and expansion |
| Automatic recovery | Targeted repair uses feedback/new evidence, preserves ready items and ends within declared bounds; outages and uncertain saves do not buy uncontrolled retries |
| Honest progress | Visible operation lifecycle matches real saved receipts, including LO and repair stages after reload |
| Extensibility | Workflow remains independent of individual H5P strategies; multiple supported question formats use the same orchestration contract |

Runtime cases must include an objectives-only request, a no-material
brainstorm-to-objectives request, a topic clarification with multiple/custom
answers, and a material-based multi-question activity. The latter must reach
the requested checked count and load its preview; a partial result is evidence
for further work, not proof of completion.

## Runtime evidence

- Session `d0913fb31bb091c2180c5a43`: the configured provider returned three
  observable Newton-law objectives from an instructor brief with no material.
  The task ended at **Learning objectives ready**, with **From your teaching
  brief**, the no-calculus exclusion and visible assumptions. Editing the first
  objective through **Edit learning objectives → Save objectives** persisted the
  exact new text after a browser reload. No plan-approval or question-preview
  control appeared. The material-free LO result and real edit are verified.
- Session `f89f0760474075cd1787469e`: the unresolved-topic request rendered four
  concrete topic suggestions as checkboxes and a **Write my own answer** choice.
  Selecting Mechanics, Waves and the custom answer “Dimensional analysis and
  estimation” and clicking **Confirm and continue** submitted one canonical
  reply. The unsent composer draft remained unchanged. Continuation was correctly
  blocked by another active Studio job. The independent sequential case below
  verifies successful confirmation-to-objectives without that QA conflict.
- Session `2079bffdac94826218cffbfc`: with no other paid job active, selecting
  Motion and kinematics, Forces and Newton’s laws, and the custom answer
  “Dimensional analysis and estimation” then clicking **Confirm and continue**
  submitted one canonical reply and automatically produced four measurable
  objectives. The composer draft remained unchanged through confirmation and
  the later real objective edit. Editing the first objective and choosing
  **Save objectives** persisted the exact new text; the task stayed at
  **Learning objectives ready** without planning or generating questions.
  The visible user message lists objective text, not internal record IDs.
  Screenshot: `output/studio-autonomous-qa/confirmed-topics-edited-objectives.png`.
- Session `7796e15399306d5dae6df3ee`: the initial material-based 15-question test
  stopped to ask a topic despite selected processed notes and an all-topics
  request. This is a failed acceptance case: requirement assessment had material
  labels without actual content. Fix the scoped reading bridge before repeating
  the request; this attempt generated no question plan or questions.
- Session `e2eede809f63aa79bdc0bcb8`: after the requirement-reading bridge fix,
  one material-based request produced six measurable objectives, a 15-question
  plan and generation without manual approval. The visible material judgment
  identified the PDF as lecture notes inferred from sampled text and disclosed
  the sampled scope. Automatic recovery retained 13, then 14 checked questions.
  The final blocked slot had a correct rounded answer of 3.20; the feedback
  writer supplied a subtly wrong long-decimal claim. The server correctly
  rejected that claim. Feedback formulas now receive server-computed values;
  legacy false claims and false prose equalities retain the strict verifier.
  A subsequent retry was interrupted by a development-server restart caused by
  a test-file edit during QA. The existing lease recovery correctly stopped
  rather than replaying the uncertain call. The fresh case below supersedes
  this interrupted acceptance attempt.
- Session `5a7e9feaace58bbbbcb3c7a5`: with runtime and tests frozen, one initial
  request completed in **3m 52s**, with no manual approval, message or retry.
  The only authoring run has kind `create` and status `succeeded`. The workflow
  performed one automatic continuation, reused 14 checked questions and reached
  **15 checked questions · Saved**. The owned Quiz and accepted version snapshot
  both contain 15 distinct published questions. Fifteen distinct task IDs and
  source links survived persistence; all selected task excerpts match the owned
  processed lecture notes. Full read operations recorded ranges 0–6000 and
  6000–7220; the brief honestly describes its separate sampled evidence set.
  The actual H5P preview loaded through a relative same-origin API URL, displayed
  all 15 questions and produced 1/1 on an actual first-question response.
  Screenshot: `output/studio-autonomous-qa/fresh-15-checked-preview.png`.
  Read-only inspection also caught a quantity-parser omission for the literal
  hyphenated phrase `15-question`; the generated plan was correct, but the
  independent durable count requirement was missing. The guarded parser fix
  now preserves that exact quoted request as count 15, with refusal, historical
  mention, ranges and relative/replayed increments covered by focused tests.
  Original task history was not rewritten to conceal that omission.
- Session `9c4f2646fd5ebd5762010ad0`: a Chart request included a visible time
  axis title unsupported by the installed native type. Its saved review
  observations explain the rejection. Refresh now displays **Activity check
  stopped** with the teaching-requirement cause rather than an unrelated model
  configuration message. Stored history and review gates were preserved.
- The official Hub was reloaded and its native blue controls and colored icons
  were visually verified. Screenshot: `output/studio-autonomous-qa/native-hub-colors.png`.

The fresh 15-question case establishes the complete generation and preview
path for this material and request. It is not a guarantee that every model
output or future question will pass; bounded failures still retain progress
and require an honest diagnosis.

## Final verification

- Arithmetic, feedback review, semantic review, persistence, item repair and
  generation recovery: six focused suites, 223 checks passed.
- Teaching quantity, continuation and planning: three focused suites, 234
  checks passed. A separate bounded probe confirmed hyphenated quantities,
  exact quotes, negation/history, ranges and idempotent relative increments.
- Native failure display and owner/version-safe projection: three focused
  suites, 110 checks passed.
- Product-help retrieval: 148 checks passed, including direct confirmation,
  objective-first authoring, actual edits, diagnosis and navigation protection.
- Workspace and Studio actions: 70 frontend checks passed; production build
  passed. Unsaved objective/assumption text blocks task or editor navigation;
  cancelling or reverting edits restores navigation. The browser confirmed that
  **New task** retained an actual unsaved objective field and its current task.
- Type capability and strategy contracts retain the existing course/native
  boundaries. Shared orchestration is separate from type-specific validation;
  focused strategy tests cover registration, synchronous/asynchronous hooks and
  class receiver state. This does not claim real generation of every installed
  native type in this acceptance run.
- Final source syntax and `git diff --check` passed. Generated QA screenshots
  remain local under `output/studio-autonomous-qa/`.
