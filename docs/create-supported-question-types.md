# CREATE Supported Question Types

This document records the question types currently exposed in the CREATE question creation flows.

## Currently Exposed to Users

The Generate Questions page and Review & Edit Add Question modal currently allow users to select these question types:

1. Multiple Choice (`multiple-choice`)
2. True/False (`true-false`)
3. Flashcard (`flashcard`)
4. Summary (`summary`)
5. Discussion (`discussion`)
6. Matching (`matching`)
7. Ordering (`ordering`)
8. Fill in the Blank / Cloze (`cloze`)
9. Mark the Words (`mark-the-words`)
10. Single Choice Set (`single-choice-set`)
11. Essay (`essay`)
12. Question Set (`question-set`)
13. Sort Paragraphs (`sort-paragraphs`)
14. Crossword (`crossword`)
15. Branching Scenario (`branching-scenario`)
16. Documentation Tool (`documentation-tool`)

## Temporarily Hidden from Generate Questions

These question types still have partial code and/or H5P export support in the codebase, but they are not currently exposed in user-facing question type dropdowns:

1. Free Text (`free-text`)
2. Open Ended (`open-ended`)
3. Simple Multi Choice (`simple-multi-choice`)
4. Dictation (`dictation`)
5. Arithmetic Quiz (`arithmetic-quiz`)

They were hidden because their current generation/export/rendering behavior is not reliable enough for users. Keeping the underlying code in place makes it easier to revisit them later without breaking historical data.

## Interactive Book Export Notes

Interactive Book export has a narrower stable subset than CREATE generation. The currently reliable Interactive Book child question types are:

1. True/False
2. Multiple Choice / Question
3. Single Choice Set
4. Mark the Words
5. Fill in the Blank / Cloze
6. Ordering
7. Matching
8. Essay

Other CREATE-supported question types may need dedicated H5P library mapping and parameter conversion before they can be safely embedded inside Interactive Book.

## Implementation Notes

- The Generate Questions dropdown is defined in `src/components/generation/PlanEditor.tsx`.
- The Review & Edit Add Question modal dropdown is defined in `src/components/AddQuestionModal.tsx`.
- Default system prompt templates are initialized from:
  - `routes/create/services/promptTemplateInitializer.js`
  - `routes/create/scripts/initializeSystemPrompts.js`
- The hidden types were removed from the exposed question creation options and default prompt template allowed lists.
- The backend schema, preview, and export code still retain the hidden types for historical compatibility and future work.
