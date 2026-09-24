# Review, Edit, and Export

Step 4, **Review**, is the required human quality-control stage after generation. A question can be grounded in a source and still be ambiguous, inaccurate, too easy, or unsuitable for the intended learners. Step 5, **Preview & Export**, separates the learner-facing experience and delivery actions from question editing.

## Review order and completeness

Questions appear in the generation plan order. Review all generated items, including any added or regenerated questions. Check the prompt, answer key, distractors, explanation, hint, feedback, objective, source evidence, and compatibility with the selected target.

After checking the full set, choose **All Objectives**, save or cancel any open edits, and click **Mark review complete** in Review. The Review step changes from an exclamation mark to a check. The exclamation mark means the saved questions still need instructor confirmation; it does not mean CREATE found an error in every question. You may open Preview before confirming, but the learning object remains marked as needing review. Adding, editing, deleting, regenerating or reordering questions, or publishing a new generation batch, reopens Review so the changed set can be checked again. If the button is disabled, use the message beside it to clear a filter or unresolved draft.

## Cancel edits and delete questions

**Cancel** discards the current question's unsaved changes, including options, feedback and explanations, and restores its saved version immediately. **Save** keeps the changes. Deleting a question opens a confirmation dialog; cancel that dialog to retain the question.

## Recovered unsaved edits

Open question edits remain available when you switch workflow tabs or leave and return to a Learning Object in the same browser session. They are kept in memory and cleared when you sign out or change accounts, so save them before refreshing, closing the page, or signing out; the browser warns when unsaved Review edits are present. These local edits are separate from saved AI generation tasks, which can recover after a refresh.

If another batch publishes or a question is removed while you are editing, **Recovered unsaved edits** keeps your draft outside the saved question list. It is not included in learner previews or exports. **View recovered content** shows the question, nested options, feedback, answer and explanation. **Copy draft** copies this content; **Download draft** saves a JSON recovery file to keep before a refresh.

**Save as new question** adds the recovered content with a new question ID and retains its objective when that objective still exists. It does not overwrite the retired question. Review the newly saved question and its evidence before export: recovery is a manual addition and does not recreate AI source grounding. If the current layout does not support the type or its original objective was removed, copy or download the draft and use Add Question with a compatible type and current objective. Failed recovery keeps the draft available; check the saved list before retrying when the result is unconfirmed. **Discard edits** asks for confirmation before removing the recovery copy.

## Reorder questions

Use **Move up** or **Move down** on a question card in Review. Each successful move saves the new order automatically. Select **All Objectives** and finish or cancel any question edit first; moving is disabled while a filtered subset or edit is active. If saving fails, the existing order stays in place and an error appears.

## Multiple-choice answer modes

**Single answer** allows one correct option. **Multiple answers** allows two or more correct options and exports as an H5P multiple-choice activity with multiple correct choices. Make the wording clear when learners must select more than one answer.

Answer-level fields can include a hint shown before checking, feedback shown when an option is selected, and feedback shown when it is not selected. Test the complete feedback experience, not only the correct-answer marker.

New AI multiple-choice drafts with option feedback receive an additional AI feedback check before saving. It checks answer consistency and calculations, and each explanation must match its original option and answer flag. CREATE adds the selected/not-selected verdict from that answer flag, so leaving an incorrect option unselected receives the appropriate feedback. A rejected answer is not silently replaced with a different answer key; refine the instructions and regenerate. For explicitly declared ordinary arithmetic, CREATE also calculates the expressions locally and rejects false equalities, division by zero or unsupported expressions before saving. This covers bounded numeric arithmetic, not all mathematical prose, symbolic algebra or the truth of course premises. An empty calculation list is not evidence that mathematics was verified. This extra check adds generation time and model usage and can still miss errors, so instructor review remains required. It does not rewrite older saved questions automatically.

## Add or regenerate a question

The Add Question dialog follows the current delivery target and format compatibility. AI Generate uses the selected objective plus optional one-time instructions. Manual mode lets you enter content directly. Regeneration replaces or supplements content according to the action shown in the interface, so re-check the answer key and evidence afterward.

Material-grounded regeneration retrieves current evidence and saves its source references with the new question. Failed retrieval stops the replacement and preserves the original question. Intentionally custom-prompt-only questions retain that mode and their instructions when regenerated.

**AI Generate** in Add Question waits for the actual saved result, including feedback checks that take longer than 30 seconds. Its controls are locked while generation runs. A successful result refreshes the list and closes the form. If you refresh or navigate away, the saved task is recovered automatically without repeating the AI request. If CREATE says the result is unconfirmed, use Check task status after reconnecting because the original request may still finish. If it says **Question Saved** but the list could not refresh, refresh the page instead of generating a duplicate.

When you select an objective and enter **Custom Prompt**, the prompt narrows the task. Specify the scenario, required facts, or exclusions; novelty guidance should stay within those constraints. The multiple-choice feedback check also checks whether the draft follows that request. An instruction-check failure saves no new question; your instructions remain available to refine and retry. Always check the final topic yourself because AI checks can still miss a mismatch.

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

Before downloading, CREATE checks declared runtime files and dependencies. Missing required assets stop the export with an explanation instead of producing an incomplete package. Branching Scenario is available again with the upgraded native runtime and editor. Test each branch and ending before delivery, and verify the package in your target H5P host.

Open **Preview & Export** to check the questions using CREATE's shared H5P review engine. Column and Mixed Activity load the minimal H5P core and question libraries once, then render each question with its actual H5P controls in the same page. Standalone types can appear alongside other questions because they are separate runnable instances, not children of an official H5P Column. Question Set and Interactive Book retain their container previews.

**Advanced H5P Editor** opens an independent Studio draft using the official H5P runtime. Studio edits do not automatically update CREATE questions. The same native H5P builder is still used for package export and Studio conversion. Preview does not create a saved Studio item.

## PDF and Markdown export

PDF and Markdown exports can include questions only, answers only, or a combined version. Use questions-only for a learner handout and answers/combined for review or facilitation. These are snapshots: edits made after download require a new export.

PDF uses an embedded font for common mathematical symbols and keeps a question together when it fits on a page. Long questions may continue onto another page. Check the downloaded document before printing, especially for scripts outside the font's supported range. PDF and Markdown avoid adding a second option letter when a complete sequential A/B/C list already has labels.

PDF exports preserve the learner-facing content for every supported type. Mark the Words includes the statement without revealing the marked answers; Fill in the Blank uses printed blank lines instead of internal `$$` markers; Single Choice Set includes every subquestion and option; Documentation Tool includes its pages and response fields; Summary includes its knowledge points; and Essay includes the essay topic. Answer and combined exports add the corresponding answer or instructor-review guidance.

## Canvas export

Canvas export opens the Canvas connection and destination workflow. It requires a valid Canvas connection and appropriate permissions. Canvas LTI supplies the secure Canvas launch, learner identity and grade-return boundary. CREATE's Mixed Activity player supplies the learner rendering. The course Preview runs without requiring Canvas. Canvas delivery uses its own launch path with LTI authentication and grade passback; check the deployed activity separately when comparing it with the course Preview. This is different from uploading a standard H5P package into Canvas.

## If export fails

Confirm the learning object contains questions, the selected types are compatible, and the Canvas connection is active when applicable. Retry once after saving recent edits. If the failure persists, report the target, format, export type, visible error, and the question type that was being exported.


## Recover an AI question addition

An AI addition in Review uses a saved generation task. You can refresh or return to the learning object while it runs; **Generation task status** checks its result without repeating the AI request. A question appears in the saved list only after the full task succeeds. A failed or interrupted task preserves existing questions. If status is unavailable, restore your connection and choose **Check task status** before trying to generate again.
