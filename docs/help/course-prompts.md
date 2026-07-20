# Course Prompts

Course prompts let instructors customize reusable AI behavior for one course without changing system defaults. They are advanced settings: ordinary learning-object creation does not require prompt editing.

## Prompt categories

Learning Objectives controls objective generation and is independent of teaching purpose. Quiz Blueprint and Question Generation can vary by Support Learning, Assess Understanding, or Gamify Learning. Coverage, question-history summary, and validation prompts have separate categories because they perform different tasks.

Quiz Blueprint decides what should be generated: the fixed coverage budget, question-type allocation, objective and subpoint coverage, Bloom levels, difficulty, and rationale. Question Generation writes the actual stem, answer, distractors, feedback, or other type-specific content for one approved Blueprint allocation. They can share the same teaching-purpose strategy, but their locked task responsibilities are different.

## Editable and locked instructions

The **Editable course instructions** box stores course-specific teaching context and reusable preferences. **Locked CREATE instructions** shows the workflow responsibility that CREATE always applies. Runtime guardrails summarize additional constraints such as output schemas, delivery compatibility, evidence retrieval, and question-history memory. Locked instructions are read-only so a course override cannot break saved-data contracts or make an unsupported package.

The panel shows the real course-level layer used by the workflow. Current objectives, evidence excerpts, Blueprint rows, history, counts, and output schemas are inserted dynamically when a request runs, so they are summarized rather than displayed as one stale prompt in settings.

## Course prompts versus one-time instructions

A course prompt defines repeatable behavior for future operations in that course. Instruction boxes in Learning Objectives, AI Blueprint, regeneration, and question generation apply only to the current request. Put stable terminology, audience assumptions, and course-wide constraints in a course prompt; put a one-off focus or exception in the local instruction box.

## Validate before saving

Validation checks required placeholders, length, grounding guidance, duplication guidance, and risky instructions. It reviews the editable course layer together with the locked CREATE instructions and runtime context, so it should not report missing objectives, evidence, question schemas, or counts that CREATE injects automatically. An unchanged system default is recognized as valid without asking the AI reviewer to invent improvements.

When AI review identifies a meaningful, fixable issue, the validation result includes **Apply Changes**. This replaces only the text in the editable draft; it does not save or activate the prompt. Review the revised text, run **Validate** again, and then select **Save Course Prompt** if the result matches your intent.

Do not remove placeholders simply because their raw names look technical. They are replaced with the current objectives, materials, history, or requested total when an operation runs.

## Save, reset, and reuse

**Save Course Prompt** creates a course-specific version. **Reset to Default** restores the system prompt for that category. Saved prompt versions can be selected from the prompt library and applied to another course. Keep the purpose and expected output of the original category when adapting a prompt.

## Safe prompt-writing practices

- State the teaching context, audience, tone, and constraints directly.
- Keep grounding and output-shape requirements intact.
- Avoid instructions that ask the model to ignore evidence or fabricate citations.
- Do not include API keys, credentials, private student data, or unpublished personal information.
- Test a change on a small learning object before using it broadly.

## Recover from a poor prompt result

Return to the prompt category, compare with the default, and reset if the custom version removed required behavior. Then regenerate the affected objective, Blueprint, or question. Resetting a prompt does not automatically change content that was already generated.
