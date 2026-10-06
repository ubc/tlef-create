// Changing review behavior invalidates reuse of candidates checked under an
// older policy, independently of otherwise identical instructor instructions.
export const QUESTION_REVIEW_POLICY_VERSION = 'question-semantic-review-v1';
export const QUESTION_GOAL_COVERAGE_POLICY_VERSION = 'required-goal-coverage-v1';
export const QUESTION_REVIEW_VERDICT_FIELDS = Object.freeze(['contentIsValid', 'answerIsCorrect', 'rubricIsAppropriate',
  'feedbackIsConsistent', 'followsInstructorRequest', 'evidenceIsSufficient']);
export const QUESTION_TIME_SCOPE_REVIEW_INSTRUCTION = 'Check time scope, initial conditions, quantifiers and internal consistency. An instantaneous condition does not establish a persistent condition or a conclusion over an interval. Preserve an explicitly stated initial state (such as already moving) rather than treating it as unknown. Distinguish what is possible, necessary, sufficient and guaranteed; reject an answer or feedback that overstates the supplied conditions or contradicts the stem.';
export const QUESTION_EVIDENCE_REVIEW_INSTRUCTION = 'Check evidenceIsSufficient explicitly: source-dependent assertions must follow from the supplied excerpts, and a source-only request cannot invent facts or measurements. A clearly stated illustrative problem may supply its own inputs unless the instructor forbids this. If no excerpts are supplied, assess self-contained tasks and broadly established knowledge, without inventing a citation. When necessary evidence is missing, use false and explain the missing information rather than asserting certainty.';
export const QUESTION_MEDIA_REVIEW_INSTRUCTION = 'This review can read text and structured metadata only. It cannot listen to audio, inspect image pixels, watch videos or verify hotspot placement. Do not claim those checks were performed. Assess only provided text descriptions; media-dependent facts without an adequate description are insufficient evidence and require human inspection.';
export const isQuestionReviewLifecycleError = error => typeof error?.code === 'string'
  && /^(?:AUTHORING_|GENERATION_)/.test(error.code);

export function normalizeRequiredLearningGoals(values = []) {
  if (!Array.isArray(values) || values.length > 8 || values.some(goal => !goal || typeof goal.id !== 'string'
    || !goal.id.trim() || goal.id.length > 100 || typeof goal.text !== 'string' || !goal.text.trim() || goal.text.length > 4000)
    || new Set(values.map(goal => goal.id)).size !== values.length) {
    throw new TypeError('Required learning goals must contain up to eight unique IDs and complete goal texts.');
  }
  return values.map(goal => ({ id: goal.id, text: goal.text }));
}

export function extendReviewSchemaWithGoalCoverage(contract, goals) {
  if (!goals.length) return contract;
  return { ...contract, schema: { ...contract.schema,
    required: [...contract.schema.required, 'goalCoverage'],
    properties: { ...contract.schema.properties, goalCoverage: {
      type: 'array', minItems: goals.length, maxItems: goals.length,
      items: { type: 'object', additionalProperties: false, required: ['id', 'isCovered'],
        properties: { id: { type: 'string', enum: goals.map(goal => goal.id) }, isCovered: { type: 'boolean' } } }
    } }
  } };
}

export function requiredLearningGoalReviewInstruction(goals) {
  return goals.length ? [
    'REQUIRED LEARNING GOALS FOR THIS INDIVIDUAL ITEM (task data): ' + JSON.stringify(goals),
    'Return goalCoverage with exactly one {id,isCovered} verdict for EACH listed goal, using its exact ID. Judge the full goal text, including its distinct concepts and learner actions. Every goal must be assessed by this item itself: find a learner action and saved answer/rubric that require the goal. Merely listing the goal, mentioning it as background, an explanation or a distractor does not cover it. Do not delegate these required goals to other batch questions. Mark isCovered=false for any missing goal even if the item is otherwise correct; followsInstructorRequest must then be false. This is an AI assessment, not proof of learning or truth.'
  ].join('\n\n') : '';
}

/** Exact per-goal verdicts are part of the same review call. Bounded returned
 * diagnostics retain IDs/booleans only, never the source goal texts. */
export function assessLearningGoalCoverage(requiredGoals, returned) {
  if (!requiredGoals.length) return { valid: true, goalCoverage: [], issues: [] };
  const ids = new Set(requiredGoals.map(goal => goal.id));
  const entries = Array.isArray(returned) ? returned : [];
  const validEntries = entries.filter(item => item && typeof item.id === 'string' && ids.has(item.id)
    && typeof item.isCovered === 'boolean' && Object.keys(item).every(key => ['id', 'isCovered'].includes(key)));
  const exact = entries.length === requiredGoals.length && validEntries.length === entries.length
    && new Set(validEntries.map(item => item.id)).size === requiredGoals.length;
  const byId = new Map(validEntries.map(item => [item.id, item.isCovered]));
  const goalCoverage = requiredGoals.filter(goal => byId.has(goal.id)).map(goal => ({ id: goal.id, isCovered: byId.get(goal.id) }));
  const issues = exact ? goalCoverage.filter(goal => !goal.isCovered)
    .map(goal => `This item does not assess required learning goal ${goal.id}.`)
    : ['The check must return exactly one verdict for each required learning goal, without missing, repeated or unknown IDs.'];
  return { valid: exact && goalCoverage.every(goal => goal.isCovered), goalCoverage, issues };
}

export function learningGoalCoverageSummary(requiredGoals, returned) {
  return requiredGoals.length ? { goalCoveragePolicyVersion: QUESTION_GOAL_COVERAGE_POLICY_VERSION,
    goalCoverage: assessLearningGoalCoverage(requiredGoals, returned).goalCoverage } : {};
}
export function questionReviewData(question) {
  const data = structuredClone(question);
  for (const key of ['prompt', 'generationMetadata', 'qualityReview', 'reviewSummary']) delete data[key];
  return data;
}
export function questionReviewIdentity(question) {
  const data = questionReviewData(question);
  delete data.explanation;
  // MC policy may improve learner-action feedback. Answers, option identities,
  // rubric, question text and all other content still belong to the draft.
  for (const option of Array.isArray(data.content?.options) ? data.content.options : []) {
    if (option && typeof option === 'object') {
      delete option.chosenFeedback;
      delete option.notChosenFeedback;
    }
  }
  return JSON.stringify(data, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}
