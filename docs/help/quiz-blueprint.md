# AI Blueprint and Question Generation

The AI Blueprint converts learning objectives into an editable generation plan. Planning first makes question count, purpose, type compatibility, and coverage visible before the model creates full questions.

Open Stage 3, **Generate**, after the Learning Object has assigned materials and at least one learning objective. The page guides you through the teaching purpose, activity format, question plan, and generation in that order.

Start with **Choose your teaching purpose**, then **Choose the student-facing layout**. Below these choices, use **AI Auto Mode** for an AI-proposed plan or **Manual Mode** to build your own Blueprint rows. Reusable prompt settings are collapsed under **Advanced: course prompts** so they do not interrupt the main setup.

## Automatic question count

Automatic length is the default. CREATE begins with at least one question for every learning objective. It estimates additional coverage from each objective's subpoint breadth, Bloom level, and the selected teaching purpose. One question usually samples one or two closely related subpoints, and the automatic estimator caps its initial recommendation at five questions per objective and 100 questions overall.

The recommendation is deterministic input to the Blueprint, not a random number produced only by the language model. The model proposes rows within that budget, and CREATE rebalances the rows to preserve learning-objective coverage.

## Set a fixed question count

Turn off automatic recommendation to enter a whole-number total. The minimum equals the number of learning objectives because every objective must receive at least one question. The maximum is 100. CREATE distributes a fixed total across objectives according to subpoint breadth and Bloom level; it does not simply give every objective the same count.

**Generate Plan** is unavailable while the count is empty, fractional or outside that range. Correct the visible value before submitting; CREATE does not silently substitute an older total.

If the learning object already contains questions, the Blueprint also receives a compressed history so it can prefer uncovered objectives and focus areas. The fixed total describes the new plan, not a guarantee that older questions will be removed.

## Teaching purposes

- **ASSESS — Assess understanding:** scored evidence that learners achieved the objectives, with assessment-oriented types.
- **SUPPORT — Support learning:** practice, recall, scaffolding, and feedback. Automatic budgeting can add practice interactions for objectives with several subpoints.
- **GAMIFY — Gamify learning:** interaction and variety. Automatic budgeting can add an interaction where an objective has multiple subpoints.

The teaching purpose limits the question types initially proposed by AI. Delivery format compatibility is a separate constraint; a type must satisfy both.

## Delivery target and format

Choose **H5P Package** to download a standard `.h5p` package for a compatible player, or **Canvas LTI** to publish through CREATE's Canvas player. H5P Package offers Question Set, Interactive Book, Column, and Standalone, in that order. **Question Set** is a scored quiz format which combines different types of questions in a sequence with text or video feedback. Canvas LTI uses Mixed Activity.

Formats support different question types. Changing target or format can make current Blueprint rows or existing questions incompatible. Read the warning before confirming a change because incompatible content may be removed.

## Visual layout previews

The **Choose the student-facing layout** cards provide a simple layout preview before generation:

1. **Question Set — A sequence of questions:** students move through questions, then see their score and feedback.
2. **Interactive Book — Chapters and pages:** a chapter menu organizes a structured, multi-page activity.
3. **Column — One scrolling page:** text and mixed activities are stacked vertically.
4. **Standalone — One focused activity:** a dedicated player for one Branching Scenario, crossword, or paragraph-sorting task. Standalone needs exactly one Blueprint row with a count of one; if CREATE shows a "Standalone needs one activity" message, remove extra rows before generating. A Branching Scenario is one activity with several decision paths and outcome screens, even when its teaching task spans several learning objectives. In its Blueprint row, choose a primary learning objective and optionally check other objectives to cover in the same scenario. **Layers** sets the decision depth; **Choices** sets the minimum choices at each decision. Final decisions may use more distinct options from the source, up to six. Review every path before sharing.

The black outline and check identify the selected card. These sketches explain navigation and structure; they are not screenshots of generated questions. Use Step 5, **Preview & Export**, to experience the actual saved content. Canvas LTI has a separate **Mixed Activity** layout and does not use the four H5P package layouts.

## Back to AI Plan Configuration

After questions have been generated, **Back to AI Plan Configuration** returns to the top of setup: **ASSESS / SUPPORT / GAMIFY**, followed by the visual layout selection. It opens AI Auto Mode and preserves the selected teaching purpose, layout, additional instructions, and existing questions. Blueprint rows are reconciled with the current saved question inventory, including edits made in Review.

Returning to configuration does not call AI, regenerate questions, or delete content. Generate a new plan only when you want new recommendations. A layout change is separate: CREATE first asks about incompatible plan rows, then asks before removing incompatible existing questions. Cancel either confirmation to leave the current layout and questions unchanged. Save the Blueprint to persist your configuration changes.

## Read and edit Blueprint rows

Each row normally connects a question type, learning objective, count, pedagogical intent, Bloom level, difficulty, focus area, and rationale. Expand Blueprint details to see why the row was recommended. Edit rows when the type is unsuitable, the focus duplicates another row, or the difficulty does not match the learners.

Choose **No Learning Objective** only for an intentionally custom activity. That row must include a non-empty Custom Prompt so CREATE has enough task context. The custom prompt is saved with the Blueprint and used during question generation; a row with neither a valid objective nor a custom prompt cannot be saved or generated.

The sum of row counts is the number of questions to generate. Keep at least one planned question per objective. A row count represents repeated generation from that row's configuration; subpoint alignment can split one recommendation into more focused rows.

After adding or deleting questions in **Review**, the left sidebar and Blueprint & Generate results use the current saved question inventory. Selecting **Back to AI Plan Configuration** reconciles the Question Plan counts and rows with those current questions while preserving matching row details such as focus and difficulty. Review the reconciled plan before generating again.

## One-time instructions

Additional instructions affect the current Blueprint or generation request. Use them for audience, terminology, scenario constraints, exclusions, tone, or required emphasis. Do not paste API keys, student records, or other sensitive data. Course prompts are the better place for reusable behavior.

## Generate questions

After approving the Blueprint, start generation. Live progress is optional: you can leave the tab or refresh, and CREATE checks the saved task automatically. Questions retain the Blueprint order when the completed batch is saved. CREATE provides the objective, focus area, relevant evidence, and a compressed memory of existing questions to reduce repeated stems, scenarios, answer patterns, and misconceptions.

CREATE saves the current Blueprint before starting generation. If that save fails, generation stops before existing questions are replaced or new generation begins. Correct the incomplete row or the validation message, save again, and then retry generation.

CREATE also checks assigned materials before replacing existing questions. Pending, failed or missing materials block material-grounded generation and leave existing questions in place. A deliberately selected custom-prompt-only row with non-empty instructions can generate without course evidence; merely having a Custom Prompt does not bypass the material check.

If any question exceeds the generation time limit or fails its checks, the batch is not published and the existing questions remain available. Check the saved task result before starting another generation.

Generation can still produce incorrect or weak content. Always complete Step 4, Review, before using or exporting the result.

On the results page, choose **Continue to Review** for the next step, or **Back to AI Plan Configuration** to revisit setup. **Generation Prompt Analysis** is collapsed by default; **Show Details** opens the technical information when needed.

## Regenerate without duplication

Regeneration should target a different subpoint or framing and receives recent question history. Add a concise instruction when the desired difference is specific, such as a new scenario, a higher Bloom level, or a misconception that has not been tested. Verify the result; duplication avoidance reduces repetition but cannot guarantee uniqueness.

## Explore more native H5P activities

Choose **Explore AI activities** below the Blueprint workflow to open Studio's **Create with AI** flow with this Quiz's saved objectives and questions as context. Use it for charts, presentations, media templates and other native types beyond the standard Quiz question picker. It creates an independent Studio draft, not additional Blueprint rows. Review and download that activity in Studio; the original Quiz, evidence references and question counts remain unchanged.


## Recover question generation and safely replace questions

**Generation task status** tracks the original generation after a refresh, lost connection, or reopened learning object. It never submits another AI generation just to recover status. The browser stores only an opaque request identifier for this recovery, not your teaching prompt. If the connection is unavailable, choose **Check task status** after reconnecting. Signing in again may be necessary after your session expires.

**Replace Existing Questions** keeps the saved questions visible in Review throughout generation. CREATE prepares the whole new batch first, then replaces the saved list only when every question succeeds. **Add New Questions** also publishes the whole batch together. A prepared draft or live text preview is not yet a saved question.

An open Review edit or recovered draft in this Learning Object disables **Replace Existing Questions**. Save, cancel, or resolve **Recovered unsaved edits** in Review before replacing the list; **Add New Questions** remains available. CREATE checks again just before starting in case you opened an editor while the Blueprint was saving. Edits in a different Learning Object do not block this one. If a batch already running elsewhere replaces the list, Review retains your local edits in the recovery area rather than saving them to retired question IDs. Save or download those edits before refreshing the page.

If any question fails, the server restarts and the task lease expires, or the saved content changes while generation is running, the batch is not published. **Saved questions preserved** explains the result. Review the existing content and explicitly start a new task when ready; CREATE does not automatically repeat a paid AI request after interruption. Recovery reports the existing task's result; it does not resume unfinished model work after a server restart.

Leaving the page does not cancel generation. There is no Stop Generation action until a server-side cancellation contract is available. Do not submit another task simply because live progress pauses. Course search, coverage, statistics and exports use the saved question list, not incomplete drafts.

## Close unregistered request

**Close unregistered request** appears only after the server reports that no saved task receipt exists for that request. It asks the server to close that unused request identifier so a delayed submission cannot start later, then allows you to submit a new request. It does not cancel an accepted generation task. If the original request was accepted meanwhile, CREATE returns its actual task and continues checking that result instead.
