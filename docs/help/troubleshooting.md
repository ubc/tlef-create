# Troubleshooting and Recovery

Start with the smallest safe recovery step: preserve your work, read the visible message, retry once, and then report a reproducible failure. Repeatedly clicking generation or export can create duplicate work.

## A workflow tab is disabled

Complete the prerequisite in the previous tab. Assign processed materials before grounded objective generation, create at least one learning objective before the Blueprint, and generate at least one question before export. Refresh if the prerequisite was just saved but the tab has not updated.

## AI generation does not start

Check that the account has a usable API key or permission to use the deployment key. Then confirm the learning object has assigned, processed materials where required and at least one learning objective. For a fixed Blueprint count, use a whole number between the number of objectives and 100.

If a request fails, keep the learning object open and retry once. Do not submit several identical generations in parallel.

## The Blueprint says Validation failed

Inspect every row before retrying. A row must reference an existing learning objective or use **No Learning Objective** with a non-empty Custom Prompt. Also check that counts are positive and that the selected type is compatible with the delivery format. CREATE does not start generation or replace existing questions when the Blueprint cannot be saved.

## Generation stops partway through

Review the questions that were saved before retrying. A later run receives existing-question history, but it can still create overlap. Adjust the Blueprint or use Add Question for only the missing coverage instead of automatically regenerating the full plan.

## Questions are repetitive

Inspect objective subpoints and Blueprint focus areas. Split broad objectives into meaningful subpoints, remove duplicate Blueprint rows, and make each row's focus distinct. When regenerating, request a different scenario, misconception, evidence passage, or Bloom level.

## A source reference is wrong or empty

Preview the material, confirm its processing state, and verify it is assigned to the current learning object. Scanned PDFs may require OCR. For a wrong excerpt, regenerate or enrich the dependent objective/question and verify the new reference.

## A question type disappears

The selected delivery target or format does not support it, or the teaching-purpose default did not propose it. Check Question Types and Compatibility. Changing format can remove incompatible existing rows or questions after confirmation.

## Export is unavailable or fails

Make sure at least one question exists and all types are compatible with the destination. For Canvas, reconnect if authorization or destination loading fails. For H5P, remember that Canvas Mixed Activity can contain types that do not fit one downloadable H5P package.

## The Help Center does not highlight a citation

The manual may have changed since the AI answer was stored in session history. Open the source card again after asking the question, or search for the source title and section shown on the card. If the section no longer exists, report an outdated help reference.

## Session or network errors

If the sign-in session expired, sign in again and return to the course. For a temporary network failure, do not clear browser storage or delete content; refresh once and verify which changes were saved. If other pages work but one operation consistently fails, capture its exact message for a report.

## When to report the issue

Report after one safe retry when data is missing, a destructive warning is incorrect, the same request fails repeatedly, an answer key is wrong, a reference points to unrelated evidence, or the manual contradicts the interface. Use **User Account → Report Issues** and provide reproducible steps.
