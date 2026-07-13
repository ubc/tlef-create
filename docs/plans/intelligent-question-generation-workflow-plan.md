# Intelligent Question Generation Workflow Plan

## Purpose

This document proposes a workflow-based solution for improving AI question generation in CREATE.

The goal is to solve a core issue that prompt tuning alone does not fully solve:

- when multiple questions are generated from the same learning objective, the system produces questions that are too similar
- the system does not reliably split a broad learning objective into multiple assessable tasks
- the system does not actively manage coverage across a generation batch

## Problem This Workflow Is Designed To Solve

### Current failure mode

When the system is asked to generate multiple questions from one broad learning objective, it often behaves like this:

1. receive one broad learning objective
2. retrieve relevant materials
3. generate one question
4. repeat that same pattern several times

This creates two common bad outcomes:

- repeated broad questions
- repeated narrow questions on the same selected slice

### Example failure

Learning objective:

- `Describe the anthropogenic sources of carbon dioxide (CO2), methane (CH4), and nitrous oxide (N2O).`

Expected outcome for 5 questions:

- one question on `CO2`
- one on `CH4`
- one on `N2O`
- one comparative question
- one misconception-focused question

Actual outcome seen during testing:

- the system first repeated the whole broad LO
- after prompt improvement, it then repeated only the `CH4` slice

This shows that prompt improvements helped, but the system still lacks workflow-level coverage management.

## Recommendation

Do not jump directly to a heavy multi-agent architecture.

Instead, build a structured workflow with state.

This should act like an internal planning loop for generation:

1. analyze the learning objective
2. propose candidate slices
3. track used slices
4. generate one question at a time
5. validate for similarity
6. retry if needed

## Why Workflow Is Better Than More Prompt Alone

Prompt-only improvements can encourage better behavior, but they still depend on one generation call correctly reasoning about:

- slicing
- coverage
- novelty
- distractor quality

A workflow can enforce these steps explicitly.

This makes the system:

- more reliable
- easier to debug
- easier to extend
- easier to measure

## High-Level Workflow

### Stage 1: Learning Objective Analysis

Input:

- learning objective
- target question type
- relevant content
- requested number of questions

Output:

- LO type: `narrow` or `broad`
- candidate concept slices
- candidate misconception targets
- candidate comparison or application targets

Example output for the greenhouse gas LO:

- `CO2 anthropogenic sources`
- `CH4 anthropogenic sources`
- `N2O anthropogenic sources`
- `compare major source categories across gases`
- `distinguish anthropogenic vs natural sources`

### Stage 2: Question Task Planning

Input:

- candidate slices
- requested question count
- question type

Output:

- a list of question tasks for the batch

Example:

- Task 1: assess `CO2 sources` with multiple-choice
- Task 2: assess `CH4 sources` with multiple-choice
- Task 3: assess `N2O sources` with multiple-choice
- Task 4: compare `CO2 vs CH4`
- Task 5: misconception check on `fertilizers vs methane`

### Stage 3: Coverage Ledger

Purpose:

- maintain state during batch generation

Track items such as:

- used concept slices
- used scenarios
- used misconception categories
- used comparisons
- generated question texts

This becomes the memory for the batch.

### Stage 4: Generate One Question At A Time

Instead of asking for 5 questions at once, the system should:

1. choose the next planned task
2. inject the task into the generation prompt
3. generate exactly one question
4. attach generation metadata to it

The prompt for each question should no longer say only:

- `generate a question for this LO`

It should say something closer to:

- `generate a question for this specific planned slice`

### Stage 5: Similarity And Coverage Validation

After one question is generated, run a validator.

Checks can include:

- is the stem too similar to an existing question?
- is the assessed slice already covered?
- is the scenario too similar?
- for MCQ, are distractors distinct enough?

If validation fails:

- reject the question
- pick another slice or scenario
- regenerate

### Stage 6: Save Final Batch

Only after the full batch is assembled and validated should the questions be finalized and stored.

## Recommended Architecture

This does not need to be a full multi-agent system.

### Recommended first version

A single workflow service with multiple internal steps:

- `analyzer`
- `task planner`
- `coverage ledger`
- `question generator`
- `validator`

These can all be implemented in one backend pipeline first.

### Possible future version

If needed later, some stages can become specialized agents:

- `LO-slicing agent`
- `question-writing agent`
- `question-critique agent`

But this should come later, not first.

## How This Solves The Current Problem

### Problem

Five questions from one LO become too similar.

### Workflow fix

Because the workflow explicitly plans five different tasks first, each generation call starts from a different intended target.

So the system is no longer doing:

- `same LO -> same call pattern -> repeated question`

It becomes:

- `same LO -> different planned task -> different question target`

### Result

This should dramatically reduce:

- repeated stems
- repeated concept focus
- repeated scenario framing

## Interaction With Question Type

The workflow should consider not only the LO, but also the question type.

### Example

Same LO:

- `Describe the anthropogenic sources of CO2, CH4, and N2O.`

For `multiple-choice`, good tasks include:

- single-gas source identification
- compare two gases
- identify a misconception

For `matching`, good tasks include:

- match gas to source category

For `summary`, good tasks include:

- synthesize all major sources and contrasts

For `ordering`, that LO may be a weak fit, so fewer tasks should be assigned.

This means the workflow can help with:

- LO slicing
- question type suitability
- coverage planning

## Proposed Backend Components

### 1. LO Analysis Function

Responsibility:

- inspect LO
- extract candidate slices
- classify LO breadth

Possible location:

- new service under `routes/create/services/`

### 2. Batch Task Planner

Responsibility:

- create a structured task list for `N` questions

Possible location:

- new service or helper used by question generation

### 3. Coverage Ledger

Responsibility:

- store in-memory generation state for one batch

Track:

- used slices
- used misconceptions
- used scenarios
- rejected generations

### 4. Question Validator

Responsibility:

- detect near-duplicates
- detect repeated concept focus
- detect poor distractor diversity

### 5. Retry Controller

Responsibility:

- decide when to regenerate
- choose another slice or another framing

## Suggested Integration Points In Current Code

### Existing relevant files

- [llmService.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/services/llmService.js)
- [questionStreamingService.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/services/questionStreamingService.js)
- [intelligentQuestionGenerationService.js](/Users/fanhaocheng/tlef-create/tlef-create/routes/create/services/intelligentQuestionGenerationService.js)

### Likely integration path

#### Step 1

Introduce a planner stage before the per-question generation call.

#### Step 2

Change generation from:

- `repeat the same generation call N times`

to:

- `generate from a planned task list`

#### Step 3

Add a lightweight validator before saving each question.

## Implementation Phases

## Phase 1: Explicit LO Slice Planning

Goal:

- identify candidate slices for one LO

Deliverables:

- helper that turns broad LO into multiple question tasks

This phase alone would already help with the repeated-CH4 problem.

## Phase 2: Batch Coverage Ledger

Goal:

- maintain per-batch memory of used slices

Deliverables:

- in-memory ledger structure
- selection rule for next task

## Phase 3: One-Question-At-A-Time Generation

Goal:

- generate from task list, not directly from raw LO each time

Deliverables:

- updated orchestration path

## Phase 4: Validation Loop

Goal:

- reject near-duplicate or low-diversity questions

Deliverables:

- similarity checks
- retry mechanism

## Phase 5: Observability

Goal:

- understand whether workflow improves output

Deliverables:

- logs for chosen slices
- logs for rejected duplicates
- logs for coverage distribution

## Validation Criteria

The workflow should be considered successful if it improves these scenarios:

### Scenario 1: One broad LO, five MCQs

Expected:

- questions cover different slices
- repeated stems drop significantly

### Scenario 2: One broad LO, mixed question types

Expected:

- different types are matched to suitable sub-tasks

### Scenario 3: Narrow LO

Expected:

- workflow should not over-split
- it should still vary framing and misconceptions when possible

## Risks

### Risk 1: Too much complexity too early

Mitigation:

- start with one service and explicit stages
- do not build a multi-agent system first

### Risk 2: Latency increases

Mitigation:

- keep analysis and planning lightweight
- only retry when validation fails

### Risk 3: Over-splitting harms pedagogical quality

Mitigation:

- allow synthesis tasks when appropriate
- not every broad LO must be decomposed into only atomic facts

## Recommendation Summary

Recommended solution:

- build a workflow, not a heavy multi-agent system
- introduce slice planning, coverage memory, and validation

This is the most practical way to solve:

- repeated questions from the same LO
- weak LO decomposition
- lack of intelligent task splitting by question type

## Next Suggested Plan

After this document, the next implementation-oriented plan should likely be:

- `lo-slice-planning-plan.md`

That plan can define the first concrete coding step for this workflow.
