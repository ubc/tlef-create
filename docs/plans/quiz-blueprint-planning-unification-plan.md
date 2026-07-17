# Quiz Blueprint Planning Unification Plan

## Purpose

This plan describes how CREATE should unify AI-generated quiz planning, manual quiz planning, and review-time question adding around one shared planning model.

The goal is to support the pedagogical streams already used by the product:

- Support Learning
- Assess Understanding
- Gamify Learning

At the same time, the plan must stay compatible with the current CREATE infrastructure:

- existing learning objectives
- existing AI plan generation flow
- existing manual `PlanEditor`
- existing question type capability filtering
- existing delivery target and H5P package format constraints
- existing review and edit workflow

## Core Product Problem

CREATE currently has overlapping ways to decide quiz structure:

- AI-generated plan
- manually added plan rows
- review and edit add-question flow

These paths do not always use the same rules.

That creates several user-facing problems:

- supported question types can differ between Generate Questions and Review & Edit
- manual add can feel disconnected from pedagogical streams
- AI planning currently expects the user to provide the total question count
- the system does not consistently explain why a quiz has a certain number of questions, difficulty mix, or question type mix
- changes to delivery target or H5P package format can make existing questions incompatible

## Product Direction

CREATE should treat quiz planning as a blueprint problem.

Instead of asking the user to directly decide every question type and count first, the system should help create a `Quiz Blueprint`.

The blueprint is the shared middle layer between:

- course materials
- learning objectives
- pedagogical intent
- Bloom level
- difficulty
- delivery format compatibility
- H5P question type support
- final generated questions

## Recommended User Flow

### Step 1: Choose Delivery Constraints

The user chooses:

- Delivery Target
- H5P Package Format or Canvas LTI format

These choices define the allowed question type set.

The existing `questionTypeCapabilities.ts` should remain the source of truth for this filtering.

### Step 2: Choose Teaching Purpose

The user chooses one pedagogical stream:

- Support Learning
- Assess Understanding
- Gamify Learning
- Mixed

This stream should influence the recommended blueprint, but it should not bypass delivery target compatibility.

### Step 3: Generate Suggested Blueprint

The user can ask CREATE to generate a suggested plan.

The important product change:

- the user should not be required to manually choose total question count first
- CREATE should calculate a deterministic recommendation from LO subpoints, Bloom level, and the selected pedagogical stream
- the LLM should choose question types, difficulty, focus areas, and rationale within that fixed budget
- the user can still override the total count if they want

### Step 4: Review And Adjust Blueprint

The user sees an editable plan table.

The table should support:

- learning objective
- pedagogical intent
- Bloom level
- difficulty
- question type
- answer mode when relevant
- count
- rationale or short explanation

Manual add should add a blueprint row, not bypass the blueprint model.

### Step 5: Generate Questions

Question generation uses the approved blueprint.

Each generated question should inherit:

- LO target
- planned focus area
- pedagogical intent
- Bloom level
- difficulty
- question type
- delivery compatibility metadata

## How To Decide Question Count

CREATE should use a hybrid model.

### Default Behavior

CREATE calculates the total number of questions before calling the LLM. The same LO metadata and pedagogical stream must produce the same budget.

The first budget version uses these rules:

- every LO receives at least one question
- one question can cover one or two closely related subpoints
- Apply, Analyze, Evaluate, and Create receive one additional evidence opportunity
- Support Learning and Gamify Learning can receive one additional practice interaction when an LO has enough subpoints
- automatic recommendations are capped at five questions per LO and 100 questions per quiz
- subpoints are grouped across focus areas so none are silently omitted

### User Override

The user can still override:

- total question count
- count per row
- difficulty balance
- question type distribution

If the user supplies a total, the system preserves that total and deterministically scales per-LO allocations according to relative LO complexity. The teacher can still edit individual rows after the plan is returned.

### Backward Compatibility

The AI plan endpoint accepts optional `totalQuestions`:

- if `totalQuestions` is provided, distribute that exact total using the deterministic LO weights
- if `totalQuestions` is omitted, calculate a recommended total before the LLM call
- send an authoritative per-LO budget to the LLM
- validate and rebalance the LLM response against the budget
- return the budget method, allocation rationale, and prompt provenance to the UI

## How To Decide Question Type

Question type should be selected by intersecting three rule sets:

1. delivery target and package format compatibility
2. pedagogical stream suitability
3. Bloom level and interaction pattern suitability

### Example

For `Assess Understanding`:

- multiple choice
- multiple answer
- true/false
- fill in the blank
- essay
- single choice set

For `Support Learning`:

- flashcard
- dialog-style cards
- multiple choice with rich feedback
- fill in the blank
- mark the words
- summary

For `Gamify Learning`:

- matching
- ordering
- crossword
- sort paragraphs
- branching scenario
- drag/drop-style interactions if supported later

The final available list must still be filtered by delivery target and H5P package format.

## How To Decide Difficulty

Difficulty should be derived from Bloom level and material complexity.

Recommended mapping:

- easy: remember, identify, define, recognize
- moderate: understand, explain, classify, compare
- hard: apply, analyze, evaluate, synthesize

The LLM should be allowed to recommend difficulty distribution, but the user should be able to edit it.

## Proposed Blueprint Shape

This is a conceptual model, not a required final implementation.

```ts
type QuizBlueprintItem = {
  id: string;
  learningObjectiveId: string;
  pedagogicalIntent: 'support' | 'assess' | 'gamify';
  focusArea?: string;
  bloomLevel?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  difficulty: 'easy' | 'moderate' | 'hard';
  questionType: string;
  count: number;
  selectionMode?: 'single' | 'multiple';
  rationale?: string;
  compatibilityStatus?: 'compatible' | 'incompatible';
};
```

## Compatibility With Existing Data

The current frontend `PlanItem` can be extended instead of replaced immediately.

Current fields:

- `id`
- `type`
- `learningObjectiveId`
- `count`
- `selectionMode`
- `branchingLayers`
- `branchingChoices`
- `customPrompt`
- `useCustomPromptOnly`

Recommended additive fields:

- `pedagogicalIntent`
- `focusArea`
- `bloomLevel`
- `difficulty`
- `rationale`
- `compatibilityStatus`

This keeps existing generation paths working while allowing richer planning.

## Compatibility With Existing Backend

The current `GenerationPlan` model can be extended instead of replaced immediately.

Recommended additive fields:

- `recommendedTotalQuestions`
- `totalQuestionStrategy`
- `blueprintItems`
- `coverageSummary`
- `compatibilityWarnings`
- `generationMetadata.reasoning`

The existing `breakdown` and `distribution` fields can continue to exist for older flows.

## Delivery Target And Format Changes

If the user changes Delivery Target or H5P Package Format after a plan or questions already exist, CREATE should run a compatibility check.

### If all existing question types are compatible

Allow the change with no destructive warning.

### If some existing question types are incompatible

Show a warning before applying the change.

The warning should explain:

- which question types are no longer supported
- how many existing plan rows or generated questions are affected
- whether CREATE can replace them with compatible alternatives

Recommended user choices:

- Keep old format
- Change format and remove incompatible questions
- Change format and convert incompatible questions where possible

## Manual Add Should Use The Same Rules

Manual add should not have a separate question type list.

It should use:

- current delivery target
- current target format
- pedagogical intent mapping
- `questionTypeCapabilities.ts`

If the user chooses a pedagogical stream first, manual add should default to question types suitable for that stream.

The user can still pick any compatible type if advanced controls are shown.

## Review And Edit Add Question

Review and edit should also use the same compatibility source.

The add-question modal should receive:

- delivery target
- target format
- pedagogical stream
- existing blueprint if available

This prevents the mismatch where Review & Edit shows more question types than Generate Questions.

## UI Optimization Strategy

The current UI is already large, so this should be introduced progressively.

### Phase 1 UI

Keep the current layout, but improve the plan table.

Add only:

- teaching purpose selector
- optional "Let CREATE recommend quiz length" toggle
- difficulty column
- Bloom level column hidden behind details or advanced mode
- plan rationale in expandable summary

### Phase 2 UI

Add a compact blueprint summary above the table:

- total recommended questions
- coverage by LO
- difficulty mix
- pedagogical mix
- incompatible type warnings

### Phase 3 UI

Add advanced editing:

- focus area per row
- Bloom level editing
- plan explanation
- source/reference coverage

## AI Plan Prompt Changes

The AI plan prompt should no longer decide the question budget. It should receive an authoritative total and per-LO allocation, then design the blueprint within those constraints.

It should return:

- plan items
- LO coverage explanation
- rationale for difficulty distribution
- rationale for question type choices
- warnings if the requested delivery format limits ideal pedagogy

It should consider:

- broad vs narrow LOs
- concept slices
- existing quiz history
- material types
- problem sets if available
- delivery format constraints

## Question History For De-Duplication

The plan generator and question generator should receive compact quiz history.

The history should include:

- existing question stems
- covered focus areas
- covered LOs
- used scenarios
- used misconception targets
- used answer option patterns

The prompt should ask the LLM to avoid:

- repeating the same focus area
- using the same stem pattern
- generating another question that differs only by distractors
- overusing one concept slice from a broad LO

## Source References

Because CREATE users are instructors, question references should be visible in the review UI.

Each generated question should ideally store:

- material id
- material name
- source file
- chunk index
- short evidence excerpt
- relevance score if available

This does not need to block the blueprint work, but the blueprint should be designed to support it.

## Implementation Phases

### Phase 1: Unify Capability Filtering

Goal:

- make AI plan, manual add, and review add use one question type capability source

Tasks:

- centralize delivery target and target format filtering
- ensure Review & Edit add-question uses the same allowed type list as Generate Questions
- keep `questionTypeCapabilities.ts` as the first source of truth

### Phase 2: Extend Plan Item Shape

Goal:

- add blueprint metadata without breaking existing flows

Tasks:

- add optional `pedagogicalIntent`
- add optional `bloomLevel`
- add optional `difficulty`
- add optional `focusArea`
- add optional `rationale`

### Phase 3: Make Total Questions Optional And Deterministic

Goal:

- allow LLM to recommend quiz length

Tasks:

- update frontend AI config so total question count can be automatic
- update backend validation so `totalQuestions` can be omitted
- calculate `recommendedTotalQuestions` from LO subpoints and Bloom level
- constrain and validate the AI response against exact per-LO allocations
- preserve old behavior when user supplies a total

### Phase 4: Add Blueprint Summary UI

Goal:

- make the generated plan easier to understand

Tasks:

- show recommended total
- show LO coverage
- show difficulty distribution
- show pedagogical distribution
- show compatibility warnings

### Phase 5: Add Compatibility Warnings On Format Change

Goal:

- protect users from silently losing incompatible questions

Tasks:

- detect unsupported plan rows
- detect unsupported generated questions
- show warning before applying target format changes
- offer remove or convert behavior

### Phase 6: Add History-Aware Planning

Goal:

- reduce repeated questions across generate and regenerate flows

Tasks:

- summarize existing quiz questions
- pass summary to AI plan generation
- pass summary to question generation
- store focus area metadata for future de-duplication

## Open Product Decisions

### Decision 1: Should the user still see a total question input?

Recommended answer:

- yes, but it should become optional
- default should be "Let CREATE recommend"

### Decision 2: Should manual add expose Bloom level immediately?

Recommended answer:

- not in the default compact UI
- show it in details or advanced mode

### Decision 3: Should AI be allowed to choose unsupported ideal question types?

Recommended answer:

- no for final plan items
- yes only in rationale as "ideal but unavailable"

### Decision 4: Should incompatible questions be auto-converted?

Recommended answer:

- only when conversion is safe
- otherwise ask the user

## Success Criteria

This work is successful if:

- AI plan and manual add use the same question type compatibility rules
- review add-question no longer shows unsupported extra types
- users can let CREATE recommend quiz length
- users can override the recommendation
- generated plans explain why they chose the number, type, and difficulty mix
- changing delivery target or package format warns about incompatible existing questions
- repeated question generation improves because history and focus areas are passed into planning

## Implementation Status

Implemented first version:

- AI plan total question count is optional.
- CREATE deterministically recommends total and per-LO counts from subpoint breadth, Bloom level, and teaching purpose.
- The backend rebalances LLM output to the authoritative budget if the model changes counts or omits an LO.
- Subpoints are grouped into plan focus areas so every subpoint remains represented even when one question covers two related points.
- The Blueprint summary explains each LO allocation and shows whether the active prompt came from a course override, user default, or system default.
- `PlanItem` now supports difficulty, Bloom level, focus area, pedagogical intent, and rationale.
- AI plan prompt requests blueprint metadata for every row.
- Manual plan rows can edit difficulty, Bloom level, focus area, and rationale in a compact details panel.
- Saved quiz plan items preserve blueprint metadata.
- Question generation receives blueprint metadata and uses it as prompt context.
- Generated questions store blueprint metadata in `generationMetadata`.
- Review & Edit shows focus, Bloom level, pedagogical intent, source evidence, and generation rationale.
- Delivery target and H5P package format compatibility warnings are preserved.
- Compact question history is passed into both planning and generation.
- History is bounded: recent stems remain explicit while older questions are compressed into coverage statistics.
- Generated candidates are withheld from SSE until planned-slice and novelty validation pass.
- Overly similar candidates are retried up to three times and store their novelty diagnostics in question metadata.
- Novelty diagnostics now include both lexical similarity and embedding cosine similarity when FastEmbed is available.
- Auto LO regeneration can change the natural objective count instead of forcing the previous count.
- Auto LO generation first builds an instructional material profile so recommended LO and question counts reflect recovered source sections and assessable skill clusters rather than model guesswork alone.
- GPT-5-family streaming uses the active user model and official Responses API events when applicable.

Future hardening:

- Add safe auto-conversion rules for incompatible question types instead of only replacing with fallback.
- Add editable pedagogical intent per row if instructors need mixed-stream blueprints inside one quiz.
- Add coverage-aware warnings directly inside the Plan Summary.
- Persist AI blueprint summary/rationale as quiz metadata instead of UI state only.
