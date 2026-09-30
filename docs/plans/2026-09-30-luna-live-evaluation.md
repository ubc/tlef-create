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
