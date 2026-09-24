# Studio assistant: shared course workflow, explicit generation approval

Status: local implementation and acceptance testing, 2026-09-20. Not deployed.

## Product contract

Keep the existing five-tab course workflow and the independent H5P Studio. Add
an AI assistant inside Studio that helps complete the same course workflow:
select/create a course, upload or select materials, reuse or generate objectives,
propose an editable question blueprint, wait for instructor approval, generate
questions, and prepare a native H5P draft. The existing quick AI composer and
official manual editor remain available.

Studio has one **Create with AI** entry. Inside it, **Use course materials** is
the recommended shared-course path; **Quick activity** retains the standalone
composer. **New blank activity** and **Import .h5p** are secondary actions. The
former top-level **Create a draft / Review & edit / Preview & download** stepper
is removed because it duplicated navigation and made returning to instructions
look like starting over. Switching AI modes preserves the mounted form drafts.

The assistant is a bounded, persisted workflow orchestrator. It executes actual
material retrieval, model calls, question publication and H5P conversion; it does
not simulate mouse clicks or display an invented reasoning trace. Its task form
asks for missing course/material choices. Model planning recommends objectives,
question types and counts, and the instructor approves the editable plan.

## Shared data

- Courses and uploads use the existing `Folder` and `Material` APIs.
- A task links to an owned `Quiz`, creating one when requested. It is immediately
  listed in the original course workflow.
- Objectives are normal `LearningObjective` records. The blueprint is saved in
  `Quiz.settings.planItems`. Existing objectives are reused; existing questions
  are preserved. An objective already referenced by a question cannot be removed
  or rewritten through this assistant; use the original Learning Objectives tab.
- New questions use the same generation, retrieval, novelty, quality checks and
  publication service as the original workflow.
- The completed H5P draft is linked by `folder`, `quiz` and `assistantSessionId`.
  Its native payload is built from the same published course questions.
- Subsequent arbitrary edits in the official H5P editor still create the existing
  native representation. They do not automatically reverse-convert into guided
  questions. The existing Studio source/version disclosure remains applicable.

## Scope and controls

The current assistant supports up to 20 selected processed materials, eight
objectives, eight blueprint rows and 20 questions per batch. Supported types are
derived from the canonical Column adapters and healthy installed native library
catalog, not a separate handwritten list. Only text-generatable types are offered;
media/template authoring remains in the existing Studio surfaces.

Planning builds a bounded material inventory, preserves real source references,
and maps model-returned source IDs to server-owned excerpts and page metadata.
Sampling is not a claim of complete material coverage. Unsupported teaching
requirements are reported before question generation instead of silently replacing
an interaction (for example scored MCQs inside Documentation Tool) with another.

The assistant writes an editable blueprint before generation. Saving edits must
succeed before approval. Approval checks task revision, material signature and
the shared learning-object snapshot. The approved snapshot is checked again at
generation admission and remains fenced during work and final publication.

## Durability and publication

`StudioAssistantSession` stores instructor-owned authoring state and progress.
Its unique owner/request ID is durable and has no TTL. Repeating creation with the
same intent recovers the existing task; conflicting intent is rejected. Browser
storage contains only owner-scoped opaque IDs, not prompts or material text.

Planning/packaging use durable Studio receipts. Question generation uses the
existing durable question receipts, leases, deadlines and atomic append. Refreshing
the browser reads existing state and never automatically purchases another run.

Ready question candidates can appear in an owner-scoped, read-only native H5P
preview. They are labelled as staged until the entire batch succeeds. A failed
batch publishes none of its candidates; an explicit retry regenerates the batch
and may incur additional model usage. If questions were already published and only
native packaging failed, recovery reuses that successful receipt.

The final native record has a unique owner/session binding. Recovery reuses that
record if its creation succeeded but the session acknowledgement was lost. This
also prevents a duplicate request from creating a second native activity.

## Acceptance

1. New course/learning object appears through the normal course list and routes.
2. Upload processing states are real, and incomplete materials cannot start work.
3. Objectives and blueprint are reviewable and editable before approval.
4. No question-model call starts before approval of the saved revision.
5. Generation displays real per-question state and native preview of ready items.
6. Refresh/repeated requests recover without duplicate model calls or questions.
7. Wrong-owner materials, objectives, tasks and previews are inaccessible.
8. Changed materials or concurrent workflow edits prevent stale publication.
9. Published questions appear in the original Review and Coverage workflow; the
   linked native draft opens in the official editor and can be previewed/downloaded.

Validation results and screenshots are recorded in the task's QA artifacts. A
successful small fixture validates integration, not general teaching quality.
