# Course Prompts

Course prompts let instructors customize reusable AI behavior for one course without changing system defaults. They are advanced settings: ordinary learning-object creation does not require prompt editing.

## Prompt categories

Learning Objectives controls objective generation and is independent of teaching purpose. Quiz Blueprint and Question Generation can vary by Support Learning, Assess Understanding, or Gamify Learning. Coverage, question-history summary, and validation prompts have separate categories because they perform different tasks.

## Course prompts versus one-time instructions

A course prompt defines repeatable behavior for future operations in that course. Instruction boxes in Learning Objectives, AI Blueprint, regeneration, and question generation apply only to the current request. Put stable terminology, audience assumptions, and course-wide constraints in a course prompt; put a one-off focus or exception in the local instruction box.

## Validate before saving

Validation checks required placeholders, length, grounding guidance, duplication guidance, and risky instructions. A warning does not always block saving, but missing required structure can prevent the prompt from supplying data the workflow needs.

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
