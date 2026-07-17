# Review, Edit, and Export

Review & Edit is the required human quality-control step after generation. A question can be grounded in a source and still be ambiguous, inaccurate, too easy, or unsuitable for the intended learners.

## Review order and completeness

Questions appear in the generation plan order. Review all generated items, including any added or regenerated questions. Check the prompt, answer key, distractors, explanation, hint, feedback, objective, source evidence, and compatibility with the selected target.

## Multiple-choice answer modes

**Single answer** allows one correct option. **Multiple answers** allows two or more correct options and exports as an H5P multiple-choice activity with multiple correct choices. Make the wording clear when learners must select more than one answer.

Answer-level fields can include a hint shown before checking, feedback shown when an option is selected, and feedback shown when it is not selected. Test the complete feedback experience, not only the correct-answer marker.

## Add or regenerate a question

The Add Question dialog follows the current delivery target and format compatibility. AI Generate uses the selected objective plus optional one-time instructions. Manual mode lets you enter content directly. Regeneration replaces or supplements content according to the action shown in the interface, so re-check the answer key and evidence afterward.

## Inspect question evidence

Open a question's evidence graph to trace the question to its learning objective, relevant subpoint, source material, and cited excerpt. Select an evidence node to preview its source. Evidence should support both the question and the correct answer; a topically related excerpt is not sufficient.

## Pre-export checklist

- No duplicate or near-duplicate questions remain.
- Every correct answer is defensible from the cited source or intended course knowledge.
- Distractors are plausible but unambiguously incorrect.
- Wording, accessibility, and reading level fit the audience.
- Feedback does not reveal an answer too early.
- Coverage Map shows the intended balance across objectives and materials.
- Every question type is supported by the selected target and format.

## H5P export

H5P export creates a downloadable `.h5p` package. Column and Interactive Book support mixed content, Question Set supports a smaller assessment-oriented subset, and Standalone is for one complex activity type. A Canvas LTI/Mixed Activity learning object can contain types that are not valid in one downloadable H5P package; CREATE warns before an H5P export from that configuration.

## PDF and Markdown export

PDF and Markdown exports can include questions only, answers only, or a combined version. Use questions-only for a learner handout and answers/combined for review or facilitation. These are snapshots: edits made after download require a new export.

## Canvas export

Canvas export opens the Canvas connection and destination workflow. It requires a valid Canvas connection and appropriate permissions. Canvas LTI uses CREATE's player for Mixed Activity content; this is different from uploading a standard H5P package into Canvas.

## If export fails

Confirm the learning object contains questions, the selected types are compatible, and the Canvas connection is active when applicable. Retry once after saving recent edits. If the failure persists, report the target, format, export type, visible error, and the question type that was being exported.
