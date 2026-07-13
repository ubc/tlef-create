# Go Back Plan

## Context

This document captures the current bug context and the implementation plan for restoring a safe "go back to AI Plan Configuration" flow in CREATE.

The goal is to avoid losing the original problem framing while we implement the fix.

## Related Issues Collected So Far

### Original bug report themes

- Users want to go back and access the AI Plan Configuration page after questions have already been generated.
- Users may want to regenerate with a different pedagogical approach instead of only regenerating the same style of questions.
- Current state management is fragile when moving backward in the generation flow.
- The product needs a clear rule for what should happen to existing generated questions after the user goes back and changes the plan.

### Broader issue list from the notes

- Question variants can become repetitive.
- The system may not break a large learning objective into smaller assessable slices.
- Prompt quality and prompt controls need improvement.
- More export formats are desired.
- Multiple-choice questions need answer-level feedback, not only a general explanation.
- Regeneration flow should better support changing pedagogical approach.

## What We Know From the Current Code

### Frontend behavior

In `src/components/generation/QuestionGeneration.tsx`, once questions exist, the component returns the generated-results view early.

That means:

- users can no longer access `AIConfigPanel`
- users can no longer access `PlanEditor`
- the flow becomes one-way after generation

### Current regeneration behavior

There is already a "Regenerate All Questions" action.

Current behavior:

- ask for confirmation
- delete all existing questions
- generate again

This is too destructive for the new "go back" use case because users may only want to revise the plan first and decide later whether to keep or replace existing questions.

## Product Decision We Discussed

### Recommended behavior

Going back should be a navigation action, not a destructive data action.

When a user goes back:

- return them to AI Plan Configuration and Plan Editor
- keep existing generated questions for now
- do not delete questions automatically

When the user tries to generate again after modifying the plan:

- ask whether to add new questions or replace existing questions

### Why this is safer

- users do not lose work by accident
- state transitions become easier to reason about
- destructive behavior happens only after explicit confirmation
- the product supports both "supplement existing quiz" and "start over" workflows

## Proposed User Flows

### Flow A: Add new questions

User intent:

- keep existing generated questions
- add more questions using the updated plan

System behavior:

- preserve existing questions
- generate new questions based on the current plan
- append them to the quiz

### Flow B: Replace existing questions

User intent:

- discard the old generated set
- generate a fresh set from the new plan

System behavior:

- delete existing questions only after confirmation
- generate a new set using the updated plan

## Scope For This Plan

This document only covers the "go back" feature.

It does not yet implement:

- prompt redesign
- multiple-choice answer-level feedback
- new export formats

Those should be tracked in separate plan documents later.

## Implementation Plan

### Phase 1: Stabilize the product behavior

#### Goal

Define explicit UI states instead of relying on `hasQuestions` alone.

#### Tasks

- Introduce a view state for the question generation page.
- Separate "plan/config view" from "results view".
- Stop using question existence as the only condition that determines the entire screen.
- Add a visible "Go back to plan" action in the generated-results view.

#### Expected outcome

Users can return to the plan/configuration screen even after question generation has completed.

### Phase 2: Add a safe regeneration decision point

#### Goal

Prevent accidental deletion or accidental mixing of old and new generation runs.

#### Tasks

- Detect when a quiz already has generated questions and the user tries to generate again.
- Show a confirmation dialog with two explicit choices:
  - Add new questions
  - Replace existing questions
- Keep cancel behavior available.

#### Expected outcome

The user must intentionally choose how the new generation interacts with existing questions.

### Phase 3: Refactor generation flow logic

#### Goal

Make the question generation path consistent for both add and replace flows.

#### Tasks

- Extract generation start logic into a reusable path.
- Extract replacement logic so deletion is only triggered in replace mode.
- Ensure save-plan behavior still runs before generation.
- Ensure question counts and notifications remain correct in both modes.

#### Expected outcome

The flow is easier to maintain and less likely to break when more generation options are added later.

### Phase 4: Validate state transitions

#### Goal

Make sure the UI and data stay consistent when moving between generated results and plan editing.

#### Tasks

- Verify plan state is preserved when leaving and returning to config view.
- Verify AI config state is preserved.
- Verify existing questions are still shown if the user returns to results without regenerating.
- Verify add mode appends questions correctly.
- Verify replace mode deletes and regenerates correctly.

#### Expected outcome

Backward navigation no longer causes confusing or destructive state behavior.

## Key Engineering Risks

### Risk 1: UI state and data state remain coupled

If the page still derives its entire mode from `questions.length > 0`, the "go back" fix will be unstable.

### Risk 2: Replace flow becomes too implicit

If deletion still happens deep inside the old regenerate path without a clear mode variable, the new UX will be brittle.

### Risk 3: Add mode creates ambiguous totals

If existing question counts and newly planned counts are not communicated clearly, users may be confused about what "Generate 10 Questions" means when 12 already exist.

## Open Decisions

These should be confirmed before implementation details are finalized.

### Decision 1

Should the default action in the confirmation dialog be "Add new questions" or should there be no default emphasized choice?

Current recommendation:

- no destructive default
- visually emphasize the safer option

### Decision 2

Should the generated-results screen continue to be the first screen shown when questions already exist, or should we remember the last sub-view the user selected?

Current recommendation:

- start with existing behavior plus a working "Go back to plan" button
- do not add persistent sub-view memory until the flow is stable

## Suggested Next Execution Order

1. Add explicit view state to `QuestionGeneration.tsx`
2. Add "Go back to plan" action
3. Add generate-again decision modal
4. Split add vs replace generation logic
5. Test state transitions

## Phase 1 Checklist

This checklist is for the first implementation pass only.

The goal of Phase 1 is to restore safe backward navigation without changing question-deletion behavior yet.

### Checklist

- [ ] Add a dedicated UI view state in `QuestionGeneration.tsx`
- [ ] Limit that view state to navigation concerns only
- [ ] Stop using `hasQuestions` as the only determinant of the whole page view
- [ ] Keep the streaming early-return behavior unchanged
- [ ] Replace the generated-results early return with a conditional branch based on the new view state
- [ ] Preserve the existing default behavior where quizzes with generated questions initially open in the results view
- [ ] Ensure the default view decision runs only during initialization, not on every render
- [ ] Add a visible `Go back to plan` action in the generated-results view
- [ ] Ensure `Go back to plan` only changes the UI view and does not trigger any data mutation
- [ ] Ensure `Go back to plan` does not clear `planItems`
- [ ] Ensure `Go back to plan` does not clear `aiConfig`
- [ ] Ensure `Go back to plan` does not clear `planMode`
- [ ] Ensure `Go back to plan` does not clear `deliveryTarget`
- [ ] Ensure `Go back to plan` does not clear `targetFormat`
- [ ] Ensure question generation completion explicitly returns the UI to the results view
- [ ] Ensure `restoreSettings()` does not unintentionally overwrite a user-triggered view change
- [ ] Ensure reloading questions does not force the page back to the results view unless explicitly intended

### Phase 1 Validation Scenarios

- [ ] A quiz with no questions opens in the plan/configuration view
- [ ] A quiz with existing questions opens in the results view
- [ ] After generation completes, the user sees the results view
- [ ] The user can click `Go back to plan` and access AI Plan Configuration
- [ ] The user can still see their existing plan configuration after going back
- [ ] The user can return to the results view without losing previously generated questions
- [ ] Refreshing the page still behaves correctly for a quiz that already has generated questions

### Not Included In Phase 1

- [ ] No question deletion confirmation flow yet
- [ ] No `Add new questions` vs `Replace existing questions` decision modal yet
- [ ] No refactor of regeneration semantics yet
- [ ] No prompt or export changes yet

## Out Of Scope For This Document

- prompt improvement strategy
- answer-level multiple-choice feedback
- markdown or other new export formats
- learning objective slicing logic

These should be documented separately after the go-back flow is stable.
