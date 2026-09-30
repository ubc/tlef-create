# Luna live evaluation — ongoing

## Scope

The requested evaluation runs for three hours, progresses from simple to complex prompts, exercises changes during a task, and records a real application screenshot for each UI round in a local HTML journal. Model calls are sequential and small. The target is not satisfied by service tests alone.

## First checkpoint

The local environment model is `gpt-6-luna`. User credentials can override this model, so the effective authenticated UI account still needs verification. Five live service rounds used seven logical model requests, including the legacy baseline fallback. They used synthetic physics evidence; no uploaded lecture or private course source was transmitted. No course question was published.

| Round | Request | Observed result |
| --- | --- | --- |
| 1 | One signed-force MCQ | Malformed model JSON; legacy fallback also failed. |
| 2 | Same MCQ after JSON-mode repair | Generated and independently reviewed. The keyed answer agrees with `(10 - 4) / 2 = 3`. |
| 3 | Two easy first-law true/false questions | Plan preserved count, audience, topic, difficulty, feedback and friction exclusion. |
| 4 | Change to one moderate MCQ | Count, type and difficulty changed while the remaining constraints were retained. |
| 5 | “Make it better.” while a plan awaits approval | The worker decision prompt returned a clarification reply, rather than a plan revision. |

The planning and decision rounds use the actual helper/prompt and parser with synthetic context and an explicit environment configuration. They do not establish full command routing, saved-task mutation, UI approval, or publication behavior. Input/output character counts were measured; billed token usage is not returned by these service results.

## Repairs verified at this checkpoint

- Streaming generation requests JSON output. The toolkit's non-streaming OpenAI transport uses its supported `responseFormat: 'json'` option.
- A completed malformed draft has the application-owned `QUESTION_INVALID_RESPONSE` diagnosis and does not trigger another paid fallback. The receipt gives a safe explanation and requires an explicit retry.
- Question parsing ignores literal braces and escaped quotes when locating the JSON boundary. Shared extraction preserves Markdown delimiters inside learner text.
- The worker decision prompt is shared with live evaluation tooling; history is not mutated while constructing its context.
- Focused unit checks: 102 generation/planning/request/format tests, 91 help retrieval tests, and 3 decision-context tests passed. Nine isolated MongoDB authoring integration tests passed with model calls mocked.

## Remaining evidence and product work

Browser access to localhost was rejected by the browser permission layer. Permission restoration and local login were requested. Every screenshot slot remains explicitly pending; no service output is represented as a UI screenshot. The supplied lecture's external model transmission also awaits the user's response to the prior automatic approval rejection.

Selectable clarification choices and an initial adaptive intake are not implemented at this checkpoint. A vague-message text reply does not satisfy that design. Remaining evaluation includes actual UI rounds, individual-question revisions, contradictions, unsupported capabilities, stop/retry behavior and the complex lecture case after approval.

## Selectable clarification checkpoint

Two further live decision rounds tested a contradictory one-versus-five question count. The text-only baseline correctly asked the instructor to choose. After extending the decision contract, Luna returned a validated question with three selectable alternatives and kept the action as `reply`.

Clarification questions are now persisted with owner-authorized conversation messages. Each reply accepts at most three questions with two to four bounded, distinct options. A revision cannot be combined with unanswered clarification choices. The conversation renders radio choices for the latest assistant message; **Use selected answers** composes an editable reply, and only **Send message** calls the API. Changing a selection replaces its previous composed answer. Superseded choices are unavailable.

Validation: 107 focused backend unit tests, 10 isolated authoring integration tests and 17 frontend tests passed. The production build passed with existing bundle-size warnings. A live model response matched the structured choice contract. Browser visual acceptance and screenshots remain pending permission. Initial adaptive intake before plan generation remains outstanding.

## Initial requirements checkpoint

Two further real Luna rounds tested the initial brief before objective generation. A vague request returned `ready:false` and selectable learner, purpose and count/interaction questions. An explicit follow-up specifying introductory university learners, low-stakes practice and one easy MCQ returned `ready:true` without further questions.

The worker now pauses in **Waiting for your teaching choices** before dispatching objective/plan generation when requirements are unclear. Confirmed replies are retained separately from the original brief and included in later planning and revisions. Request identifiers deduplicate reply storage and retries. A reply that continues planning is tracked so an interrupted run resumes the planning stage rather than reclassifying the already confirmed answer. Explicit automatic-draft opt-in retains its existing bypass behavior. Learning-object ownership and course membership are checked before paid intake work.

Validation includes initial pause/resume, answer retention, unchanged explicit plan approval, automatic-draft opt-in, foreign learning-object rejection before a model call, and interruption after confirmed requirements. Fourteen isolated authoring tests and eighteen frontend tests passed; the production build passed. Browser acceptance remains pending. The ten live service rounds used twelve logical model requests; no source lecture text was transmitted and no course questions were published.

## Quantitative feedback and in-progress scope checkpoint

Round 11 generated an incline question with the correct key `≈ 3.20 m/s²`, but its feedback review failed `ARITHMETIC_FALSE_EQUALITY`. Independently, `9.8 * (0.500 - 0.20 * 0.866) = 3.20264`. The saved reviewer observation incorrectly claimed the wrong-sign distractor should round to `6.59`; the independently computed value is `6.59736`, which rounds to `6.60`. The original failing calculation payload was not retained, so that observation does not establish the exact rejected expression.

Round 12 used one fresh review-only request for that synthetic draft. It accepted the unchanged key and supplied valid declared calculations. This shows variability; it does not prove repeatable success. The arithmetic gate remains enabled. Future rejected drafts include a bounded **Calculation check** identifying its location, expression, computed result and claimed feedback result. These details stay in the private rejected-draft collection, outside job receipts and mutation audit data. The UI distinguishes these checks from AI judgments under **Failure details**.

Round 13 correctly classified an explicit change to question 2 as `revise_question`, retaining questions 1 and 3 in its response. This live round tests classification, not saved-course mutation or UI acceptance. Round 14 refused a mandatory 100-question plan because the workflow limit is 20; it did not silently reduce the count or generate questions.

A separate parser regression exposed valid formatted JSON whose answer string ends in an escaped backslash. The cleaner now tracks escaped characters and removes trailing commas only outside strings. Literal `,}` and `,]` punctuation survives unchanged.

Validation: 161 focused backend unit tests, 15 workspace frontend tests and the production build passed. Fourteen live rounds used seventeen logical model requests. Real UI screenshots, authenticated effective-model verification and the private lecture case remain pending the previously requested permissions.
