# Extending H5P AI authoring

CREATE has two authoring representations: a course-linked `Question` record and
a native H5P document. They have different persistence and validation contracts.
An installed native activity does not automatically have a course-question
adapter, and a structurally valid H5P document does not establish that its answer
or feedback is correct.

The extension boundaries use a capability facade and behavioral strategies.
They keep type facts, generation behavior, and orchestration separate. A type
that works with ordinary installed semantics needs no dedicated class. A type
with additional behavior can use an object or a class strategy. Both registries
bind prototype methods to their original receiver, including private state.

## Sources of truth and responsibilities

| Boundary | Responsibility | Source |
| --- | --- | --- |
| Backend adapter metadata | CREATE question IDs, labels, pinned main libraries, container compatibility, AI exposure and conversion flags | `routes/create/config/h5pTypeAdapterRegistry.js` |
| Installed native catalog | Actual installed libraries and assets; `generate`, `template`, `manual` and `unavailable` modes | `routes/create/services/h5pStudioCatalog.js` |
| Capability facade | Query the existing metadata and installed catalog through one interface | `routes/create/services/authoring/authoringActivityCapabilities.js` |
| Native contracts and normalization | Derive JSON fields and defaults from installed H5P semantics; check nested libraries and trusted media | `routes/create/services/h5pStudioSemantics.js` |
| Native AI behavior | Optional specialization of request checks, output contracts and post-validation | `routes/create/services/studioAuthoringStrategies.js` |
| Course Question AI behavior | Format prompts, parsing/normalization, optional complex prompts and independent review | `routes/create/services/questionAuthoringStrategies.js` |
| Shared semantic review | Text-based task, answer, rubric, feedback, evidence and requirement checks; declared arithmetic verification | `routes/create/services/questionSemanticReview.js` |
| Existing Question behavior | Compatibility implementation retained behind the new strategy boundary | `routes/create/services/legacyQuestionAIStrategy.js` |
| H5P conversion | Existing `H5P_QUESTION_ADAPTERS[type].toH5P(question, quiz)` adapter boundary | `routes/create/services/h5pExportService.js` |

The agent queries the facade through `list_activity_types`. Planning and agent
code must not maintain another question-type list or infer capability from a
library name. The frontend compatibility registry remains
`src/constants/questionTypeCapabilities.ts`; changes to course-question
compatibility must keep it aligned with the backend.

The facade exports:

```js
listAuthoringQuestionTypes({ container: 'column', catalog });
listAuthoringNativeActivities({ catalog });
resolveAuthoringActivity({ questionType: 'guess-the-answer', container: 'column', catalog });
resolveAuthoringActivity({ library: 'H5P.Chart 1.2', catalog });
```

`catalog` is optional and defaults to the actual installed catalog. Question
queries use the intersection of enabled canonical adapters, container
compatibility and healthy installed libraries. A top-level native library must
have `generate` mode. An installed non-runnable embedded library, such as
Discussion's `H5P.AdvancedText`, may instead be used through its existing
course-question adapter after asset and dependency checks. This does not expose
it as a top-level native activity. Native queries expose the catalog's actual
mode and whether a template is required. Their
`representation` and `contractSource` identify which pipeline applies. A
`template` capability requires a real saved template; `manual` and `unavailable`
activities cannot enter AI generation simply by registering a strategy.
Starting a new native activity from chat requires `generate` mode; revising a
`template` activity requires an owned saved template and preserves its trusted
media contract.

## Native H5P strategies

`StudioAuthoringStrategyRegistry` resolves behavior by machine name, independently
of the library's pinned version. The common `installed-semantics` strategy calls
`buildStudioJSONContract()`; `generateStudioActivity()` still normalizes the
generated parameters with `normalizeStudioParameters()` and applies its media,
URL, collection-plan and size checks.

Documentation Tool has a specialized strategy that reuses the existing
`studioDocumentationContract.js`. It supplies a bounded page schema for new
drafts, rejects incompatible multiple-choice requests, and checks that an
explicit Word-export request contains a native export page. Its template path
continues to use installed semantics.

Native hooks may be synchronous or asynchronous: `h5pStudioAIService.js` awaits
all three.

| Hook | Input and result |
| --- | --- |
| `buildContract(context)` | Receives `library`, `libraries`, `template`, `templateParameters` and `trustedMedia`. Returns `{ paramsSchema, outputSchema, guidance, contractVersion }`; `guidance` is an array of prompt instructions and `outputSchema` may be `null`. |
| `validateRequest(context)` | Receives `library` and `instructions`. Throws before generation if the request cannot be satisfied. |
| `postValidate(context)` | Receives structurally normalized `parameters`, `library`, `instructions`, `template` and the resolved `questionPlan`. Checks type-specific conditions and throws on failure. Its return value does not replace the normalized parameters. |

Strategies may override only the hooks they need. Other hooks inherit the common
behavior. Register them in trusted application startup code, never from model
output. Duplicate registrations are rejected unless `{ replace: true }` is
explicitly supplied.

This conceptual example adds an application-specific constraint to the existing
Chart type. It does not describe a policy already enabled in CREATE:

```js
import { studioAuthoringStrategies } from './studioAuthoringStrategies.js';

class ChartWithTwoRows {
  id = 'chart-with-two-rows';
  #minimumRows = 2;

  async postValidate({ parameters }) {
    if ((parameters.listOfTypes || []).length < this.#minimumRows) {
      throw Object.assign(new Error('This chart needs at least two data rows.'), {
        code: 'H5P_AI_INVALID', status: 422
      });
    }
  }
}

studioAuthoringStrategies.register('H5P.Chart', new ChartWithTwoRows());
```

`H5P_AI_INVALID` identifies a generated-content validation failure and can enter
the native generator's bounded correction pass. Request incompatibilities use
`H5P_AI_INPUT` with status `400`. Service outages and arbitrary exceptions are
not a reason to generate another draft automatically.

## Course Question AI strategies

`QuestionAIStrategyRegistry` accepts only a `questionType` already present in the
canonical H5P adapter registry. It supplies four behavioral hooks:

| Hook | Contract |
| --- | --- |
| `prompt(context)` | Synchronously returns the response-format instructions. Context includes `questionType` and `selectionMode`. |
| `validateNormalize(context)` | Synchronously parses and validates `responseContent`, then returns a CREATE Question draft with a nonempty `questionText`. Context also supplies selection mode, branching dimensions and source-choice counts. |
| `buildPrompt(context)` | May asynchronously return a complete complex prompt, or return `null` to use the common evidence/instructor prompt plus `prompt()`. Context includes the objective, evidence, course context, prior questions and instructor instructions. |
| `review(context)` | May be asynchronous. Receives the normalized `draft`, `questionType`, evidence, instructor context/request, `requiredLearningGoals`, cancellation signal and a scoped `complete` function. Returns the checked draft with a nonempty `questionText`, `qualityReview` (`ai-feedback-reviewed` or `ai-semantic-reviewed`) and a bounded `reviewSummary` whose `kind` is `feedback` or `semantic`. Throw a typed quality failure instead of returning unchecked content. |

The review summary must carry the current `QUESTION_REVIEW_POLICY_VERSION`,
`mediaInspection: 'not-performed'`, and `checks` with all six verdicts true:
`contentIsValid`, `answerIsCorrect`, `rubricIsAppropriate`,
`feedbackIsConsistent`, `followsInstructorRequest` and `evidenceIsSufficient`.
Review must preserve the original task, answer keys, option identities, rubric
and other content. It may update the explanation and multiple-choice
chosen/not-chosen feedback; content corrections belong in a separate repair.

When an instructor authorizes merging objectives, the original goals survive
as `LearningObjective.generationMetadata.objectiveRevision.sourceGoals`. The
generation, review and repair contexts receive these exact `{ id, text }`
records as `requiredLearningGoals`. Each merged item must assess every supplied
goal through its task and answer or rubric; mentioning a goal only in feedback
or a distractor is insufficient. The same review call returns an exact
`goalCoverage` array of `{ id, isCovered }` verdicts and the independent
`goalCoveragePolicyVersion: 'required-goal-coverage-v1'`. Custom review strategies
must satisfy this contract too. Missing, duplicate, unknown or uncovered goals
cause an instruction-mismatch failure and enter the existing bounded repair
path. This additional policy invalidates outdated merged-item receipts without
changing the review policy or repurchasing unchanged, unselected questions.

The synchronous boundary preserves the existing public
`llmService.parseAndValidateResponse()` contract. Async functions are rejected
for `prompt` and `validateNormalize`; a normal function that unexpectedly
returns a Promise is also refused and its rejection is observed. `buildPrompt`
and `review` can be asynchronous. Format-validation failures retain the
`QUESTION_INVALID_RESPONSE` envelope, and normalized drafts retain the shared
question/explanation text limits.

Existing types currently use `LegacyQuestionAIStrategy` by default. The original
format examples and type-specific parser branches were moved there, including
the complex Branching Scenario and Documentation Tool prompt paths. This is a
behavioral migration boundary, not a claim that every old type already has an
independent class. A type can move out of Legacy when its focused strategy is
ready, while LLM orchestration stays unchanged.

The default review preserves the multiple-choice option/feedback identity
checks and uses the shared semantic checker for other types. It reads the
complete textual task, answer or reference answer, assessment criteria,
feedback, evidence and instructor requirements. Open-ended responses are
assessed as examples rather than unique answer keys. The reviewer checks time
scope, initial conditions and logical qualifiers, while the application
mechanically verifies supported arithmetic expressions declared by the review.
Neither a model verdict nor a schema check proves correctness, and these hooks
do not inspect image pixels, audio or video.

`QUESTION_QUALITY_REVIEW` failures carry a stable `qualityFailureReason` and
bounded instructor-visible diagnostics. Answer, rubric, instruction and
feedback failures can enter one classified repair. Non-MC semantic repairs
redraft the full item rather than replacing MC option feedback. Missing
evidence, unreadable review output, interrupted service calls and exhausted
credits require an explicit next step and are not automatically repurchased.
`QUESTION_REVIEW_POLICY_VERSION` is included in generation receipts so an old
prepared candidate cannot silently bypass a newer review policy.

This conceptual example specializes the existing Guess the Answer type. It
demonstrates registration and output shape; checking that an answer is supported
by evidence remains a separate responsibility:

```js
import { questionAuthoringStrategies } from './questionAuthoringStrategies.js';

class RecallPromptStrategy {
  id = 'recall-prompt';
  #label = 'Reveal answer';

  prompt() {
    return 'Return JSON: {"task":"...","solution":"...","explanation":"..."}.';
  }

  validateNormalize({ responseContent }) {
    const draft = JSON.parse(responseContent);
    for (const field of ['task', 'solution', 'explanation']) {
      if (typeof draft[field] !== 'string' || !draft[field].trim()) {
        throw new Error(`Missing ${field}.`);
      }
    }
    return {
      questionText: draft.task,
      content: { solutionLabel: this.#label, solutionText: draft.solution },
      correctAnswer: draft.solution,
      explanation: draft.explanation
    };
  }
}

questionAuthoringStrategies.register('guess-the-answer', new RecallPromptStrategy());
```

The ordinary prompt still includes evidence and instructor requirements. A
strategy that overrides the complete `buildPrompt` must carry those constraints
into its own prompt. The strategy registry does not approve plans, retrieve
materials, save questions or export H5P packages.

## Adding a type coherently

For a **native Studio activity**:

1. Install and validate the upstream runtime, declared assets, dependencies and
   semantics through the existing H5P maintenance workflow. Keep library
   metadata and compiled assets on the same upstream patch version.
2. Inspect `getStudioCatalog()` and the actual editor. Respect `template`,
   `manual` and `unavailable` modes; review `h5p-studio-targets.json` when a type
   is intentionally limited to manual editing.
3. Use the common semantics strategy where it suffices. Register a specialized
   strategy only for additional prompt contracts or checks. Specialized code
   cannot override the catalog gate, trusted-media rules or permitted nested
   libraries. The semantics contract builder deliberately bounds nested schemas;
   confirm the required child contracts are included for a new composite type.
4. Verify generated content, official-editor save/reload, preview and exported
   package behavior for that type. Document the resulting supported workflow.

For a **new course-linked Question type**, also:

1. Add the canonical adapter metadata and keep frontend/backend container
   compatibility aligned. Enable AI exposure only after its pipeline is ready.
2. Register a matching `prompt` and `validateNormalize` strategy, with
   `buildPrompt` or `review` if needed. Use the default semantic reviewer when
   it covers the type, and specialize it only for additional rules. Do not rely on the Legacy fallback to provide an
   unimplemented new type's contract.
3. Align backend constants, `Question` schema, content formatting/persistence,
   generation configuration and validation, plus plan/add/edit/interactive
   renderers. The strategy hook does not add these automatically.
4. Extend the existing conversion adapter behind
   `H5P_QUESTION_ADAPTERS[type].toH5P`; do not add a second `toH5P` registry to
   the AI layer. Check dependency resolution, container conversion, preview,
   H5P export and applicable PDF/Markdown/Word export paths.
5. Update compatibility documentation and relevant `docs/help/*.md`, including
   retrieval regression coverage for new user-visible terminology.

Temperature/token profiles, metadata helpers, content formatting, portions of
the conversion implementation and the frontend still contain existing
type-specific behavior. This change establishes extension boundaries for AI
contracts; it does not remove every legacy branch or expand every library into
every workflow. Consult [the compatibility playbook](h5p-type-compatibility-playbook.md)
and [supported question types](create-supported-question-types.md) when updating
those paths.

## Verification

Run focused unit tests from `routes/create`:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --runTestsByPath \
  __tests__/unit/authoringActivityCapabilities.test.js \
  __tests__/unit/studioAuthoringStrategies.test.js \
  __tests__/unit/h5pStudioAI.test.js \
  __tests__/unit/questionAuthoringStrategies.test.js \
  __tests__/unit/questionSemanticReview.test.js \
  __tests__/unit/questionResponseFormat.test.js \
  __tests__/unit/questionGenerationNullSafety.test.js \
  __tests__/unit/questionGenerationQualityBoundary.test.js \
  __tests__/unit/questionFeedbackPersistence.test.js \
  __tests__/unit/questionTextLimits.test.js \
  --selectProjects unit --runInBand
```

These tests cover canonical capability intersections, runtime gates, object and
class strategy dispatch, async native hooks, the synchronous Question parser
boundary, asynchronous review contracts, semantic rejection and classified
repair, complex Legacy prompts, rejected output and feedback persistence.
When a converter or vendored runtime changes, additionally run the relevant
`h5pTypeAdapterRegistry.test.js`, `h5pLibraryAssets.test.js` and preview/export
tests. Frontend changes require their focused tests and `npm run build`.

Unit tests with mocked completions establish contracts and rejection behavior.
They do not establish real-model output quality, browser interaction correctness
or successful operation in the destination LMS. Browser acceptance must include
the real official editor, save/reload, generated-content preview, learner answer
and feedback behavior, template media preservation where applicable, and
export/import of the resulting package. Verify the actual type and workflow
before describing it as AI-supported; an installation count is insufficient.

### Recorded local browser acceptance

On 2026-10-01, the Faculty administrator account completed the following local
workflows. Saved generation and review receipts identified `gpt-6-luna`.

| Workflow | Accepted result and observed behavior |
| --- | --- |
| Course-linked Multiple Choice | Two questions and two objectives after an explicitly authorized objective merge. The unselected first question retained its learner content; the merged question assessed both original goals. A rejected candidate preserved the current version. Explicit Resume reused saved planning responses, and restore created accepted version 6 while preserving the earlier course and manual-editor versions. |
| Material-grounded Fill in the Blank | The agent listed the owned course materials, refused to rely on a processing material, and read the ready text before planning. The accepted activity contained one question with two blanks, source references and correct/incorrect learner scoring (2/2 and 0/2). |
| Native Chart | An instructor message queued during generation and ran after the first candidate was accepted. The second version changed only the B value from 20 to 25; A=10, C=30, the bar-chart mode and title were preserved. |

The real official editor, save/reload, accepted previews and browser downloads
were exercised. All three downloaded packages were then imported into separate
owned Studio activities through **Import .h5p**, opened in the official editor
and saved through **Preview**. The imported Multiple Choice questions each
scored 1/1, the imported blanks scored 2/2, and the imported Chart displayed
10/25/30. Importing these copies did not replace the accepted authoring versions.
Packages and screenshots are in `output/agent-strategy-qa/` as local QA artifacts.

This record covers these three types and workflows. Other registered question
types, media-template behavior, long conversations and external LMS deployment
still require their own acceptance evidence. Semantic AI review is a rejection
gate, not a proof that instructional content is correct.
