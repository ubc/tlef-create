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

## Single-question execution checkpoint

Code inspection after the first live single-question classification test found that the executor retained the old question type/difficulty and defaulted to single-answer mode. The decision contract now accepts bounded explicit `questionType`, `difficulty` and `selectionMode` changes. The prompt provides current values and deployed question-type availability; unchanged fields are omitted and retained by execution. Changed type and difficulty are stored on the candidate and published only after acceptance. Retrieval includes the current revision request and selected type.

Round 15 returned the requested true/false type and hard difficulty for question 2. Round 16 deliberately combined an accepted current version with obsolete initial-plan approval status; the model selected a plan revision that the executor would reject. The decision context now gives the current version precedence and forbids that route. Round 17 used the realistic completed initial-plan state and correctly offered a single-question choice for a bulk change that must preserve course links. Round 18 refused a source-only numerical friction plan because the supplied synthetic source contained no measurements or coefficients; it did not invent inputs.

Validation: 119 decision/contract/help unit checks and 17 isolated authoring integration tests passed. Integration coverage verifies type/difficulty conversion, unchanged neighbouring snapshots, publication only after proposal acceptance, preservation of multiple-answer mode and refusal of unsupported types before paid generation. No uploaded lecture text was transmitted. Browser verification remains pending permission.

## Calculation provenance and additional boundary checkpoint

Calculation mismatches now use a separate server-generated `calculationCheck` field on owner-authorized rejected drafts. Model-authored issues remain separate. The reader explicitly projects the field and enforces the same owner, quiz, job and failed-item filters. **Failure details** displays a **Calculation check** region separately from **AI review observations**. Merely writing “Calculation check” in an AI observation does not create a computed-check region. The conversation receives the separate field even when more than four model observations were returned.

Round 19 supplied a synthetic document containing instructions that conflicted with the teacher's requested two easy true/false questions. The plan retained the teacher's count, type, difficulty, feedback and friction exclusion; it did not claim publication. One example does not establish general resistance to document instructions.

Round 20 repeated the full synthetic incline generation and independent feedback review using two requests. The keyed acceleration was again `≈ 3.20 m/s²`. The reviewer repaired an inaccurate distractor rationale and supplied checked expressions producing `3.20264`, `4.9`, `6.59736` and `2.94`. This successful round is retained alongside the earlier failure rather than replacing it. It does not validate the private lecture case or repeatable success.

Validation: 131 focused unit tests, 21 isolated assistant-service integration tests, 17 frontend tests and the production build passed. Twenty live service rounds used twenty-four logical model requests. Browser access and private-file transmission remain pending the user’s response to the previously reported denials; no UI screenshot has been fabricated.

## Authorized PDF pilot and provider allowance checkpoint

The user explicitly authorized localhost access and transmission of the supplied lecture PDF to the configured Luna model for one or two pilot questions. Round 21 used CREATE's actual PDF parser: six pages and seventeen chunks were recovered, and the signed-force pilot supplied relevant excerpts from pages one and two. Its numerical values were explicitly hypothetical, rather than attributed to the lecture. No vector indexing, course mutation or publication was performed by this service test.

The model returned HTTP 429 with an exhausted-credit diagnosis before producing a question. The old streaming path then attempted non-streaming fallback. This round recorded two logical model calls; the SDK's internal retries were not instrumented, so its actual HTTP-attempt count and billed cost are unknown. Further paid tests stopped. The user's PDF authorization is retained; successful PDF generation has not been demonstrated.

Quota/rate errors now become the safe application-owned `MODEL_SERVICE_LIMIT_REACHED` diagnosis, without provider request details. Streaming question generation stops before fallback. Both streaming requests and the non-streaming OpenAI single-message facade disable SDK automatic retries. Feedback-review allowance failures have the separate `REVIEW_LIMIT_REACHED` reason and leave the unchecked draft unpublished. Planning tasks retain the safe diagnosis, and replaying the original request does not repeat model work or alter existing questions. Other providers retain their existing toolkit transport.

Validation: 171 focused backend unit tests, 39 isolated workflow integration tests and the production build passed. A loopback HTTP server verifies that each affected SDK transport sends exactly one HTTP request on a synthetic 429, without external model calls. Successful loopback responses verify JSON mode, model, token-budget and response-usage compatibility.

The journal contains twenty-one live service rounds and twenty-six logical model calls, with zero actual UI screenshots. The saved browser preference still blocks localhost despite the textual authorization; the user has been asked to remove that preference. Restored Luna allowance, authenticated effective-model verification, real UI screenshots, successful PDF pilots and the full three-hour evaluation remain outstanding. Elapsed wall time alone does not complete the requested evaluation.
