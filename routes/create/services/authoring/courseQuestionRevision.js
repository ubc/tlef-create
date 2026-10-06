import Material from '../../models/Material.js';
import Question from '../../models/Question.js';
import { AuthoringRun } from '../../models/StudioAuthoring.js';
import llmService from '../llmService.js';
import ragService from '../ragService.js';
import questionStreamingService from '../questionStreamingService.js';
import { findMostSimilarQuestion } from '../questionMemoryService.js';
import { formatContentForDatabase } from '../questionContentService.js';
import { isMaterialReady } from '../../utils/generationReadiness.js';
import { listAuthoringQuestionTypes } from './authoringActivityCapabilities.js';
import { effectiveTeachingBrief } from './authoringRequirements.js';
import { reconcileQuestionCount } from './teachingRequirements.js';
import { reviseCourseObjectives } from './courseObjectiveRevision.js';
import { QUESTION_REVIEW_POLICY_VERSION, QUESTION_GOAL_COVERAGE_POLICY_VERSION, assessLearningGoalCoverage } from '../questionReviewContract.js';
import { generateWithRework } from '../questionRework.js';
import { buildAuthoringSourceContract, validateAuthoringSourceContract } from './authoringSourceContract.js';
import { authoringOperation } from './authoringOperations.js';
import { digest, fail, stableId } from './authoringContracts.js';

const copy = value => JSON.parse(JSON.stringify(value));
const referenceId = value => String(value?._id || value || '');
const responseError = message => fail(message, 422, 'AUTHORING_RESPONSE');
const indices = (value, count, name) => {
  if (!Array.isArray(value) || value.some(index => !Number.isInteger(index) || index < 1 || index > count)
    || new Set(value).size !== value.length) responseError(`${name} must identify distinct questions in the current version.`);
  return [...value].sort((left, right) => left - right);
};
const diagnostic = (code, message, details = {}, choices = ['Combine related learning objectives while keeping all topics', 'Discuss which learning objectives to exclude']) => ({
  ready: false, diagnostic: { code, message, ...details,
    clarification: [{ question: message.slice(0, 300), options: choices }] }
});
const rowMatches = (question, row) => referenceId(question.learningObjective) === referenceId(row.learningObjective)
  && question.type === row.type && (!row.difficulty || question.difficulty === row.difficulty)
  && (row.type !== 'multiple-choice' || !row.selectionMode || (question.content?.selectionMode || 'single') === row.selectionMode);

/** Plan a revision without spending credits or changing the saved activity.
 * Indices always refer to the original snapshot, including after removals.
 * A diagnostic is input for the next agent decision, never permission to drop
 * objectives or silently publish a reduced-coverage activity.
 */
export function planCourseQuestionRevision({ snapshot, decision, teachingRequirements = {}, baseVersionId, requestId, latestRequest, owner,
  allowedQuestionTypes = listAuthoringQuestionTypes().map(item => item.questionType) }) {
  const originalObjectives = new Map((snapshot?.learningObjectives || []).map(objective => [referenceId(objective), objective]));
  const objectiveRevision = reviseCourseObjectives({ snapshot, changes: decision.objectiveChanges, latestRequest, owner, baseVersionId, requestId });
  snapshot = objectiveRevision.snapshot;
  const questions = snapshot?.questions;
  if (!Array.isArray(questions) || !questions.length) responseError('Generate the first activity before revising its questions.');
  const count = questions.length;
  const removed = new Set([...indices(decision.removeQuestionIndices || [], count, 'Removal indices'), ...objectiveRevision.excludedQuestionIndices]);
  const target = decision.targetQuestionCount ?? count - removed.size;
  if (!Number.isInteger(target) || target < 1 || target > 20) {
    responseError('Choose a target of 1–20 questions.');
  }
  if (teachingRequirements.countIssue) return diagnostic('QUESTION_COUNT_UNCONFIRMED', teachingRequirements.countIssue,
    { targetQuestionCount: target }, ['Confirm this question count', 'Choose another question count']);
  const confirmed = teachingRequirements.fields?.questionCount?.value;
  if (confirmed != null && confirmed !== target) return diagnostic('QUESTION_COUNT_CONFLICT',
    `The saved requirement is ${confirmed} questions, but this revision would contain ${target}. Confirm the intended count.`,
    { targetQuestionCount: target, confirmedQuestionCount: confirmed }, [`Use ${confirmed} questions`, `Change the requirement to ${target} questions`]);
  if (decision.scope != null && decision.scope !== 'all') responseError('Choose all questions or explicit question indices.');
  if (decision.scope === 'all' && decision.questionIndices != null) responseError('Use one question selection, not both all and indices.');
  const selected = decision.scope === 'all' ? questions.map((_, index) => index + 1)
    : indices(decision.questionIndices, count, 'Revision indices');
  if (!selected.length && target === count && !removed.size && !objectiveRevision.affectedQuestionIndices.length) responseError('Select questions to revise or request a quantity change.');
  for (const [field, values] of Object.entries({ questionType: allowedQuestionTypes,
    difficulty: ['easy', 'moderate', 'hard'], selectionMode: ['single', 'multiple'] })) {
    if (decision[field] != null && !values.includes(decision[field])) responseError('The requested question change is unsupported.');
  }

  const objectives = new Map((snapshot.learningObjectives || []).map(objective => [referenceId(objective), objective]));
  const requiredGoals = new Map();
  const unavailableGoals = new Set();
  for (const [objectiveId, objective] of objectives) {
    const revision = objective.generationMetadata?.objectiveRevision;
    if (revision?.kind !== 'merge') continue;
    const goals = revision.sourceGoals?.length ? revision.sourceGoals.map(goal => ({ id: referenceId(goal.id), text: goal.text }))
      : (revision.sourceObjectiveIds || []).map(id => ({ id: referenceId(id), text: originalObjectives.get(referenceId(id))?.text }));
    if (!goals.length || goals.length > 8 || goals.some(goal => !/^[a-f\d]{24}$/i.test(goal.id) || typeof goal.text !== 'string' || !goal.text.trim() || goal.text.length > 500)
      || new Set(goals.map(goal => goal.id)).size !== goals.length) { unavailableGoals.add(objectiveId); continue; }
    requiredGoals.set(objectiveId, goals);
  }
  const rows = copy(snapshot.settings?.planItems || []);
  const required = new Set([...questions.map((question, index) => objectiveRevision.excludedQuestionIndices.includes(index + 1) ? '' : referenceId(question.learningObjective)),
    ...rows.map(row => referenceId(row.learningObjective))].filter(Boolean));
  if ([...required].some(id => !objectives.has(id))) return diagnostic('QUESTION_OBJECTIVE_UNAVAILABLE',
    'Some question or plan objectives are missing from this saved version. Review the learning objectives before changing the activity.',
    { objectiveIds: [...required].filter(id => !objectives.has(id)) }, ['Review the learning objectives', 'Keep the current activity']);
  const coverage = new Map();
  questions.forEach((question, index) => {
    const id = referenceId(question.learningObjective);
    if (!removed.has(index + 1) && id) coverage.set(id, (coverage.get(id) || 0) + 1);
  });
  const blocked = [...required].filter(id => !coverage.get(id));
  const describe = ids => ids.map(id => ({ id, text: String(objectives.get(id)?.text || '').slice(0, 180) }));
  if (target < required.size || (blocked.length && target <= count - removed.size)) {
    return diagnostic('QUESTION_COVERAGE_CONFLICT',
      `This change cannot preserve coverage of ${required.size} learning objectives with the requested removals and ${target} questions.`,
      { targetQuestionCount: target, minimumQuestionCount: required.size, objectives: describe(blocked.length ? blocked : [...required]) });
  }
  // Remove from the end while protecting the last question for each objective.
  for (let index = count; count - removed.size > target && index > 0; index -= 1) {
    if (removed.has(index)) continue;
    const id = referenceId(questions[index - 1].learningObjective);
    if (id && coverage.get(id) <= 1) continue;
    removed.add(index);
    if (id) coverage.set(id, coverage.get(id) - 1);
  }
  if (count - removed.size > target) return diagnostic('QUESTION_COVERAGE_CONFLICT',
    'The requested quantity would remove the final question for a learning objective. Choose how to preserve the topic coverage.',
    { targetQuestionCount: target, minimumQuestionCount: required.size, objectives: describe([...required]) });
  if (decision.scope !== 'all' && selected.some(index => removed.has(index))) responseError('A question cannot be both revised and removed in the same request.');
  const retainedIndices = questions.map((_, index) => index + 1).filter(index => !removed.has(index));
  const task = (kind, sourceIndex, row, number) => {
    const original = sourceIndex ? questions[sourceIndex - 1] : null;
    const type = decision.questionType || original?.type || row?.type;
    const difficulty = decision.difficulty || original?.difficulty || row?.difficulty || 'moderate';
    const selectionMode = type === 'multiple-choice'
      ? decision.selectionMode || original?.content?.selectionMode || row?.selectionMode || 'single' : 'single';
    if (!allowedQuestionTypes.includes(type)) responseError('One selected type cannot be generated in this activity.');
    if (decision.selectionMode && type !== 'multiple-choice') responseError('Answer selection mode applies only to multiple-choice questions.');
    const objectiveId = referenceId(original?.learningObjective || row?.learningObjective);
    const customPrompt = row?.customPrompt || original?.generationMetadata?.instructorPrompt || '';
    if (!objectiveId && !customPrompt.trim()) responseError('A selected question requires an existing objective or saved custom prompt.');
    return { key: kind === 'revise' ? `revise-${sourceIndex}` : `add-${number}`, kind, sourceIndex,
      questionId: original ? referenceId(original) : stableId(`${baseVersionId}:${requestId}:addition:${number}`),
      questionType: type, difficulty, selectionMode, objectiveId, row: row || null, customPrompt,
      ...(requiredGoals.has(objectiveId) ? { requiredLearningGoals: copy(requiredGoals.get(objectiveId)) } : {}) };
  };
  const tasks = retainedIndices.filter(index => selected.includes(index) || objectiveRevision.affectedQuestionIndices.includes(index)).map(index => {
    const matches = rows.filter(row => rowMatches(questions[index - 1], row));
    return task('revise', index, matches.length === 1 ? matches[0] : null);
  });
  const additions = target - retainedIndices.length;
  if (additions) {
    if (!rows.length || rows.some(row => (!referenceId(row.learningObjective) && !String(row.customPrompt || '').trim())
      || (referenceId(row.learningObjective) && !objectives.has(referenceId(row.learningObjective)))
      || !allowedQuestionTypes.includes(decision.questionType || row.type) || !Number.isInteger(row.count) || row.count < 1)) {
      return diagnostic('QUESTION_EXTENSION_PLAN_REQUIRED',
        'Adding questions needs a valid saved plan with supported question types and existing objectives or custom prompts.',
        { targetQuestionCount: target }, ['Review an extension plan', 'Keep the current question count']);
    }
    if (rows.length > target) return diagnostic('QUESTION_EXTENSION_PLAN_CONFLICT',
      `The saved plan contains ${rows.length} distinct rows, exceeding the requested ${target} questions. Discuss which rows to merge.`,
      { targetQuestionCount: target, minimumQuestionCount: rows.length });
    const counts = rows.map(() => 0);
    for (const index of retainedIndices) {
      const matches = rows.map((row, rowIndex) => rowMatches(questions[index - 1], row) ? rowIndex : -1).filter(index => index >= 0);
      if (matches.length !== 1) return diagnostic('QUESTION_EXTENSION_PLAN_AMBIGUOUS',
        'The saved questions cannot be matched uniquely to the plan. Confirm the allocation before adding new questions.',
        { questionIndex: index, targetQuestionCount: target }, ['Review the question allocation', 'Keep the current question count']);
      counts[matches[0]] += 1;
    }
    const desired = reconcileQuestionCount(rows, { fields: { questionCount: { value: target } } });
    for (let number = 1; number <= additions; number += 1) {
      const candidates = rows.map((row, index) => ({ index, deficit: desired[index].count - counts[index] }));
      candidates.sort((left, right) => right.deficit - left.deficit || left.index - right.index);
      const rowIndex = candidates[0].index;
      const addition = task('add', null, rows[rowIndex], number);
      const chapters = snapshot.chapters || [];
      if (chapters.length) {
        const matches = chapters.map((chapter, index) => ({ index, matches: (chapter.questionIds || []).some(id => {
          const question = questions.find(candidate => referenceId(candidate) === referenceId(id));
          return question && referenceId(question.learningObjective) === addition.objectiveId;
        }) })).filter(chapter => chapter.matches);
        if (chapters.length > 1 && matches.length !== 1) return diagnostic('QUESTION_EXTENSION_CHAPTER_AMBIGUOUS',
          'A new question cannot be assigned uniquely to the existing chapters. Review its chapter placement before extending this activity.',
          { targetQuestionCount: target, objectiveId: addition.objectiveId }, ['Review chapter placement', 'Keep the current question count']);
        addition.chapterIndex = chapters.length === 1 ? 0 : matches[0].index;
      }
      tasks.push(addition); counts[rowIndex] += 1;
      const id = referenceId(rows[rowIndex].learningObjective);
      if (id) coverage.set(id, (coverage.get(id) || 0) + 1);
    }
    if ([...required].some(id => !coverage.get(id))) return diagnostic('QUESTION_COVERAGE_CONFLICT',
      'The requested extension cannot preserve every saved learning objective. Review the allocation before generating.',
      { targetQuestionCount: target, objectives: describe([...required].filter(id => !coverage.get(id))) });
  }
  const missingGoals = tasks.find(task => unavailableGoals.has(task.objectiveId));
  if (missingGoals) return diagnostic('QUESTION_MERGED_GOALS_UNAVAILABLE',
    'This saved merged objective lacks a complete original-goal contract. Confirm its source goals before generating a replacement question.',
    { objectiveIds: [missingGoals.objectiveId] }, ['Review the merged learning goals', 'Keep the current activity']);
  return { ready: true, plan: { baseVersionId: String(baseVersionId), retainedIndices,
    removedQuestionIndices: [...removed].sort((left, right) => left - right), targetQuestionCount: target, tasks,
    ...(decision.objectiveChanges ? { objectiveSnapshot: { learningObjectives: snapshot.learningObjectives,
      planItems: snapshot.settings?.planItems || [], changes: objectiveRevision.changes,
      affectedQuestionIndices: objectiveRevision.affectedQuestionIndices } } : {}) } };
}

async function savePaidReceipt({ session, run, state, name }) {
  // Receipt-only write: a returned paid response can be saved after cancellation,
  // but only the worker holding this run's current lease may write it.
  if (!run.leaseToken) fail('The paid response could not be saved without an execution lease.');
  const result = await AuthoringRun.updateOne({ _id: run._id, owner: session.owner, sessionId: session._id,
    status: 'running', leaseToken: run.leaseToken, leaseUntil: { $gt: new Date() } }, {
    $set: { checkpoint: name, result: { questionRevision: state } },
    $push: { steps: { $each: [{ name, createdAt: new Date() }], $slice: -40 } }
  });
  if (!result.matchedCount) fail('The execution lease was lost before the paid response could be saved.');
}

const defaultDependencies = {
  findMaterials: filter => Material.find(filter), ready: isMaterialReady,
  retrieve: (...args) => ragService.retrieveRelevantContent(...args),
  generate: config => llmService.generateQuestion(config),
  format: formatContentForDatabase,
  references: chunks => questionStreamingService.buildSourceReferences(chunks),
  validate: record => new Question(record).validate(),
  matchesPlan: (question, task) => llmService.questionMatchesPlannedTask(question, task),
  similar: findMostSimilarQuestion, operation: authoringOperation,
  brief: effectiveTeachingBrief, savePaidReceipt,
  buildSourceContract: buildAuthoringSourceContract, validateSourceContract: validateAuthoringSourceContract
};
const boundedObservation = value => value ? {
  questionText: String(value.questionText || '').slice(0, 2000), correctAnswer: String(value.correctAnswer || '').slice(0, 2000),
  contentSummary: String(value.contentSummary || '').slice(0, 4000),
  issues: (Array.isArray(value.issues) ? value.issues : []).slice(0, 8).map(issue => String(issue).slice(0, 600))
} : undefined;
const safeFailure = error => ({ code: error.code || 'QUESTION_REVISION_FAILED',
  reason: error.qualityFailureReason || '', reviewKind: error.reviewKind || '', repairKind: error.repairKind || '',
  ...(error.rejectedDraft ? { observation: boundedObservation(error.rejectedDraft) } : {}),
  message: error.status || error.code === 'QUESTION_QUALITY_REVIEW' ? String(error.message).slice(0, 600)
    : 'This question could not finish. Saved revisions are preserved; resume explicitly.' });
const onlyReviewRetry = failure => ['REVIEW_UNAVAILABLE', 'REVIEW_LIMIT_REACHED', 'REVIEW_INVALID_RESPONSE'].includes(failure?.reason)
  || failure?.repairKind === 'feedback'
  || (failure?.reviewKind !== 'semantic' && failure?.repairKind !== 'redraft'
        && (failure?.reason === 'FEEDBACK_INVALID' || String(failure?.reason || '').startsWith('ARITHMETIC_')));
const needsNewDraft = failure => failure?.repairKind === 'redraft'
  || ['QUESTION_INVALID_RESPONSE', 'QUESTION_SLICE_MISMATCH', 'QUESTION_DUPLICATE'].includes(failure?.code)
  || ['ANSWER_INVALID', 'INSTRUCTION_MISMATCH', 'RUBRIC_INVALID', 'CONTENT_INVALID'].includes(failure?.reason);
const requireReviewedGoals = (summary, task) => {
  if (!task.requiredLearningGoals?.length) return;
  if (summary?.goalCoveragePolicyVersion !== QUESTION_GOAL_COVERAGE_POLICY_VERSION
    || !assessLearningGoalCoverage(task.requiredLearningGoals, summary?.goalCoverage).valid) {
    fail('The saved merged question lacks complete checks for its original learning goals. Start a new explicit revision.', 409, 'AUTHORING_REVIEW_POLICY_CHANGED');
  }
};

/** Construct a candidate snapshot with durable per-item paid receipts.
 * This service cannot save Question records, create versions or publish a Quiz.
 */
export function createCourseQuestionRevisionService(overrides = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function runCourseQuestionRevision({ session, run, current, decision, latestRequest, signal,
    guard = async () => {}, checkpoint, resumeState, explicitResume = false, allowedQuestionTypes }) {
    if (current?.representation !== 'course-linked') responseError('Batch question changes require a course-linked version.');
    const planned = planCourseQuestionRevision({ snapshot: current.snapshot, decision, teachingRequirements: session.teachingRequirements,
      baseVersionId: current._id, requestId: run.input?.requestId || run.requestId, latestRequest, owner: session.owner, allowedQuestionTypes });
    if (!planned.ready) return planned;
    const goalContracts = planned.plan.tasks.filter(task => task.requiredLearningGoals?.length)
      .map(task => ({ key: task.key, requiredLearningGoals: task.requiredLearningGoals }));
    const inputHash = digest({ sessionId: String(session._id), baseVersionId: String(current._id),
      snapshot: current.fingerprint || digest(current.snapshot), requestId: run.input?.requestId || run.requestId,
      latestRequest, decision, materialIds: (session.materialIds || []).map(String).sort(),
      reviewPolicyVersion: QUESTION_REVIEW_POLICY_VERSION,
      ...(goalContracts.length ? { goalCoverageContract: { version: QUESTION_GOAL_COVERAGE_POLICY_VERSION, items: goalContracts } } : {}),
      requirements: Object.fromEntries(Object.entries(session.teachingRequirements?.fields || {}).map(([key, field]) => [key, field.value])) });
    let state = resumeState || run.result?.questionRevision;
    if (state && state.inputHash !== inputHash) fail('The saved batch belongs to another request or version. Your activity is unchanged.');
    if (!state) {
      const authoringSourceContract = await dependencies.buildSourceContract({ session, guard, signal });
      state = { version: 1, inputHash, phase: 'planned', plan: planned.plan, items: {}, sourceRunId: String(run._id), authoringSourceContract };
    } else state = copy(state);
    const save = async (name, paid = false) => {
      const persisted = copy(state);
      if (paid) await dependencies.savePaidReceipt({ session, run, state: persisted, name });
      else { await guard(); await checkpoint(name, { questionRevision: persisted }); }
      run.result = { questionRevision: persisted }; run.checkpoint = name;
    };
    await dependencies.validateSourceContract({ session, contract: state.authoringSourceContract, guard, signal });
    if (state.phase === 'completed') {
      for (const task of planned.plan.tasks) requireReviewedGoals(state.output?.snapshot?.questions
        ?.find(question => referenceId(question) === task.questionId)?.generationMetadata?.reviewSummary, task);
      return copy(state.output);
    }
    await save('question_batch_planned');
    const source = copy(current.snapshot);
    if (state.plan.objectiveSnapshot) {
      source.learningObjectives = copy(state.plan.objectiveSnapshot.learningObjectives);
      source.settings.planItems = copy(state.plan.objectiveSnapshot.planItems);
      const revision = reviseCourseObjectives({ snapshot: current.snapshot, changes: decision.objectiveChanges, latestRequest,
        requestId: run.input?.requestId || run.requestId, baseVersionId: current._id, owner: session.owner });
      source.questions = revision.snapshot.questions;
    }
    const materialIds = [...new Set((session.materialIds || []).map(String))];
    const materials = state.plan.tasks.length ? await dependencies.findMaterials({ _id: { $in: materialIds }, uploadedBy: session.owner, folder: session.courseId }) : [];
    if (state.plan.tasks.length && (materials.length !== materialIds.length || materials.some(material => !dependencies.ready(material)))) {
      fail('The source materials are no longer ready. Saved revisions and the current activity are preserved.');
    }
    const outputQuestions = state.plan.retainedIndices.map(index => copy(source.questions[index - 1]));
    const originalPositions = new Map(state.plan.retainedIndices.map((index, position) => [index, position]));
    const originalCount = source.questions.length;
    const apply = (task, record) => {
      if (task.kind === 'revise') outputQuestions[originalPositions.get(task.sourceIndex)] = copy(record);
      else outputQuestions.push(copy(record));
    };
    for (const task of state.plan.tasks) {
      await guard(); signal?.throwIfAborted();
      await dependencies.validateSourceContract({ session, contract: state.authoringSourceContract, guard, signal });
      let item = state.items[task.key] ||= { phase: 'ready', receipts: {}, attempt: 1 };
      if (item.phase === 'completed') {
        if (item.record?.generationMetadata?.reviewSummary?.policyVersion !== QUESTION_REVIEW_POLICY_VERSION) {
          fail('The saved question was checked under another review policy. Start a new explicit revision.', 409, 'AUTHORING_REVIEW_POLICY_CHANGED');
        }
        requireReviewedGoals(item.record?.generationMetadata?.reviewSummary, task);
        apply(task, item.record); continue;
      }
      const pending = Object.values(item.receipts).some(receipt => receipt.phase === 'pending');
      if ((item.phase === 'failed' || pending) && !explicitResume) {
        fail('A question model call failed or its response is unknown. Resume explicitly; it may have used credits.', 409, 'AUTHORING_MODEL_UNCERTAIN');
      }
      if (explicitResume && (item.phase === 'failed' || pending)) {
        if (['EVIDENCE_INSUFFICIENT', 'REVIEW_INPUT_LIMIT'].includes(item.failure?.reason)) {
          fail(item.failure.message || 'Refine the evidence or scope before starting another revision.', 422, 'QUESTION_REVISION_INPUT_REQUIRED');
        }
        const reviewOnly = onlyReviewRetry(item.failure);
        const redraft = !reviewOnly && needsNewDraft(item.failure);
        // Keep historical paid receipts. A new explicit redraft starts after
        // them; a review retry replaces only the last rejected review stage.
        const nextOrdinal = phase => Math.max(-1, ...Object.keys(item.receipts).filter(key => key.startsWith(`${phase}:`))
          .map(key => Number(key.split(':')[1]))) + 1;
        if (redraft) {
          item.receiptOffsets = { draft: nextOrdinal('draft'), feedback_review: nextOrdinal('feedback_review') };
          item.resumeObservation = { reason: item.failure.reason, ...item.failure.observation };
          delete item.rework;
        }
        const lastReview = nextOrdinal('feedback_review') - 1;
        for (const [key, receipt] of Object.entries(item.receipts)) {
          if (receipt.phase === 'pending' || (reviewOnly && key === `feedback_review:${lastReview}`)) delete item.receipts[key];
        }
        if (redraft || reviewOnly) {
          delete item.generated;
        }
        item.attempt += 1; item.phase = 'ready'; delete item.failure;
        await save(`question_batch_${task.key}_resumed`);
      }
      const original = task.sourceIndex ? source.questions[task.sourceIndex - 1] : null;
      const objective = (source.learningObjectives || []).find(candidate => referenceId(candidate) === task.objectiveId);
      try {
        if (!item.evidence) {
          const retrieved = materialIds.length ? await dependencies.operation('read_question_evidence',
            `Find evidence for ${task.kind === 'add' ? 'new question' : `question ${task.sourceIndex}`}`,
            () => dependencies.retrieve(`${objective?.text || original?.questionText || task.customPrompt}\n${latestRequest}`.slice(0, 5000),
              task.questionType, { materialIds, topK: 5, minScore: 0.3 }),
            result => `Retrieved ${(result.chunks || []).length} supporting excerpts from the selected course materials.`) : { chunks: [] };
          if (materialIds.length && !retrieved?.chunks?.length) fail('No supporting evidence was found. The current activity is preserved.', 422, 'QUESTION_EVIDENCE_MISSING');
          if ((retrieved.chunks || []).some(chunk => !materialIds.includes(String(chunk.metadata?.materialId || chunk.materialId || '')))) {
            fail('Retrieved evidence is outside the selected course material scope.', 422, 'QUESTION_EVIDENCE_SCOPE');
          }
          item.evidence = { chunks: retrieved.chunks || [] }; item.phase = 'evidence_saved';
          await save(`question_batch_${task.key}_evidence_saved`);
        }
        const ordinal = new Map();
        const paidCompletion = async ({ phase, prompt, invoke }) => {
          await dependencies.validateSourceContract({ session, contract: state.authoringSourceContract, guard, signal });
          const index = ordinal.get(phase) ?? item.receiptOffsets?.[phase] ?? 0; ordinal.set(phase, index + 1);
          const key = `${phase}:${index}`;
          const promptHash = digest(prompt);
          const receipt = item.receipts[key];
          if (receipt?.phase === 'saved') {
            if (receipt.promptHash !== promptHash) fail('The saved model contract changed. Review this request before starting a new draft.', 409, 'AUTHORING_CONTRACT_CHANGED');
            return copy(receipt.response);
          }
          if (receipt?.phase === 'pending') fail('The previous model response is unknown. Resume explicitly.', 409, 'AUTHORING_MODEL_UNCERTAIN');
          await guard(); signal?.throwIfAborted();
          item.receipts[key] = { phase: 'pending', promptHash }; item.phase = 'model_pending';
          await save(`question_batch_${task.key}_${phase}_model_pending`);
          const response = await invoke();
          const usage = response?.usage && typeof response.usage === 'object'
            ? Object.fromEntries(Object.entries(response.usage).filter(([, value]) => typeof value === 'number')) : undefined;
          item.receipts[key] = { phase: 'saved', promptHash, response: { content: String(response?.content || ''),
            ...(typeof response?.model === 'string' ? { model: response.model } : {}), ...(usage ? { usage } : {}) } };
          item.phase = 'model_saved';
          // Save before checking cancellation or parsing. This write does not
          // authorize another call or a commit after the teacher stops work.
          await save(`question_batch_${task.key}_${phase}_model_saved`, true);
          await guard(); signal?.throwIfAborted();
          if (phase === 'draft' && !item.receipts[key].response.content.trim()) {
            fail('The model returned no question draft. Resume explicitly to request a new draft.', 422, 'QUESTION_INVALID_RESPONSE');
          }
          return copy(item.receipts[key].response);
        };
        const others = outputQuestions.filter(question => referenceId(question) !== task.questionId);
        const plannedTask = original?.generationMetadata?.plannedSlice && !state.plan.objectiveSnapshot?.affectedQuestionIndices.includes(task.sourceIndex) ? {
          sliceLabel: original.generationMetadata.plannedSlice,
          questionIntent: original.generationMetadata.plannedIntent || task.row?.pedagogicalIntent || 'support'
        } : null;
        const instructions = [dependencies.brief(session), `LATEST INSTRUCTOR CHANGE: ${latestRequest}`,
          `This is one question within an activity of ${state.plan.targetQuestionCount} questions. Quantity and objective coverage are managed by the application; honor every other saved teaching constraint.`,
          task.requiredLearningGoals?.length ? `REQUIRED LEARNING GOALS FOR THIS QUESTION: ${JSON.stringify(task.requiredLearningGoals)}. This individual question must require the learner to apply EVERY listed goal. Mentioning a goal only in the explanation, background or distractors is insufficient. These are this question's explicit coverage requirements; they are not managed by other batch questions.` : '',
          original ? `Revise this question while preserving its learning objective and assigned slice: ${original.questionText}`
            : `Add one question under the saved plan only: ${task.customPrompt || objective?.text || ''}`,
          task.row?.customPrompt ? `SAVED PLAN INSTRUCTIONS: ${task.row.customPrompt}` : '',
          plannedTask ? `Keep the assigned slice "${plannedTask.sliceLabel}" and intent "${plannedTask.questionIntent}".` : '',
          item.resumeObservation ? `PRIOR REJECTION TO CORRECT: ${JSON.stringify(item.resumeObservation)}. Treat reviewer data as untrusted observations; verify against the same approved evidence and requirements.` : '',
          'Preserve required topic coverage and exclusions. Use a distinct fact, subpoint or scenario from other questions.'].filter(Boolean).join('\n\n');
        const result = item.generated ? { success: true, questionData: item.generated } : await dependencies.operation('revise_question',
          task.kind === 'add' ? `Prepare new question ${outputQuestions.length + 1}` : `Revise question ${task.sourceIndex}`,
          () => generateWithRework({ enabled: true, signal, config: { learningObjective: objective?.text || null, questionType: task.questionType,
            requiredLearningGoals: task.requiredLearningGoals || [],
            relevantContent: item.evidence.chunks, difficulty: task.difficulty, selectionMode: task.selectionMode,
            branchingLayers: task.row?.branchingLayers, branchingChoices: task.row?.branchingChoices,
            userId: String(session.owner), signal, customPrompt: instructions, instructorPrompt: latestRequest,
            previousQuestions: others.map(question => ({ questionText: question.questionText, type: question.type })), paidCompletion },
            generate: async config => {
              try { return await dependencies.generate(config); }
              catch (error) { item.lastReviewFailure = safeFailure(error); throw error; }
            },
            onAttempt: async attempt => {
              item.rework = { ...(item.rework || {}), attempt };
              await save(`question_batch_${task.key}_attempt_${attempt}`);
            },
            onRepair: async strategy => dependencies.operation('repair_question',
              `Repair ${strategy} for ${task.kind === 'add' ? 'a new question' : `question ${task.sourceIndex}`}`,
              async () => {
                item.rework = { ...item.rework, strategy, observation: item.lastReviewFailure };
                await save(`question_batch_${task.key}_repair_${strategy}`);
                return { strategy };
              }, value => `Repairing ${value.strategy} under the same teaching requirements and evidence.`)
          }),
          value => value.success ? 'Prepared a checked question draft; the current activity is preserved.' : 'The question draft did not pass generation checks.');
        if (!result.success || !result.questionData) fail('The revised question did not pass generation checks.', 422, 'QUESTION_REVISION_FAILED');
        const data = result.questionData;
        if (data.generationMetadata?.reviewSummary?.policyVersion !== QUESTION_REVIEW_POLICY_VERSION) {
          fail('The checked draft uses another review policy. Start a new explicit revision under the current policy.', 409, 'AUTHORING_REVIEW_POLICY_CHANGED');
        }
        requireReviewedGoals(data.generationMetadata?.reviewSummary, task);
        // Save the checked generation before deterministic content conversion.
        item.generated = copy(data); item.phase = 'generation_saved';
        await save(`question_batch_${task.key}_generation_saved`);
        const match = dependencies.matchesPlan(data, plannedTask);
        if (!match.valid) fail('The generated question does not preserve its assigned planned slice.', 422, 'QUESTION_SLICE_MISMATCH');
        const similar = dependencies.similar(data.questionText, others);
        if (similar.similarity >= 0.92) fail('The generated question repeats another question. Resume explicitly to create a distinct draft.', 422, 'QUESTION_DUPLICATE');
        const references = dependencies.references(item.evidence.chunks);
        const metadata = { ...original?.generationMetadata, ...data.generationMetadata,
          generatedFrom: references.map(reference => reference.materialId).filter(Boolean), sourceReferences: references,
          instructorPrompt: latestRequest, plannedSliceValidation: match, generatedAt: new Date().toISOString() };
        if (state.plan.objectiveSnapshot?.affectedQuestionIndices.includes(task.sourceIndex)) {
          metadata.plannedSlice = objective?.text; metadata.plannedIntent = task.row?.pedagogicalIntent || 'support';
        }
        delete metadata.noveltyScore; delete metadata.duplicateCheck;
        if (!data.generationMetadata?.qualityReview) delete metadata.qualityReview;
        if (!data.generationMetadata?.reviewSummary) delete metadata.reviewSummary;
        const record = { ...(original || {}), _id: task.questionId, quiz: referenceId(source), createdBy: String(session.owner),
          learningObjective: task.objectiveId || null, type: task.questionType, difficulty: task.difficulty,
          questionText: data.questionText, content: dependencies.format(data, task.questionType),
          correctAnswer: data.correctAnswer, explanation: data.explanation, generationMetadata: metadata,
          reviewStatus: 'pending', order: original?.order ?? originalCount + outputQuestions.length - state.plan.retainedIndices.length };
        await dependencies.validate(record);
        item.record = copy(record); item.phase = 'completed'; delete item.generated;
        await save(`question_batch_${task.key}_saved`); apply(task, item.record);
      } catch (error) {
        if (error.code === 'QUESTION_QUALITY_REVIEW' && !error.status) error.status = 422;
        item.failure = safeFailure(error); item.phase = 'failed';
        // Do not overwrite a returned paid receipt merely because cancellation
        // prevents this later failure checkpoint.
        try { await save(`question_batch_${task.key}_failed`); } catch { /* Lease/cancellation guard wins. */ }
        throw error;
      }
    }
    const snapshot = copy(source); snapshot.questions = outputQuestions;
    const liveIds = new Set(outputQuestions.map(referenceId));
    snapshot.chapters = (snapshot.chapters || []).map(chapter => ({ ...chapter,
      questionIds: (chapter.questionIds || []).filter(id => liveIds.has(referenceId(id))) }));
    const additions = state.plan.tasks.filter(task => task.kind === 'add');
    for (const task of additions) {
      if (task.chapterIndex != null) snapshot.chapters[task.chapterIndex].questionIds.push(task.questionId);
    }
    // Persist truthful counts for each surviving plan contract. Content-only
    // revisions preserve the original plan fields; explicit overrides update
    // only the affected contracts, retaining their custom prompts and metadata.
    const planRows = [];
    for (const question of outputQuestions) {
      const originalRow = (source.settings?.planItems || []).find(row => rowMatches(question, row))
        || state.plan.tasks.find(task => task.questionId === referenceId(question))?.row;
      const row = { ...(originalRow || {}), type: question.type, learningObjective: referenceId(question.learningObjective) || null,
        difficulty: question.difficulty, ...(question.type === 'multiple-choice' ? { selectionMode: question.content?.selectionMode || 'single' } : {}) };
      if (!row.learningObjective && !row.customPrompt) row.customPrompt = question.generationMetadata?.instructorPrompt || latestRequest;
      const signature = digest({ ...row, count: undefined, _id: undefined });
      const existing = planRows.find(candidate => candidate.signature === signature);
      if (existing) existing.row.count += 1; else planRows.push({ signature, row: { ...row, count: 1 } });
    }
    snapshot.settings = { ...(snapshot.settings || {}), planItems: planRows.map(item => item.row),
      aiConfig: { ...(snapshot.settings?.aiConfig || {}), totalQuestions: state.plan.targetQuestionCount } };
    const revised = state.plan.tasks.filter(task => task.kind === 'revise').map(task => task.sourceIndex);
    const changes = [...(state.plan.objectiveSnapshot?.changes || []), revised.length ? `Revised question${revised.length === 1 ? '' : 's'} ${revised.join(', ')}.` : '',
      state.plan.removedQuestionIndices.length ? `Removed questions ${state.plan.removedQuestionIndices.join(', ')} while preserving learning-objective coverage.` : '',
      additions.length ? `Added ${additions.length} question${additions.length === 1 ? '' : 's'} under the saved learning-objective plan.` : '',
      `The proposal contains ${outputQuestions.length} questions. Unselected question content, evidence and learning objectives are preserved.`].filter(Boolean);
    await dependencies.validateSourceContract({ session, contract: state.authoringSourceContract, guard, signal });
    state.output = { snapshot, representation: 'course-linked', changes, authoringSourceContract: copy(state.authoringSourceContract) }; state.phase = 'completed';
    for (const item of Object.values(state.items)) { delete item.record; delete item.generated; delete item.evidence; }
    await save('question_batch_completed');
    return copy(state.output);
  };
}

export const runCourseQuestionRevision = createCourseQuestionRevisionService();
