# Learning Objectives

Learning objectives describe what students should be able to do after completing the learning object. They also define the minimum units of coverage used by the AI Blueprint.

## Generate objectives from materials

Assign and finish processing the relevant materials first. Leave the instruction box blank to ask CREATE for a complete, non-overlapping set, or add a focus, constraints, audience, desired level, or objectives that must be retained. CREATE analyzes document structure, evidence breadth, and Bloom's taxonomy before recommending objectives.

Generation is a draft, not approval. Check every objective against the intended curriculum and the source material.

## Understand the generation log

The **Live generation log** explains what CREATE is doing before model text appears. It first resolves generation settings, reads the assigned material chunks, builds a source inventory, groups related sections into instructional clusters, and cleans document noise into a teaching-focused digest. The log reports safe aggregate results such as section, chunk, cluster, and topic counts; it does not display course source text or private model reasoning.

When drafting starts, the same log adds a **Live model draft** section. After the draft returns, CREATE checks whether the required source sections are covered and may run a targeted repair pass before saving the objectives. A long preparation stage does not by itself mean generation is stuck, but an error event in the log identifies the stage that needs attention.

GPT-5 models use one output budget for both internal reasoning and the visible objective JSON. CREATE reserves a larger budget for these models. If OpenAI reports that the first request exhausted that budget before completing the draft, CREATE clears the incomplete draft and retries once with more room. If the retry also stops, check the visible error, try a processed-material subset, or select another configured model rather than repeatedly submitting the same request.

## Add existing or manual objectives

Paste existing objectives into the generation instructions when you want the model to preserve or refine a provided set. Use **Add Manually** when wording must be stored exactly as entered. Manual entry is also useful when a required objective is not stated explicitly in the uploaded material.

When objectives already exist, select **Add New** to open the complete manual editor. Enter the objective text, optionally select Remember, Understand, Apply, Analyze, Evaluate, or Create, and add, edit, or remove custom subpoints before saving. The new objective is not written to the course until **Add Learning Objective** succeeds. Editing an existing objective opens the same fields.

An objective should use an observable verb and describe one coherent outcome. Avoid objectives that only say “understand” without showing what learners will demonstrate.

## Subpoints

Subpoints divide a broad objective into smaller assessable slices. They help the automatic question budget estimate breadth, help the Blueprint allocate focus areas, and help generation avoid repeatedly testing the same fact.

Related details can share a subpoint, but unrelated skills should usually become separate objectives. More subpoints can increase the automatic recommendation; they should represent meaningful coverage, not an attempt to force a larger quiz.

## Bloom level and difficulty

Bloom level describes the cognitive action expected by the objective. Higher-order levels such as apply, analyze, evaluate, and create can add coverage pressure to the automatic question recommendation. Difficulty is configured again at the Blueprint row because an objective can be assessed at more than one difficulty.

## Evidence and enrichment

Generated objectives already include source references and generation metadata, so they do not show a separate Enrich action. A manually added objective can be enriched from assigned materials; enrichment adds relevant metadata and references without replacing an instructor-entered Bloom level or instructor-entered subpoints.

Use the **AI Enrich** action beside a manually created objective when only that LO should be enriched. Enrichment keeps the objective wording and manual Bloom/subpoints. Regeneration may rewrite the objective and then refreshes its AI-generated subpoints and source evidence to match the new wording. Hover or focus an icon to read its action label before selecting it. Processed, assigned materials are required for both actions.

After you manually add an objective, a short tutorial highlights the sparkle button on the first manually added LO. AI-generated or imported/classified objectives do not trigger this tutorial. Select **Enrich this LO** to run enrichment immediately, dismiss the tutorial to keep the objective unchanged, or replay the tutorial later from **User Account → Restart Feature Tutorials**.

Use **AI Link Missing** when an existing objective has no subpoints or source references. CREATE first asks the configured model for structured enrichment and then uses a source-grounded inventory fallback if the model is unavailable or returns incomplete JSON. If neither path can retrieve source evidence, the error identifies material processing or empty preview text as the next thing to repair; retrying a model connection alone is not sufficient in that case.

Open a reference to confirm the excerpt actually supports the objective. A citation proves where evidence came from, not that the objective is pedagogically correct.

## Review checklist

- Each objective is measurable and written for the intended learners.
- Objectives are distinct rather than paraphrases of one another.
- Important source content is covered without turning every detail into an objective.
- Subpoints are specific enough to guide questions.
- Bloom levels match the action verbs and teaching purpose.
- Referenced evidence supports the claim and points to the expected source location.

## Editing and deleting objectives

Edit weak objectives before building the Blueprint. If an objective already has linked questions, editing or regenerating it asks whether those questions should also be regenerated. Select **OK** to update the linked questions after the objective is saved, or **Cancel** to save the objective while keeping the existing questions unchanged. Review any regenerated questions and their evidence before export.

Deleting an objective that already has questions can also delete its dependent questions after confirmation. Review the warning carefully; this is a structural change, not only a text edit.
