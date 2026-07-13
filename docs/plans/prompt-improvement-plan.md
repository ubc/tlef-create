# Prompt Improvement Plan

## Purpose

This document captures the current AI prompt problems in CREATE and proposes a staged plan for improving prompt quality and prompt controls.

The main motivation comes from the issue list already recorded in:

- [bug-summary.md](/Users/fanhaocheng/tlef-create/tlef-create/docs/plans/bug-summary.md)

## Main Problems To Solve

### 1. Repetitive question variants

Observed behavior:

- When a user asks for multiple multiple-choice questions for one learning objective, the system may generate nearly the same question stem multiple times.
- Sometimes only the wrong answers change while the assessed concept stays identical.

Why this matters:

- poor pedagogical variety
- inflated quiz length without increasing coverage
- lower trust in AI-generated questions

### 2. Large learning objectives are not sliced well

Observed behavior:

- If one learning objective contains multiple assessable sub-topics, the system often keeps generating broad questions instead of focusing on one sub-skill at a time.

Example from issue notes:

- A learning objective covering anthropogenic sources of `CO2`, `CH4`, and `N2O` should be sliceable into smaller assessable targets, but the system keeps asking the same broad question.

Why this matters:

- broad questions repeat easily
- question difficulty becomes inconsistent
- content coverage becomes shallow

### 3. Weak coverage guarantees

Observed behavior:

- It is not clear how CREATE ensures that generated questions cover the intended materials and learning objectives well.
- Current behavior appears to rely on the model inferring coverage from the learning objective and retrieved content, but there is no explicit coverage strategy.

Why this matters:

- some content may be over-assessed
- some content may never be assessed
- instructor expectations are harder to satisfy

### 4. Prompt is not configurable enough

Observed behavior:

- Instructors want more control over generation, such as:
  - focus on a page or section
  - use a specific misconception for distractors
  - use a specific option style
  - emphasize a specific content area

Why this matters:

- current prompt only supports a general `additionalInstructions` field
- important pedagogical constraints are not structured

## Current Prompt Architecture

There are currently two different prompt layers that should be treated separately.

### Layer A: AI plan generation prompt

Purpose:

- decide question distribution across learning objectives and question types

Main code entry points:

- [planController.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/controllers/planController.js)
- [promptTemplateInitializer.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/services/promptTemplateInitializer.js)

Current behavior:

- a system template is selected by pedagogical approach
- learning objectives and materials are injected into a distribution prompt
- the LLM returns a `planItems` JSON object

Current limitation:

- the plan prompt thinks mainly in terms of counts and types
- it does not reason deeply about sub-skill slicing or coverage intent

### Layer B: question generation prompt

Purpose:

- generate the actual question content for one question

Main code entry point:

- [llmService.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/services/llmService.js)

Current behavior:

- builds one prompt for a single question
- includes:
  - learning objective or custom prompt
  - relevant content chunks
  - difficulty
  - previous question texts to avoid duplication

Current limitation:

- duplication prevention is too weak
- prompt does not require explicit sub-skill selection
- prompt does not require explicit coverage reasoning
- prompt does not support structured instructor controls

## Diagnosis Of Why Repetition Happens

### Cause 1: duplication guard is text-only

The current question-generation prompt mostly avoids duplication by listing previous `questionText` strings.

Why this is weak:

- same idea can be paraphrased
- same LO slice can be reused with different wording
- same stem can be regenerated with different distractors

### Cause 2: no explicit "choose one slice" step

The model is told to generate a question for a learning objective, but not forced to pick a specific sub-skill when the objective is broad.

Effect:

- the model defaults to broad, summary-style question stems
- those broad stems are easy to repeat

### Cause 3: no explicit coverage ledger

The prompt does not ask the model to track what has already been assessed across previous questions.

Effect:

- the model has no internal checklist of covered sub-topics
- repeated focus areas are common

### Cause 4: distractor strategy is under-specified

The prompt says to create plausible distractors, but does not require:

- distinct misconception categories
- contrast between distractors
- evidence that distractors target different misunderstandings

Effect:

- distractors can feel shallow or repetitive

## Prompt Improvement Strategy

The plan is to strengthen prompt behavior in layers instead of trying to solve everything with one giant prompt edit.

## Phase 1: Improve question-generation prompt quality

### Goal

Reduce repetition and improve coverage without changing the UI yet.

### Prompt strategy changes

- Require the model to identify the specific sub-skill or sub-topic it is assessing before generating the question.
- Require the model to avoid previously assessed sub-skills, not only previously used wording.
- Require the model to generate one question that targets a narrow slice of the learning objective when the objective is broad.
- For multiple-choice questions, require distractors to represent different misconception types.

### Example conceptual additions

- `Select one specific assessable sub-skill from the learning objective.`
- `Do not reuse a sub-skill, scenario, or conceptual contrast already covered by previous questions.`
- `If the learning objective contains multiple components, assess only one component unless the prompt explicitly requires synthesis.`
- `For multiple-choice questions, each incorrect option must reflect a different misconception or reasoning error.`

### Expected impact

- fewer repeated stems
- narrower and more varied questions
- better multiple-choice quality

## Phase 2: Improve plan-generation prompt quality

### Goal

Generate better distributions before question generation starts.

### Prompt strategy changes

- Ask the plan model to identify whether each learning objective is broad or narrow.
- Ask it to allocate multiple questions across different conceptual slices when an LO is broad.
- Encourage balanced coverage instead of only proportional counts.

### Example conceptual additions

- `If a learning objective contains multiple assessable components, distribute questions so different components can be covered across the set.`
- `Prefer conceptual diversity within each learning objective when assigning repeated question counts.`

### Expected impact

- better diversity at the plan level
- less repetition before the question-generation step even begins

## Phase 3: Add structured instructor controls

### Goal

Support more precise prompt customization than free-form text alone.

### Candidate controls

- focus section or page
- target misconception
- distractor style
- scenario style
- coverage emphasis
- question tone or formality

### Likely implementation direction

- extend generation request schema
- keep `additionalInstructions` as fallback
- inject structured controls into prompt in a stable format

## Phase 4: Add observability and evaluation

### Goal

Make prompt improvements measurable.

### Candidate checks

- repeated concept rate across a generation batch
- repeated stem similarity
- LO coverage diversity
- distractor distinctness review

### Why this matters

- prompt changes are otherwise hard to evaluate reliably
- without measurement, regressions are easy to miss

## Suggested Implementation Order

1. Update the question-generation prompt in `llmService.js`
2. Improve duplication instructions beyond `previousQuestions`
3. Add explicit sub-skill selection behavior
4. Improve multiple-choice distractor instructions
5. Update plan-generation templates in `promptTemplateInitializer.js`
6. Add support for structured prompt controls in API and frontend later

## Detailed Execution Plan

### Step 1: Rewrite the question prompt instructions

Files:

- [llmService.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/services/llmService.js)

Tasks:

- strengthen prompt instructions for novelty
- require narrow assessment scope for broad LOs
- add explicit coverage and sub-skill guidance
- improve multiple-choice distractor instructions

### Step 2: Expand previous-question context

Files:

- [llmService.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/services/llmService.js)

Tasks:

- stop relying on raw question text alone
- include stronger anti-duplication framing
- optionally include summarized concept-focus metadata later

### Step 3: Improve plan prompt templates

Files:

- [promptTemplateInitializer.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/services/promptTemplateInitializer.js)
- [planController.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/controllers/planController.js)

Tasks:

- revise pedagogical approach templates
- encourage conceptual diversity within the same LO
- improve distribution guidance for broad learning objectives

### Step 4: Prepare for prompt controls

Files likely affected later:

- frontend AI config components
- generation request payloads
- backend prompt builders

Tasks:

- define a stable schema for instructor controls
- decide which controls belong in plan generation vs question generation

## Proposed Prompt Principles

These principles should guide future prompt edits.

### Principle 1: Assess one thing clearly

A question should usually assess one narrow idea unless synthesis is intentional.

### Principle 2: Track conceptual novelty, not just wording novelty

Different wording is not enough if the assessed concept is still the same.

### Principle 3: Distinguish coverage from quantity

More questions do not automatically mean better assessment coverage.

### Principle 4: Make distractors pedagogically meaningful

Wrong answers should reveal different misunderstandings, not just random incorrectness.

### Principle 5: Prefer stable structure over ad hoc free-text instructions

As more controls are added, they should become structured inputs rather than ever-growing free-text notes.

## Risks

### Risk 1: Prompt becomes too long

If too many constraints are added at once, the model may become less reliable or more verbose.

Mitigation:

- prioritize the highest-impact constraints first
- keep JSON output instructions simple and clear

### Risk 2: Over-constraining harms creativity

If novelty rules are too rigid, the model may generate awkward or overly narrow questions.

Mitigation:

- test against both narrow and broad LOs
- prefer "target one slice when appropriate" instead of "always target one tiny fact"

### Risk 3: Plan prompt and question prompt drift apart

If the plan layer and question layer follow different assumptions, the resulting behavior may be inconsistent.

Mitigation:

- document both layers together
- update both prompt systems intentionally

## Validation Scenarios

The improved prompt system should be tested against cases like these.

### Scenario 1: Broad LO with multiple assessable components

Expected behavior:

- questions spread across different components instead of repeating a broad synthesis question

### Scenario 2: Requesting five multiple-choice questions on one LO

Expected behavior:

- question stems are not near-duplicates
- distractors vary by misconception type

### Scenario 3: Limited material context

Expected behavior:

- prompt still generates usable questions without hallucinating too much unsupported specificity

### Scenario 4: Instructor guidance present

Expected behavior:

- custom instructions influence output in a stable and visible way

## Not In Scope For This Document

- full UI design for prompt customization controls
- implementation of answer-level multiple-choice feedback
- markdown export
- content preview and section picker UX

Those should be tracked in separate plans.

## Suggested Next Plan Documents

- `multiple-choice-feedback-plan.md`
- `export-format-plan.md`
- `materials-preview-plan.md`

