# LO Slice Planning Plan

## Purpose

This document defines the first concrete implementation step for intelligent question generation:

- turn one learning objective into a set of candidate assessment slices
- use those slices to plan multiple non-redundant question tasks

This plan is a child plan of:

- [intelligent-question-generation-workflow-plan.md](/Users/fanhaocheng/tlef-create/tlef-create/docs/plans/intelligent-question-generation-workflow-plan.md)

## Why Start Here

The current repeated-question problem comes from a missing intermediate step.

Right now the system often does this:

1. receive one learning objective
2. ask the model to generate a question for it
3. repeat several times

What is missing:

- a planning step that says what each question should assess before generation begins

Without that step, even a good prompt can still produce:

- repeated broad questions
- repeated narrow questions on the same slice

## Scope

This plan only covers:

- detecting whether an LO is broad or narrow
- producing candidate slices for that LO
- converting slices into structured question tasks

This plan does not yet implement:

- batch coverage ledger
- similarity validator
- retry loop
- multi-agent behavior

## Core Idea

For one LO, the system should build a small internal representation like this:

- `originalLO`
- `breadth`
- `candidateSlices`
- `recommendedTaskSequence`

Example:

Original LO:

- `Describe the anthropogenic sources of carbon dioxide (CO2), methane (CH4), and nitrous oxide (N2O).`

Candidate slices:

- `CO2 anthropogenic sources`
- `CH4 anthropogenic sources`
- `N2O anthropogenic sources`
- `compare source patterns across gases`
- `distinguish anthropogenic vs natural sources`

Recommended task sequence for 5 MCQs:

- Task 1: `CO2 anthropogenic sources`
- Task 2: `CH4 anthropogenic sources`
- Task 3: `N2O anthropogenic sources`
- Task 4: `compare source patterns across gases`
- Task 5: `misconception check on source attribution`

## Desired Output Structure

The slice-planning layer should eventually return a structured object like:

```json
{
  "originalLO": "Describe the anthropogenic sources of carbon dioxide (CO2), methane (CH4), and nitrous oxide (N2O).",
  "breadth": "broad",
  "candidateSlices": [
    {
      "id": "co2_sources",
      "label": "CO2 anthropogenic sources",
      "kind": "component"
    },
    {
      "id": "ch4_sources",
      "label": "CH4 anthropogenic sources",
      "kind": "component"
    }
  ],
  "recommendedTasks": [
    {
      "sliceId": "co2_sources",
      "questionIntent": "source-identification"
    }
  ]
}
```

This is a conceptual target, not a final locked schema yet.

## Breadth Detection

The first question the planner should answer is:

- is this LO `narrow` or `broad`?

### Signals of a broad LO

- multiple enumerated components
- conjunction-heavy structure such as `A, B, and C`
- multiple verbs or multiple outcomes in one statement
- category + comparison + explanation all bundled together

Examples:

- `Describe the anthropogenic sources of CO2, CH4, and N2O.`
- `Explain the structure and function of carbohydrates, lipids, proteins, and nucleic acids.`

### Signals of a narrow LO

- one core concept
- one clear skill
- one well-bounded process or relationship

Example:

- `Explain why methane emissions are strongly associated with livestock agriculture.`

## Slice Types

Slices should not all be treated the same.

The planner should eventually support several slice categories.

### Component slices

Use when the LO lists multiple concepts or entities.

Examples:

- `CO2 sources`
- `CH4 sources`
- `N2O sources`

### Comparison slices

Use when multiple components can be meaningfully contrasted.

Examples:

- `compare CO2 and CH4 source patterns`
- `compare agricultural vs fossil-fuel-related emissions`

### Misconception slices

Use when the LO is suitable for common confusions.

Examples:

- `anthropogenic vs natural source confusion`
- `fertilizer-related emissions confused with methane`

### Application slices

Use when the LO can be grounded in case-based reasoning.

Examples:

- `identify which human activity mainly increases methane`

## Question-Type-Aware Task Planning

The planner should not produce the same task sequence for every question type.

### For multiple-choice

Good slice/task patterns:

- source identification
- comparison
- misconception discrimination

### For true/false

Good slice/task patterns:

- narrow claim validation
- misconception correction

### For matching

Good slice/task patterns:

- gas to source category mapping

### For summary

Good slice/task patterns:

- broader synthesis
- organized multi-slice explanation

This means the task planner needs both:

- LO slices
- question-type fit

## Recommended First Implementation Strategy

Do not start with a fully autonomous LLM planner.

Start with a hybrid approach:

### Step 1: Lightweight heuristic pre-processing

Use deterministic logic to detect obvious broad structures:

- comma-separated enumerations
- `and` / `or` joined components
- parenthetical abbreviations

This should catch many important educational cases cheaply.

### Step 2: Optional LLM-assisted slice extraction

If heuristics detect a broad LO, use the LLM to propose candidate slices in a structured format.

This is safer than asking the LLM to generate questions directly because:

- the task is narrower
- the output can be validated more easily

### Step 3: Deterministic task selection

Once slices are produced, use deterministic rules to choose a task sequence for the requested number of questions.

This helps avoid:

- random repetition
- overuse of one slice

## Proposed Backend Components

### 1. `loSlicePlanner` service

Responsibility:

- accept one LO and generation context
- return slice-planning output

Likely location:

- `routes/create/services/loSlicePlanner.js`

### 2. `questionTaskPlanner` helper

Responsibility:

- convert slices into question tasks for the requested count and question type

Likely location:

- same service at first, split later if needed

## Proposed Inputs

The first version should likely accept:

- `learningObjective`
- `questionType`
- `requestedCount`
- `courseContext`
- `relevantContent`

Optional future inputs:

- `additionalInstructions`
- `alreadyUsedSlices`
- `targetDifficulty`

## Proposed Outputs

First version should likely return:

- `breadth`
- `candidateSlices`
- `recommendedTasks`

Optional later:

- `reasoning`
- `confidence`
- `rejectedSlices`

## Integration Plan

### Current generation model

Today, the system effectively repeats question generation for the same LO.

### Target near-term integration

Before generating a batch of questions for a single LO:

1. call the slice planner
2. get candidate slices
3. build recommended tasks
4. generate each question from a selected task instead of the raw LO

This can happen before the validator and coverage ledger are introduced.

## Implementation Phases

## Phase 1: Define schema and add planning service

Goal:

- create the planning service and return stable structured output

Deliverables:

- service file
- output schema
- simple tests or fixtures

## Phase 2: Heuristic breadth detection

Goal:

- identify obvious broad LOs without needing an LLM call

Deliverables:

- heuristic rules
- broad/narrow classification

## Phase 3: LLM-assisted slice extraction

Goal:

- use the LLM to propose candidate slices when needed

Deliverables:

- prompt for slice extraction
- parser and validation logic

## Phase 4: Task sequencing by question type

Goal:

- turn slices into an ordered question task list

Deliverables:

- task-planning rules
- question-type-specific sequencing

## Phase 5: Connect to generation pipeline

Goal:

- use planned tasks in the actual generation path

Deliverables:

- integration with existing generation service

## Validation Scenarios

### Scenario 1: Broad enumerated LO

Input:

- `Describe the anthropogenic sources of CO2, CH4, and N2O.`

Expected:

- classified as `broad`
- produces at least three component slices
- recommended tasks rotate across slices

### Scenario 2: Narrow LO

Input:

- `Explain why methane emissions are associated with livestock agriculture.`

Expected:

- classified as `narrow`
- no unnecessary over-splitting

### Scenario 3: Broad LO with conceptual families

Input:

- `Explain the structure and function of carbohydrates, lipids, proteins, and nucleic acids.`

Expected:

- component slices for each biomolecule family
- possible comparison slices

## Risks

### Risk 1: Over-splitting

If every LO is broken too aggressively, question quality can become fragmented.

Mitigation:

- broad/narrow classification first
- allow narrow LO passthrough behavior

### Risk 2: Slice extraction becomes noisy

LLM-based slice proposals may be redundant or low quality.

Mitigation:

- validate and deduplicate slices after extraction
- start with constrained prompt format

### Risk 3: Integration grows too big

Trying to connect slice planning, ledger, validator, and retries all at once could slow delivery.

Mitigation:

- ship slice planning first
- add later workflow stages incrementally

## Recommendation Summary

The first real implementation step toward intelligent generation should be:

- add LO slice planning
- classify LO breadth
- create structured question tasks before generation

This is the smallest change that directly addresses the repeated-question problem seen in testing.
