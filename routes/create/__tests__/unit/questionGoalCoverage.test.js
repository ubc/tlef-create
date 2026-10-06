import { expect, jest, test } from '@jest/globals';
import { reviewQuestionWithDefaultPolicy } from '../../services/questionSemanticReview.js';
import { QuestionAIStrategyRegistry } from '../../services/questionAuthoringStrategies.js';
import { generateWithRework } from '../../services/questionRework.js';
import { QUESTION_REVIEW_POLICY_VERSION, QUESTION_GOAL_COVERAGE_POLICY_VERSION, QUESTION_REVIEW_VERDICT_FIELDS } from '../../services/questionReviewContract.js';
import Question from '../../models/Question.js';
import RejectedQuestionDraft from '../../models/RejectedQuestionDraft.js';

const goals = [{ id: 'lo-2', text: 'Apply Newton II to infer acceleration from the net force.' },
  { id: 'lo-3', text: 'Identify the equal and opposite interaction forces acting on different objects under Newton III.' }];
const draft = { questionText: 'A net force acts on a cart. Calculate its acceleration.', correctAnswer: '2', explanation: 'Use F=ma.',
  content: { options: [
    { text: '2', isCorrect: true, chosenFeedback: 'Correct.', notChosenFeedback: 'Missed.' },
    { text: '4', isCorrect: false, chosenFeedback: 'Incorrect.', notChosenFeedback: 'Correct omission.' }
  ] } };
const passed = { contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true,
  followsInstructorRequest: true, feedbackIsConsistent: true, evidenceIsSufficient: true, issues: [], calculations: [],
  explanation: draft.explanation, feedback: draft.content.options.map(option => ({
    optionText: option.text, isCorrect: option.isCorrect, rationale: 'Calculate acceleration from the supplied force and mass.', calculations: []
  })) };
const formats = ['multiple-choice', 'essay', 'cloze'];
const completion = verdict => jest.fn().mockResolvedValue({ content: JSON.stringify(verdict) });
const payload = (questionType, goalCoverage) => {
  const { feedback, explanation, ...generic } = passed;
  return { ...(questionType === 'multiple-choice' ? passed : generic), ...(goalCoverage === undefined ? {} : { goalCoverage }) };
};
const covered = goals.map(goal => ({ id: goal.id, isCovered: true }));

test.each(formats)('%s rejects an omitted merged goal even when every general verdict is true, in the same review call', async questionType => {
  const complete = completion(payload(questionType, [{ id: 'lo-2', isCovered: true }, { id: 'lo-3', isCovered: false }]));
  await expect(reviewQuestionWithDefaultPolicy({ draft, questionType, requiredLearningGoals: goals, complete }))
    .rejects.toMatchObject({ qualityFailureReason: 'INSTRUCTION_MISMATCH', repairKind: 'redraft', rejectedDraft: {
      issues: [expect.stringContaining('lo-3')], reviewSummary: {
        checks: { followsInstructorRequest: false }, goalCoveragePolicyVersion: QUESTION_GOAL_COVERAGE_POLICY_VERSION,
        goalCoverage: [{ id: 'lo-2', isCovered: true }, { id: 'lo-3', isCovered: false }]
      }
    } });
  expect(complete).toHaveBeenCalledTimes(1);
  const request = complete.mock.calls[0][0];
  for (const goal of goals) expect(request.prompt).toContain(goal.text);
  expect(request.prompt).toContain('Merely listing the goal');
  expect(request.prompt).toContain('Do not delegate these required goals to other batch questions');
  expect(request.jsonSchema.schema.required).toContain('goalCoverage');
  expect(request.jsonSchema.schema.properties.goalCoverage.items.properties.id.enum).toEqual(goals.map(goal => goal.id));
});

test.each([
  ['missing', undefined], ['partial', [covered[0]]], ['duplicate', [covered[0], covered[0]]],
  ['unknown ID', [covered[0], { id: 'unrelated', isCovered: true }]],
  ['nonboolean', [covered[0], { id: 'lo-3', isCovered: 'yes' }]],
  ['extra item', [...covered, { id: 'lo-4', isCovered: true }]],
  ['extra field', [covered[0], { ...covered[1], correctedQuestion: 'A different task.' }]]
])('%s coverage cannot pass either default reviewer', async (_label, goalCoverage) => {
  for (const questionType of ['multiple-choice', 'essay']) {
    const complete = completion(payload(questionType, goalCoverage));
    await expect(reviewQuestionWithDefaultPolicy({ draft, questionType, requiredLearningGoals: goals, complete }))
      .rejects.toMatchObject({ qualityFailureReason: 'INSTRUCTION_MISMATCH' });
    expect(complete).toHaveBeenCalledTimes(1);
  }
});

test.each(formats)('%s exact passing coverage is persisted in bounded summaries without changing the original task', async questionType => {
  const complete = completion(payload(questionType, [...covered].reverse()));
  const checked = await reviewQuestionWithDefaultPolicy({ draft, questionType, requiredLearningGoals: goals, complete });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(checked.questionText).toBe(draft.questionText); expect(checked.correctAnswer).toBe(draft.correctAnswer);
  expect(checked.reviewSummary).toMatchObject({ policyVersion: QUESTION_REVIEW_POLICY_VERSION,
    goalCoveragePolicyVersion: QUESTION_GOAL_COVERAGE_POLICY_VERSION, goalCoverage: covered });
  const stored = new Question({ generationMetadata: { reviewSummary: checked.reviewSummary } }).toObject();
  expect(stored.generationMetadata.reviewSummary.goalCoverage).toEqual(covered);
  const rejected = new RejectedQuestionDraft({ reviewSummary: checked.reviewSummary }).toObject();
  expect(rejected.reviewSummary.goalCoverage).toEqual(covered);
  expect(JSON.stringify(checked.reviewSummary)).not.toContain(goals[0].text);
});

test('missing merged-goal coverage uses the existing one full-item repair, retaining the exact obligations', async () => {
  const complete = completion(payload('multiple-choice', covered));
  complete.mockResolvedValueOnce({ content: JSON.stringify(payload('multiple-choice', [covered[0], { ...covered[1], isCovered: false }])) });
  const generate = jest.fn(async config => reviewQuestionWithDefaultPolicy({ draft, questionType: config.questionType,
    requiredLearningGoals: config.requiredLearningGoals, complete }));
  const onRepair = jest.fn();
  await expect(generateWithRework({ config: { questionType: 'multiple-choice', requiredLearningGoals: goals, customPrompt: 'Combine the two original goals in this item.' },
    generate, onAttempt: async () => {}, onRepair, enabled: true })).resolves.toMatchObject({ reviewSummary: { goalCoverage: covered } });
  expect(generate).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
  expect(onRepair).toHaveBeenCalledWith('instructions');
  expect(generate.mock.calls[1][0].requiredLearningGoals).toEqual(goals);
  expect(generate.mock.calls[1][0].repairDraft).toBeUndefined();
});

test('a custom strategy cannot bypass the additional goal contract with generic passing metadata', async () => {
  const summary = { kind: 'semantic', policyVersion: QUESTION_REVIEW_POLICY_VERSION, mediaInspection: 'not-performed',
    checks: Object.fromEntries(QUESTION_REVIEW_VERDICT_FIELDS.map(field => [field, true])) };
  const registry = new QuestionAIStrategyRegistry();
  for (const goalSummary of [{}, { goalCoveragePolicyVersion: 'older', goalCoverage: covered },
    { goalCoveragePolicyVersion: QUESTION_GOAL_COVERAGE_POLICY_VERSION, goalCoverage: [covered[0]] }]) {
    registry.register('essay', { id: 'custom-goal-review', review: async ({ draft }) => ({ ...draft,
      qualityReview: 'ai-semantic-reviewed', reviewSummary: { ...summary, ...goalSummary } }) }, { replace: true });
    await expect(registry.resolve('essay').review({ draft, requiredLearningGoals: goals })).rejects.toMatchObject({
      qualityFailureReason: 'INSTRUCTION_MISMATCH', repairKind: 'redraft'
    });
  }
  registry.register('essay', { id: 'custom-complete-goal-review', review: async ({ draft }) => ({ ...draft,
    qualityReview: 'ai-semantic-reviewed', reviewSummary: { ...summary, goalCoveragePolicyVersion: QUESTION_GOAL_COVERAGE_POLICY_VERSION, goalCoverage: covered } }) }, { replace: true });
  await expect(registry.resolve('essay').review({ draft, requiredLearningGoals: goals })).resolves.toMatchObject({ reviewSummary: { goalCoverage: covered } });
  // A prior ordinary review remains valid when this extra contract is absent.
  registry.register('essay', { id: 'ordinary-review', review: async ({ draft }) => ({ ...draft,
    qualityReview: 'ai-semantic-reviewed', reviewSummary: summary }) }, { replace: true });
  await expect(registry.resolve('essay').review({ draft })).resolves.toMatchObject({ reviewSummary: summary });
});

test('the extra coverage check preserves insufficient-evidence priority and never automatically redrafts unsupported content', async () => {
  const complete = completion({ ...payload('essay'), evidenceIsSufficient: false });
  const generate = jest.fn(async () => reviewQuestionWithDefaultPolicy({ draft, questionType: 'essay', requiredLearningGoals: goals, complete }));
  await expect(generateWithRework({ config: {}, generate, onAttempt: async () => {}, enabled: true }))
    .rejects.toMatchObject({ qualityFailureReason: 'EVIDENCE_INSUFFICIENT', repairKind: 'none' });
  expect(generate).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
});
