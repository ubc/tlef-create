import { listH5PTypeAdapters } from '../config/h5pTypeAdapterRegistry.js';
import { normalizeGeneratedQuestionText } from '../utils/questionTextLimits.js';
import { legacyQuestionAIStrategy } from './legacyQuestionAIStrategy.js';
import { reviewQuestionWithDefaultPolicy } from './questionSemanticReview.js';
import { QUESTION_REVIEW_POLICY_VERSION, QUESTION_REVIEW_VERDICT_FIELDS, questionReviewIdentity,
  QUESTION_GOAL_COVERAGE_POLICY_VERSION, normalizeRequiredLearningGoals, assessLearningGoalCoverage,
  learningGoalCoverageSummary } from './questionReviewContract.js';

const invalid = cause => Object.assign(new Error('The model returned an unreadable or invalid question. No question was saved. Retry explicitly to generate a new draft.'), {
  code: 'QUESTION_INVALID_RESPONSE', cause
});
const observeUnexpectedPromise = value => {
  if (value && typeof value.then === 'function') {
    // A normal function can still return a rejecting Promise. Observe it before
    // refusing the async result at the synchronous parser/format boundary.
    void Promise.resolve(value).catch(() => {});
    return true;
  }
  return false;
};

/** Course Question AI behavior, keyed by the existing canonical adapters.
 *
 * prompt(context) supplies the response-format instructions.
 * validateNormalize(context) synchronously returns a CREATE Question draft.
 * buildPrompt(context) may return a complete complex prompt, or null to use
 * the common evidence/instructor prompt plus prompt(context).
 * review(context) asynchronously checks a normalized draft before persistence.
 *
 * A new type registers its own behavior here. H5P conversion remains owned by
 * H5P_QUESTION_ADAPTERS[type].toH5P, so there is no parallel export registry.
 */
export class QuestionAIStrategyRegistry {
  #adapters;
  #strategies = new Map();
  #fallback;

  constructor({ adapters = listH5PTypeAdapters, legacy = legacyQuestionAIStrategy } = {}) {
    this.#adapters = new Map(adapters().map(adapter => [adapter.type, adapter]));
    this.#fallback = this.#compose({
      id: legacy.id,
      prompt: ({ questionType, selectionMode = 'single' }) => legacy.getFormatInstructions(questionType, selectionMode),
      validateNormalize: ({ responseContent, questionType, selectionMode = 'single', branchingLayers = 2,
        branchingChoices = 2, sourceChoiceCounts = null }) => legacy.parseAndValidateResponse(
        responseContent, questionType, selectionMode, branchingLayers, branchingChoices, sourceChoiceCounts),
      buildPrompt: context => legacy.buildPrompt(context),
      review: reviewQuestionWithDefaultPolicy
    });
  }

  #compose(strategy, fallback = null) {
    const hooks = {};
    for (const name of ['prompt', 'validateNormalize', 'buildPrompt', 'review']) {
      hooks[name] = typeof strategy[name] === 'function' ? strategy[name].bind(strategy) : fallback?.[name];
    }
    if (Object.values(hooks).some(hook => !hook)) throw new TypeError('Question AI strategies require prompt, validation, complex-prompt and review behavior.');
    return Object.freeze({
      id: strategy.id,
      prompt(context) {
        const prompt = hooks.prompt(context);
        if (observeUnexpectedPromise(prompt) || typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('A Question AI format prompt must synchronously return a nonempty string.');
        return prompt;
      },
      validateNormalize(context) {
        try {
          const draft = hooks.validateNormalize(context);
          if (observeUnexpectedPromise(draft) || !draft || Array.isArray(draft) || typeof draft !== 'object'
            || typeof draft.questionText !== 'string' || !draft.questionText.trim()) {
            throw new TypeError('Question AI validation must synchronously return a draft with questionText.');
          }
          return normalizeGeneratedQuestionText(draft);
        } catch (error) { throw error?.code === 'QUESTION_INVALID_RESPONSE' ? error : invalid(error); }
      },
      async buildPrompt(context) {
        const prompt = await hooks.buildPrompt(context);
        if (prompt == null) return null;
        if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('A complete Question AI prompt must be a nonempty string or null.');
        return prompt;
      },
      async review(context) {
        const identity = questionReviewIdentity(context.draft);
        const goals = normalizeRequiredLearningGoals(context.requiredLearningGoals);
        const checked = await hooks.review({ ...context, requiredLearningGoals: goals });
        if (!checked || typeof checked.questionText !== 'string' || !checked.questionText.trim()
          || !['ai-feedback-reviewed', 'ai-semantic-reviewed'].includes(checked.qualityReview)
          || !['feedback', 'semantic'].includes(checked.reviewSummary?.kind)
          || checked.reviewSummary?.policyVersion !== QUESTION_REVIEW_POLICY_VERSION
          || checked.reviewSummary?.mediaInspection !== 'not-performed'
          || QUESTION_REVIEW_VERDICT_FIELDS.some(field => checked.reviewSummary?.checks?.[field] !== true)
          || questionReviewIdentity(checked) !== identity) {
          throw Object.assign(new Error('The question strategy did not return a reviewed draft. No question was saved.'), {
            code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'REVIEW_INVALID_RESPONSE', repairKind: 'redraft'
          });
        }
        const coverage = assessLearningGoalCoverage(goals, checked.reviewSummary.goalCoverage);
        if (goals.length && (checked.reviewSummary.goalCoveragePolicyVersion !== QUESTION_GOAL_COVERAGE_POLICY_VERSION || !coverage.valid)) {
          throw Object.assign(new Error('The question strategy did not check every required learning goal. No question was saved.'), {
            code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'INSTRUCTION_MISMATCH', repairKind: 'redraft',
            rejectedDraft: { questionText: checked.questionText.slice(0, 16000),
              issues: coverage.issues.length ? coverage.issues : ['The required learning-goal review contract is missing or outdated.'],
              reviewSummary: { ...checked.reviewSummary, checks: { ...checked.reviewSummary.checks, followsInstructorRequest: false },
                ...learningGoalCoverageSummary(goals, checked.reviewSummary.goalCoverage) } }
          });
        }
        return normalizeGeneratedQuestionText(checked);
      }
    });
  }

  register(type, strategy, { replace = false } = {}) {
    if (!this.#adapters.has(type)) throw new TypeError('Add this question type to the canonical H5P adapter registry before registering AI behavior.');
    if (typeof strategy?.id !== 'string' || !strategy.id.trim()) throw new TypeError('Question AI strategies need an ID.');
    for (const name of ['prompt', 'validateNormalize', 'buildPrompt', 'review']) {
      if (strategy[name] != null && typeof strategy[name] !== 'function') throw new TypeError(`Question AI strategy ${name} must be a function.`);
      if (['prompt', 'validateNormalize'].includes(name) && strategy[name]?.constructor?.name === 'AsyncFunction') {
        throw new TypeError(`Question AI strategy ${name} must be synchronous; buildPrompt and review may be asynchronous.`);
      }
    }
    if (!replace && this.#strategies.has(type)) throw new TypeError(`Question AI behavior is already registered for ${type}.`);
    this.#strategies.set(type, this.#compose(strategy, this.#fallback));
    return this;
  }

  resolve(type) {
    if (!this.#adapters.has(type)) throw Object.assign(new Error('This question type has no canonical CREATE authoring adapter.'), { code: 'QUESTION_TYPE_UNSUPPORTED' });
    return this.#strategies.get(type) || this.#fallback;
  }
}

export const questionAuthoringStrategies = new QuestionAIStrategyRegistry();
