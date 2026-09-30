# Studio generation recovery and task visibility

## Findings

A failed unpublished question batch previously prevented conversation: the authoring service accepted pre-generation messages only while the plan awaited approval. The page still displayed a message composer. Plan instructions were also read-only in the workspace after failure.

The reported physics plan had fourteen items; its five multiple-choice items were blocked by independent feedback review. This check currently applies to multiple-choice drafts with option feedback. Prepared items of other types must not be described as independently verified by that check. The original rejected drafts were not retained, so their exact correctness cannot be reconstructed from the saved reason codes.

## Implemented

- Failed, terminal, unpublished batches can return to plan editing. Source ownership, course fingerprints and revision checks remain enforced. Published batches and active generation cannot use this recovery path.
- Discussion can explain a failure without automatically retrying generation. Resuming after a successful discussion resumes the failed batch rather than replaying the discussion.
- Saving a revised plan invalidates its old approval and generation request. The instructor reviews and approves the revised plan before generating.
- Quantitative planning, drafting and review prompts distinguish hypothetical problem inputs from source facts, define axes/units/precision, and treat illustrative scenario variants as alternatives. Incorrect answer and arithmetic checks remain enforced.
- Rejected drafts and bounded model review observations are stored in an instructor-owned content collection, separately from job telemetry. Reads require the owned session and exact quiz, receipt and failed index. Deleting the course or learning object also removes these drafts.
- Expandable Task steps show saved actions across conversation turns and per-question states. Failed questions show their topic, approved instructions, rejected draft and review observations when available.
- Refine teaching requirements offers learner level, purpose and difficulty choices during plan review. Updating the proposal sends an explicit revision request; approval remains separate. A vague conversational request should elicit up to three targeted questions.

## H5P compatibility patch

Core and editor retain their pinned 1.28 upstream sources. CREATE's local patch removes deprecated unload registration, preserves beforeunload/pagehide state handling, and uses only the modern fullscreen allow attribute on the editor iframe. Changed asset hashes and runtime digests are recorded in the runtime manifest and library lock. The runtime revision is `20260930-core128-pagehide`.

The native maintenance acceptance runner now fails when its type filter matches no forms and records the two reported permission warnings as failures.

## Local validation

- 205 focused backend unit tests passed, including feedback review, planning, help retrieval, SAML identity and H5P runtime integrity.
- 30 isolated localhost MongoDB integration tests passed with model requests mocked, including failed-batch recovery, approval invalidation, publication safety and rejected-draft access isolation.
- 22 frontend tests passed, including teaching preference choices and failed-draft editing.
- Production Vite build passed. Existing bundle-size warnings remain.
- Native blank Flashcards 1.7.23 form: filled, saved and reopened through browser controls in isolated temporary storage, with neither reported permission warning. This is native editor acceptance, not authenticated CREATE or Canvas acceptance.
- H5P inventory/lock verification passed.

A fourteen-question live-model reproduction was prepared but blocked by automatic approval review because it sends the supplied lecture text and plan to the configured external AI service and consumes API credits. It has not executed. These results do not establish that this particular live batch now succeeds.

## Further interaction design

A future structured clarification stage should derive choices from the course, materials and existing instructor requirements, asking only for information that changes the plan. It should distinguish recommendations from confirmed preferences and preserve answers with the task. The current preference controls are a first implementation of plan refinement; they do not constitute an adaptive multi-question intake engine.
