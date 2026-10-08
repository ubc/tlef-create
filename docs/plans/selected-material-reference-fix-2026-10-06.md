# Selected material references in Studio — 2026-10-06

## Problem and cause

An instructor attached `week3-lecture-notes` and asked for questions “based on this,” delegating the quantity. The agent asked what “this” referred to and printed the internal requirements extraction example in its reply.

The workspace submits selected material IDs correctly. However, the initial agent decision previously received those IDs without necessarily reading the source. Material sampling in the later requirements stage could not help a decision that had already returned clarification instead of entering that stage.

## Changes

- Before the first decision on an initial source-reference request, read selected material text through the existing authorized `read_material` tool. The shared initial sample budget is 6,000 characters across selected materials. Verified prior readings can be reused; the agent can request additional ranges. Sampling does not prove complete coverage.
- Keep normal tool receipts, source versions, owner/course filters, exclusion checks, cancellation and checkpoints. These reads add no model call; sending source samples can affect the input tokens of the existing call.
- Explain in both decision and requirements prompts that “this,” “these notes” and “这个材料” refer to the selected sources, and that “you decide how many” delegates a conservative recommendation.
- Replace ambiguous schema example values with descriptive extraction instructions. Reject placeholder interpretations and clean them from the specification on its next update.
- Strip a labelled internal requirements extraction object from a reply while preserving teacher-facing prose and ordinary JSON examples. Empty or unreadable internal-only responses fail validation rather than becoming chat messages.
- Update instructor help and retrieval regression coverage.

## Verification

- Backend unit suite: 106 suites, 1,553 tests passed.
- Final focused tests after adding multiple-material coverage and historical placeholder cleanup: 218 tests passed.
- Regressions cover English/Chinese references, real source text before the first model call, authorization filters, processing errors, multiple-source sampling limits, internal data leakage and placeholder cleanup.
- Local browser session `7366728ae46b19b72c1ef13d` used the existing Faculty account, selected `week3-lecture-notes`, and requested a confirmable teaching plan with delegated count. Its operation trace recorded a real read of characters 0–6000 out of 7220 before the first AI decision; planning then began without asking what “this” means.
- That plan test was interrupted after a development-server restart caused by editing code during the test. The listener restarted at 16:43:25, after the source read at 16:42:23. Its unknown paid request was not automatically retried; this test does not establish plan completion.
- After editing stopped, a fresh short discussion in session `19b42c2f61e77d8a51ba1b5d` used the same material and asked “Based on this” with delegated quantity. It finished in 7 seconds, correctly identified Newton's laws, free-body diagrams, normal force, friction, inclined planes and tension, and recommended 8 questions without asking for the referent or quantity. The UI reported 11.2k tokens; this is token usage, not a dollar cost. No internal requirements JSON appeared.
- Screenshot: `output/material-reference-fix-2026-10-06.jpg`. This validates source recognition and recommendation; it does not validate a complete question-generation batch.

## Scope

This change is local until committed and deployed. It does not rewrite earlier saved chat messages or claim to validate the quality of a generated question batch. Full plan completion was not established by this browser test; the successful final acceptance covers a short teaching discussion.
