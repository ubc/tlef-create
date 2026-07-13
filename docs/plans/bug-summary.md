# Bug Summary

## Purpose

This document summarizes the bugs, improvement requests, and open product questions collected so far for CREATE.

It is based on the issue list provided in the conversation and is meant to serve as a stable reference before the work is split into implementation-specific plans.

## Status Legend

- `Fixed`: already reported as fixed
- `Bug`: broken or incorrect behavior
- `Functional improve`: an improvement to an existing workflow
- `Functional request`: a new or expanded capability
- `AI system optimize`: AI behavior, prompt, or content-quality issue
- `H5P bug`: export or H5P-specific content issue

## Current Bug and Request Inventory

### 1. Question variants repetitive

Category:

- `AI system optimize`

Problem summary:

- When the learning objective is precise and the user asks for multiple multiple-choice questions, the system may generate repeated question stems with only different distractors.
- When a learning objective contains multiple sub-topics, the system does not reliably narrow the scope and generate questions for only one slice of the learning objective.

Example noted:

- For a learning objective like describing anthropogenic sources of `CO2`, `CH4`, and `N2O`, the system keeps generating the same broad question instead of targeting only one gas at a time.

Likely area:

- question-generation prompt
- duplication control
- learning-objective slicing logic

### 2. Questions and learning objectives coverage

Category:

- `AI system optimize`

Problem summary:

- It is unclear how to ensure generated questions actually cover the intended content.
- The current assumption is that CREATE links learning objectives and materials correctly, but that coverage behavior is not transparent or guaranteed.

Likely area:

- retrieval logic
- prompt instructions
- coverage validation

### 3. AI prompt customization

Category:

- `AI system optimize`

Problem summary:

- The user wants more control over the question generator prompt.
- Desired controls include:
  - specific page or section of material
  - specific misconception to use for distractors
  - preferred option style
  - more detailed generation guidance

Likely area:

- prompt architecture
- UI for optional generation controls
- generation request schema

### 4. Preview content feature

Category:

- `Functional request`

Problem summary:

- It is unclear whether preview content means the full document or only part of it.
- The user wants a way to visualize and select the content CREATE should focus on.

Likely area:

- materials preview UX
- content selection workflow

### 5. Export format: more text-based export options

Category:

- `Functional request`

Problem summary:

- The user wants markdown or another text export format in addition to current exports.

Likely area:

- export controller
- export service layer
- export UI

### 6. Export format: include explanation panel in PDF solutions

Category:

- `Functional request`

Problem summary:

- The explanation panel that exists in the product should also appear in PDF export with solutions.

Likely area:

- PDF export formatting
- answer key layout

### 7. Feedback on multiple-choice question

Category:

- `Functional improve`

Problem summary:

- The user wants answer-level feedback, not only a general explanation.
- H5P multiple-choice supports feedback per answer, and CREATE should support this too.

Likely area:

- question data model
- review/edit UI
- question generation output format
- H5P export mapping

### 8. Regenerate questions with pedagogical re-selection

Category:

- `Functional improve`

Problem summary:

- When users regenerate questions, they may want to choose a different pedagogical approach instead of only regenerating the same pattern.
- The flow should redirect users back to the pedagogical approach options when appropriate.

Likely area:

- question generation flow
- AI Plan Configuration navigation

### 9. Materials limits and quality impact

Category:

- `AI system optimize`

Problem summary:

- The user wants to know how many files can be uploaded under Materials.
- The user also wants to know how file count affects generated question quality.

Likely area:

- product limits
- retrieval quality
- documentation

### 10. Unable to edit course name

Category:

- `Fixed`

Problem summary:

- Previously the course name could not be edited.

Current status:

- reported as fixed

### 11. Export H5P quiz with flashcards produces empty dialog cards

Category:

- `H5P bug`

Problem summary:

- When exporting a quiz composed of flashcards, the import on H5P Hub works, but the dialog cards are empty.
- PDF export works correctly.
- Optional flashcard explanation/feedback always starts with the same verb, `"Understanding..."`.

Likely area:

- H5P flashcard export mapping
- flashcard back/explanation content formatting

### 12. Adding learning objectives: "Generate from materials" does not load

Category:

- `Bug`

Problem summary:

- In the learning-objective creation flow, clicking `Generate from materials` does nothing.
- Other options such as `AI Classify` and `Add manually` still work.

Likely area:

- objective generation UI handler
- materials processing dependency
- loading state wiring

### 13. AI Plan Configuration page is hard to access after generation

Category:

- `Functional improve`

Problem summary:

- Users who want to regenerate H5P elements should be able to return to the pedagogical stream page and choose between:
  - Support Learning
  - Assess Understanding
  - Gamify Learning

Current understanding:

- This is the active issue now being planned under the `go back` workflow.

Likely area:

- `QuestionGeneration.tsx`
- view-state management
- generate-again UX

### 14. AI Plan Configuration page should list H5P elements per stream

Category:

- `Fixed`

Problem summary:

- It would be useful to show some H5P elements available for each stream.

Current status:

- reported as fixed

### 15. Add more quiz bug

Category:

- `Bug`

Problem summary:

- Reported in the source list, but no detailed description was included yet.

Action needed:

- collect exact reproduction steps
- define expected vs actual behavior

## Current Focus Areas We Have Already Started Planning

### Focus A: Go back to AI Plan Configuration

Status:

- planning in progress

Related document:

- [go-back-plan.md](/Users/fanhaocheng/tlef-create/tlef-create/docs/plans/go-back-plan.md)

### Focus B: Improve system prompt

Status:

- analyzed at a high level
- not yet split into implementation plan

### Focus C: Support more export formats

Status:

- identified as a future implementation track
- not yet split into implementation plan

### Focus D: Feedback on multiple-choice question

Status:

- identified as a future implementation track
- not yet split into implementation plan

## Suggested Next Planning Breakdown

To keep the work manageable, these issues should eventually be split into separate implementation plans.

### Recommended plan files to add later

- `prompt-improvement-plan.md`
- `multiple-choice-feedback-plan.md`
- `export-format-plan.md`
- `materials-preview-plan.md`
- `learning-objective-generation-plan.md`
- `h5p-flashcard-export-plan.md`

## Open Gaps In The Bug Inventory

The following items still need more detail before implementation planning:

- `Add more quiz bug`
- exact reproduction steps for `Generate from materials`
- exact expected behavior for content preview and content selection
- preferred first new export format after PDF and H5P
- desired UX for prompt customization controls

## Notes

This file is intentionally broad and descriptive.

Implementation details for individual issues should go into separate plan documents once one issue is selected for active work.
