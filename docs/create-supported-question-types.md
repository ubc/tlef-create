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
12. Sort Paragraphs (`sort-paragraphs`)
13. Crossword (`crossword`)
14. Branching Scenario (`branching-scenario`)
15. Documentation Tool (`documentation-tool`)

## Temporarily Hidden from Generate Questions

These question types still have partial code and/or H5P export support in the codebase, but they are not currently exposed in user-facing question type dropdowns:

1. Free Text (`free-text`)
2. Open Ended (`open-ended`)
3. Simple Multi Choice (`simple-multi-choice`)
4. Dictation (`dictation`)
5. Arithmetic Quiz (`arithmetic-quiz`)
6. Question Set (`question-set`)

They were hidden because their current generation/export/rendering behavior is not reliable enough for users. Keeping the underlying code in place makes it easier to revisit them later without breaking historical data.

Question Set is a container export format rather than a normal single question type. It should be selected as a target container, not generated as one question inside a quiz.

## Interactive Book Export Notes

Interactive Book 1.11 stores each page as `H5P.Column 1.18`. That means the practical child-content support is inherited from Column, not defined directly by Interactive Book.

The currently reliable CREATE-generated Interactive Book child question types are:

1. Multiple Choice (`multiple-choice`)
2. True/False (`true-false`)
3. Fill in the Blank / Cloze (`cloze`)
4. Mark the Words (`mark-the-words`)
5. Ordering (`ordering`)
6. Matching (`matching`)
7. Single Choice Set (`single-choice-set`)
8. Essay (`essay`)
9. Flashcard (`flashcard`)
10. Summary (`summary`)
11. Discussion (`discussion`)
12. Documentation Tool (`documentation-tool`)

Several of these are exported through equivalent H5P content libraries:

- Discussion exports as Text (`H5P.AdvancedText 1.1`).
- Summary exports as Accordion (`H5P.Accordion 1.0`).
- Flashcard exports as Dialog Cards (`H5P.Dialogcards 1.9`).
- Ordering and Matching export through Drag the Words (`H5P.DragText 1.10`).
- Documentation Tool exports as Documentation Tool (`H5P.DocumentationTool 1.8`).

Other CREATE-supported question types may need dedicated H5P library mapping and parameter conversion before they can be safely embedded inside Interactive Book.

The underlying `H5P.Column 1.18` semantics allow a much wider set of content libraries:

1. Accordion (`H5P.Accordion 1.0`)
2. Agamotto (`H5P.Agamotto 1.6`)
3. Audio (`H5P.Audio 1.5`)
4. Audio Recorder (`H5P.AudioRecorder 1.0`)
5. Fill in the Blanks (`H5P.Blanks 1.14`)
6. Chart (`H5P.Chart 1.2`)
7. Collage (`H5P.Collage 0.3`)
8. Course Presentation (`H5P.CoursePresentation 1.26`)
9. Dialog Cards (`H5P.Dialogcards 1.9`)
10. Documentation Tool (`H5P.DocumentationTool 1.8`)
11. Drag and Drop (`H5P.DragQuestion 1.14`)
12. Drag the Words (`H5P.DragText 1.10`)
13. Essay (`H5P.Essay 1.5`)
14. Guess the Answer (`H5P.GuessTheAnswer 1.5`)
15. Table (`H5P.Table 1.2`)
16. Text (`H5P.AdvancedText 1.1`)
17. Iframe Embedder (`H5P.IFrameEmbed 1.0`)
18. Image (`H5P.Image 1.1`)
19. Image Hotspots (`H5P.ImageHotspots 1.10`)
20. Find the Hotspot (`H5P.ImageHotspotQuestion 1.8`)
21. Image Slider (`H5P.ImageSlider 1.1`)
22. Interactive Video (`H5P.InteractiveVideo 1.27`)
23. Link (`H5P.Link 1.3`)
24. Mark the Words (`H5P.MarkTheWords 1.11`)
25. Memory Game (`H5P.MemoryGame 1.3`)
26. Multiple Choice (`H5P.MultiChoice 1.16`)
27. Questionnaire (`H5P.Questionnaire 1.3`)
28. Question Set (`H5P.QuestionSet 1.20`)
29. Single Choice Set (`H5P.SingleChoiceSet 1.11`)
30. Summary (`H5P.Summary 1.10`)
31. Timeline (`H5P.Timeline 1.1`)
32. True/False (`H5P.TrueFalse 1.8`)
33. Video (`H5P.Video 1.6`)
34. Multimedia Choice (`H5P.MultiMediaChoice 0.3`)

This broad Column list should not be treated as a promise that CREATE can safely generate and export every type. Complex container-like types still need explicit exporter support and real-player validation.

## Question Set Export Notes

Question Set 1.20 is a quiz container. It supports fewer child types than Column because it is designed around quiz-question navigation, scoring, and result pages.

The underlying `H5P.QuestionSet 1.20` semantics allow these child libraries:

1. Multiple Choice (`H5P.MultiChoice 1.16`)
2. Drag and Drop (`H5P.DragQuestion 1.14`)
3. Fill in the Blanks (`H5P.Blanks 1.14`)
4. Mark the Words (`H5P.MarkTheWords 1.11`)
5. Drag the Words (`H5P.DragText 1.10`)
6. True/False (`H5P.TrueFalse 1.8`)
7. Essay (`H5P.Essay 1.5`)
8. Multimedia Choice (`H5P.MultiMediaChoice 0.3`)

CREATE currently has verified Question Set export support for:

1. Multiple Choice (`multiple-choice`)
2. True/False (`true-false`)
3. Fill in the Blank / Cloze (`cloze`)
4. Mark the Words (`mark-the-words`)
5. Essay (`essay`)

Essay is explicitly supported by `H5P.QuestionSet 1.20` via `H5P.Essay 1.5` and is implemented in CREATE's Question Set exporter.

Drag the Words is supported by H5P Question Set through `H5P.DragText 1.10`, but CREATE does not currently expose it as a dedicated user-facing question type. The current `ordering` and `matching` exports also use `H5P.DragText` internally, but they should be validated separately before being documented as stable Question Set support.

## Implementation Notes

- The Generate Questions dropdown is defined in `src/components/generation/PlanEditor.tsx`.
- The Review & Edit Add Question modal dropdown is defined in `src/components/AddQuestionModal.tsx`.
- Default system prompt templates are initialized from:
  - `routes/create/services/promptTemplateInitializer.js`
  - `routes/create/scripts/initializeSystemPrompts.js`
- The hidden types were removed from the exposed question creation options and default prompt template allowed lists.
- The backend schema, preview, and export code still retain the hidden types for historical compatibility and future work.
