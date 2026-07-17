# AI Blueprint and Question Generation

The AI Blueprint converts learning objectives into an editable generation plan. Planning first makes question count, purpose, type compatibility, and coverage visible before the model creates full questions.

## Automatic question count

Automatic length is the default. CREATE begins with at least one question for every learning objective. It estimates additional coverage from each objective's subpoint breadth, Bloom level, and the selected teaching purpose. One question usually samples one or two closely related subpoints, and the automatic estimator caps its initial recommendation at five questions per objective and 100 questions overall.

The recommendation is deterministic input to the Blueprint, not a random number produced only by the language model. The model proposes rows within that budget, and CREATE rebalances the rows to preserve learning-objective coverage.

## Set a fixed question count

Turn off automatic recommendation to enter a whole-number total. The minimum equals the number of learning objectives because every objective must receive at least one question. The maximum is 100. CREATE distributes a fixed total across objectives according to subpoint breadth and Bloom level; it does not simply give every objective the same count.

If the learning object already contains questions, the Blueprint also receives a compressed history so it can prefer uncovered objectives and focus areas. The fixed total describes the new plan, not a guarantee that older questions will be removed.

## Teaching purposes

- **Support Learning:** practice, recall, scaffolding, and feedback. Automatic budgeting can add practice interactions for objectives with several subpoints.
- **Assess Understanding:** scored evidence that learners achieved the objectives, with assessment-oriented types.
- **Gamify Learning:** interaction and variety. Automatic budgeting can add an interaction where an objective has multiple subpoints.

The teaching purpose limits the question types initially proposed by AI. Delivery format compatibility is a separate constraint; a type must satisfy both.

## Delivery target and format

Choose **H5P Package** to download a standard `.h5p` package for a compatible player, or **Canvas LTI** to publish through CREATE's Canvas player. H5P Package then offers Column, Interactive Book, Question Set, or Standalone. Canvas LTI uses Mixed Activity.

Formats support different question types. Changing target or format can make current Blueprint rows or existing questions incompatible. Read the warning before confirming a change because incompatible content may be removed.

## Read and edit Blueprint rows

Each row normally connects a question type, learning objective, count, pedagogical intent, Bloom level, difficulty, focus area, and rationale. Expand Blueprint details to see why the row was recommended. Edit rows when the type is unsuitable, the focus duplicates another row, or the difficulty does not match the learners.

Choose **No Learning Objective** only for an intentionally custom activity. That row must include a non-empty Custom Prompt so CREATE has enough task context. The custom prompt is saved with the Blueprint and used during question generation; a row with neither a valid objective nor a custom prompt cannot be saved or generated.

The sum of row counts is the number of questions to generate. Keep at least one planned question per objective. A row count represents repeated generation from that row's configuration; subpoint alignment can split one recommendation into more focused rows.

## One-time instructions

Additional instructions affect the current Blueprint or generation request. Use them for audience, terminology, scenario constraints, exclusions, tone, or required emphasis. Do not paste API keys, student records, or other sensitive data. Course prompts are the better place for reusable behavior.

## Generate questions

After approving the Blueprint, start generation and keep the page open while progress events stream. Questions are generated in the Blueprint order. CREATE provides the objective, focus area, relevant evidence, and a compressed memory of existing questions to reduce repeated stems, scenarios, answer patterns, and misconceptions.

CREATE saves the current Blueprint before starting generation. If that save fails, generation stops before existing questions are replaced or new generation begins. Correct the incomplete row or the validation message, save again, and then retry generation.

Generation can still produce incorrect or weak content. Always complete Review & Edit before using or exporting the result.

## Regenerate without duplication

Regeneration should target a different subpoint or framing and receives recent question history. Add a concise instruction when the desired difference is specific, such as a new scenario, a higher Bloom level, or a misconception that has not been tested. Verify the result; duplication avoidance reduces repetition but cannot guarantee uniqueness.
