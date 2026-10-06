import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { AuthoringRun } from '../../models/StudioAuthoring.js';
import { createCourseQuestionRevisionService, planCourseQuestionRevision } from '../../services/authoring/courseQuestionRevision.js';
import { QUESTION_REVIEW_POLICY_VERSION, QUESTION_GOAL_COVERAGE_POLICY_VERSION } from '../../services/questionReviewContract.js';
import { normalizeObjectiveChanges, reviseCourseObjectives } from '../../services/authoring/courseObjectiveRevision.js';
import LearningObjective from '../../models/LearningObjective.js';
import Question from '../../models/Question.js';
import { updateTeachingRequirements } from '../../services/authoring/teachingRequirements.js';

const owner = '111111111111111111111111';
const quizId = '222222222222222222222222';
const sessionId = '333333333333333333333333';
const runId = '444444444444444444444444';
const versionId = '555555555555555555555555';
const lo1 = '666666666666666666666666';
const lo2 = '777777777777777777777777';
const materialId = '888888888888888888888888';
const allowedQuestionTypes = ['multiple-choice', 'true-false'];
const reviewed = { qualityReview: 'ai-semantic-reviewed', reviewSummary: { kind: 'semantic', policyVersion: QUESTION_REVIEW_POLICY_VERSION,
  checks: { contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true, feedbackIsConsistent: true,
    followsInstructorRequest: true, evidenceIsSufficient: true }, arithmeticChecks: 0, mediaInspection: 'not-performed' } };
const question = (index, objective = lo1) => ({
  _id: String(index).padStart(24, '0'), quiz: quizId, createdBy: owner, learningObjective: objective,
  type: 'true-false', difficulty: 'moderate', questionText: `Original task ${index}`, order: index - 1,
  content: { options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }] },
  correctAnswer: 'True', explanation: `Original explanation ${index}`, reviewStatus: 'approved',
  generationMetadata: { sourceReferences: [{ materialId, excerpt: `Evidence ${index}` }],
    plannedSlice: `slice-${index}`, plannedIntent: 'support', noveltyScore: 0.8, qualityReview: 'ai-feedback-reviewed' },
  editHistory: [{ changes: `Original history ${index}` }]
});
const snapshot = () => ({ _id: quizId, name: 'Motion', materials: [materialId],
  questions: [question(1), question(2), question(3, lo2)],
  learningObjectives: [{ _id: lo1, text: 'Explain force' }, { _id: lo2, text: 'Apply acceleration' }],
  settings: { planItems: [{ type: 'true-false', learningObjective: lo1, count: 2, difficulty: 'moderate', customPrompt: 'Use a force example.' },
    { type: 'true-false', learningObjective: lo2, count: 1, difficulty: 'moderate', customPrompt: 'Use an acceleration example.' }] },
  chapters: [{ title: 'Motion', questionIds: ['000000000000000000000001', '000000000000000000000002', '000000000000000000000003'] }] });
const plan = decision => planCourseQuestionRevision({ snapshot: snapshot(), decision, baseVersionId: versionId,
  requestId: 'test-request-12345678', allowedQuestionTypes });
const fixture = (decision = { action: 'revise_questions', questionIndices: [1, 2], difficulty: 'easy' }) => {
  const calls = [];
  const dependencies = {
    findMaterials: jest.fn().mockResolvedValue([]), ready: () => true,
    retrieve: jest.fn().mockResolvedValue({ chunks: [] }),
    format: data => data.content, references: chunks => chunks.map(chunk => ({ materialId: chunk.metadata.materialId, excerpt: chunk.content })),
    validate: jest.fn().mockResolvedValue(undefined), matchesPlan: () => ({ valid: true }), similar: () => ({ similarity: 0 }),
    operation: async (_name, _label, work) => work(), brief: () => 'Preserve the force and acceleration topics.',
    buildSourceContract: jest.fn().mockResolvedValue({ version: 1, sourceSignature: 'fixture' }),
    validateSourceContract: jest.fn().mockResolvedValue(undefined),
    savePaidReceipt: jest.fn(async value => { calls.push({ name: value.name, result: { questionRevision: structuredClone(value.state) } }); }),
    generate: jest.fn(async config => {
      const response = await config.paidCompletion({ phase: 'draft', prompt: `${config.questionType}:${config.difficulty}:${config.learningObjective}:${config.customPrompt}`, invoke: async () => {
        calls.push({ paid: true }); return { content: `Draft ${calls.filter(call => call.paid).length}`, model: 'test' };
      } });
      return { success: true, questionData: { questionText: `${response.content} ${config.learningObjective}`,
        content: { options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }] },
        correctAnswer: 'True', explanation: 'Checked explanation',
        generationMetadata: { ...structuredClone(reviewed), reviewSummary: { ...structuredClone(reviewed.reviewSummary),
          ...(config.requiredLearningGoals?.length ? { goalCoveragePolicyVersion: QUESTION_GOAL_COVERAGE_POLICY_VERSION,
            goalCoverage: config.requiredLearningGoals.map(goal => ({ id: goal.id, isCovered: true })) } : {}) } } } };
    })
  };
  const options = { session: { _id: sessionId, owner, courseId: 'course', materialIds: [] },
    run: { _id: runId, requestId: 'test-request-12345678', input: { requestId: 'test-request-12345678' }, leaseToken: 'lease' },
    current: { _id: versionId, representation: 'course-linked', snapshot: snapshot() }, decision,
    latestRequest: 'Make the selected questions easier.', allowedQuestionTypes,
    guard: jest.fn().mockResolvedValue(undefined), checkpoint: jest.fn(async (name, result) => calls.push({ name, result: structuredClone(result) })) };
  return { dependencies, options, calls, service: () => createCourseQuestionRevisionService(dependencies) };
};
afterEach(() => jest.restoreAllMocks());

describe('course question revision planning', () => {
  test('shrinks from the end while preserving the last question for each saved objective', () => {
    const result = plan({ questionIndices: [], targetQuestionCount: 2 });
    expect(result).toMatchObject({ ready: true, plan: { retainedIndices: [1, 3], removedQuestionIndices: [2], tasks: [] } });
  });
  test('returns actionable coverage diagnostics without silently deleting an objective', () => {
    expect(plan({ questionIndices: [], targetQuestionCount: 1 })).toMatchObject({ ready: false,
      diagnostic: { code: 'QUESTION_COVERAGE_CONFLICT', minimumQuestionCount: 2, clarification: expect.any(Array) } });
    expect(plan({ questionIndices: [], removeQuestionIndices: [3] })).toMatchObject({ ready: false,
      diagnostic: { code: 'QUESTION_COVERAGE_CONFLICT', objectives: [{ id: lo2, text: 'Apply acceleration' }] } });
  });
  test('a confirmed faculty reduction diagnoses actual objective coverage rather than asking to reconfirm its count', () => {
    const source = snapshot(); const lo3 = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    source.questions[1].learningObjective = lo3;
    source.learningObjectives.push({ _id: lo3, text: 'Explain momentum' });
    source.settings.planItems = [lo1, lo2, lo3].map(learningObjective => ({ type: 'true-false', difficulty: 'moderate', learningObjective, count: 1 }));
    const before = structuredClone(source);
    const latestRequest = '把总题数减为2道，其余要求保持。先检查是否仍能覆盖现有学习目标，不要擅自删除学习目标。';
    const teachingRequirements = updateTeachingRequirements(updateTeachingRequirements(null, 'Create 3 questions.', 'initial'), latestRequest, 'faculty-reduction');
    expect(planCourseQuestionRevision({ snapshot: source, decision: { questionIndices: [], targetQuestionCount: 2 }, teachingRequirements,
      baseVersionId: versionId, requestId: 'faculty-reduction', latestRequest, allowedQuestionTypes })).toMatchObject({ ready: false,
      diagnostic: { code: 'QUESTION_COVERAGE_CONFLICT', targetQuestionCount: 2, minimumQuestionCount: 3, clarification: expect.any(Array) } });
    expect(source).toEqual(before);
  });
  test('plans count-only additions from existing objective/type contracts without regenerating retained questions', () => {
    const result = plan({ questionIndices: [], targetQuestionCount: 4 });
    expect(result.plan.tasks).toHaveLength(1);
    expect(result.plan.tasks[0]).toMatchObject({ kind: 'add', objectiveId: lo2, questionType: 'true-false', chapterIndex: 0 });
  });
  test('rejects conflicting selections and unsupported selection modes', () => {
    expect(() => plan({ questionIndices: [1], removeQuestionIndices: [1], targetQuestionCount: 3 })).toThrow('both revised and removed');
    expect(() => plan({ scope: 'all', selectionMode: 'multiple' })).toThrow('multiple-choice');
  });
  test('diagnoses ambiguous extension plans instead of guessing a new allocation', () => {
    const source = snapshot(); source.settings.planItems.push({ ...source.settings.planItems[0], customPrompt: 'Use a different subtopic.' });
    const result = planCourseQuestionRevision({ snapshot: source, decision: { questionIndices: [], targetQuestionCount: 4 },
      allowedQuestionTypes, baseVersionId: versionId });
    expect(result).toMatchObject({ ready: false, diagnostic: { code: 'QUESTION_EXTENSION_PLAN_AMBIGUOUS' } });
  });
});

describe('course question candidate generation and recovery', () => {
  test('keeps unselected records, evidence, objectives and history intact and saves fresh quality-review metadata', async () => {
    const f = fixture(); const result = await f.service()(f.options);
    expect(result.representation).toBe('course-linked');
    expect(result.snapshot.questions[2]).toEqual(f.options.current.snapshot.questions[2]);
    expect(result.snapshot.learningObjectives).toEqual(f.options.current.snapshot.learningObjectives);
    expect(result.snapshot.questions.slice(0, 2).every(item => item.difficulty === 'easy' && item.reviewStatus === 'pending')).toBe(true);
    expect(result.snapshot.questions[0].generationMetadata).toMatchObject(reviewed);
    expect(result.snapshot.questions[0].generationMetadata).not.toHaveProperty('noveltyScore');
    expect(f.calls.filter(call => call.paid)).toHaveLength(2);
    expect(f.calls.filter(call => /model_saved$/.test(call.name || '')).every(call => call.result.questionRevision.items['revise-1']?.receipts['draft:0']?.response.content)).toBe(true);
  });
  test('count-only removals need no material read or paid work', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 2 });
    f.options.session.materialIds = [materialId];
    const result = await f.service()(f.options);
    expect(result.snapshot.questions.map(item => item._id)).toEqual(['000000000000000000000001', '000000000000000000000003']);
    expect(f.dependencies.generate).not.toHaveBeenCalled(); expect(f.dependencies.findMaterials).not.toHaveBeenCalled();
    expect(result.snapshot.chapters[0].questionIds).toEqual(result.snapshot.questions.map(item => item._id));
  });
  test('count-only additions retain every prior question and enter its existing chapter', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 4 });
    const result = await f.service()(f.options);
    expect(result.snapshot.questions.slice(0, 3)).toEqual(f.options.current.snapshot.questions);
    expect(result.snapshot.questions[3]).toMatchObject({ quiz: quizId, learningObjective: lo2, createdBy: owner });
    expect(result.snapshot.chapters[0].questionIds).toContain(result.snapshot.questions[3]._id);
    expect(result.snapshot.settings.planItems.reduce((count, row) => count + row.count, 0)).toBe(4);
    expect(f.dependencies.generate).toHaveBeenCalledTimes(1);
  });
  test('preserves successful items on failure and reuses them only on an explicit matching resume', async () => {
    const f = fixture(); const generate = f.dependencies.generate;
    generate.mockImplementationOnce(async config => {
      const response = await config.paidCompletion({ phase: 'draft', prompt: 'stable', invoke: async () => ({ content: 'Saved first draft' }) });
      return { success: true, questionData: { questionText: response.content, content: {}, correctAnswer: 'True', explanation: 'Checked', generationMetadata: structuredClone(reviewed) } };
    }).mockImplementationOnce(async config => config.paidCompletion({ phase: 'draft', prompt: 'second', invoke: async () => {
      throw Object.assign(new Error('Provider unavailable'), { code: 'MODEL_SERVICE_UNAVAILABLE' });
    } }));
    await expect(f.service()(f.options)).rejects.toMatchObject({ code: 'MODEL_SERVICE_UNAVAILABLE' });
    const state = structuredClone(f.options.run.result.questionRevision);
    expect(state.items['revise-1'].phase).toBe('completed');
    expect(state.items['revise-2'].receipts['draft:0'].phase).toBe('pending');
    await expect(f.service()({ ...f.options, resumeState: state })).rejects.toMatchObject({ code: 'AUTHORING_MODEL_UNCERTAIN' });
    const result = await f.service()({ ...f.options, run: { ...f.options.run, _id: '999999999999999999999999' }, resumeState: state, explicitResume: true });
    expect(result.snapshot.questions[0].questionText).toBe('Saved first draft');
    expect(generate).toHaveBeenCalledTimes(3);
  });
  test('reuses checked generation after deterministic validation fails without buying another model reply', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    f.dependencies.validate.mockRejectedValueOnce(new Error('Temporary validation fixture failure'));
    await expect(f.service()(f.options)).rejects.toThrow('Temporary validation');
    expect(f.options.run.result.questionRevision.items['revise-1'].generated).toBeDefined();
    const result = await f.service()({ ...f.options, explicitResume: true });
    expect(result.snapshot.questions[0].questionText).toContain('Draft 1');
    expect(f.calls.filter(call => call.paid)).toHaveLength(1); expect(f.dependencies.generate).toHaveBeenCalledTimes(1);
  });
  test('a saved draft survives a free-processing error before normalized generation exists', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    const paidDraft = jest.fn().mockResolvedValue({ content: 'Known paid draft' });
    const paidReview = jest.fn().mockResolvedValue({ content: 'Known paid review' });
    let broken = true;
    f.dependencies.generate.mockImplementation(async config => {
      const draft = await config.paidCompletion({ phase: 'draft', prompt: 'stable-draft', invoke: paidDraft });
      if (broken) throw new Error('Free processing temporarily failed');
      await config.paidCompletion({ phase: 'feedback_review', prompt: 'stable-review', invoke: paidReview });
      return { success: true, questionData: { questionText: draft.content, content: {}, correctAnswer: 'True', explanation: 'Checked', generationMetadata: structuredClone(reviewed) } };
    });
    await expect(f.service()(f.options)).rejects.toThrow('Free processing');
    broken = false;
    await f.service()({ ...f.options, explicitResume: true });
    expect(paidDraft).toHaveBeenCalledTimes(1); expect(paidReview).toHaveBeenCalledTimes(1);
  });
  test('contract changes preserve saved replies and never purchase a replacement', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    const paid = jest.fn().mockResolvedValue({ content: 'Known reply' }); let prompt = 'original';
    f.dependencies.generate.mockImplementation(async config => {
      await config.paidCompletion({ phase: 'draft', prompt, invoke: paid });
      throw new Error('Stopped before normalization');
    });
    await expect(f.service()(f.options)).rejects.toThrow('Stopped before'); prompt = 'changed-contract';
    await expect(f.service()({ ...f.options, explicitResume: true })).rejects.toMatchObject({ code: 'AUTHORING_CONTRACT_CHANGED' });
    await expect(f.service()({ ...f.options, explicitResume: true })).rejects.toMatchObject({ code: 'AUTHORING_CONTRACT_CHANGED' });
    expect(paid).toHaveBeenCalledTimes(1);
    expect(f.options.run.result.questionRevision.items['revise-1'].receipts['draft:0'].response.content).toBe('Known reply');
  });
  test('insufficient evidence preserves receipts and requires new input before paid work', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    const paid = jest.fn().mockResolvedValue({ content: 'Known response' });
    f.dependencies.generate.mockImplementation(async config => {
      await config.paidCompletion({ phase: 'draft', prompt: 'draft', invoke: paid });
      await config.paidCompletion({ phase: 'feedback_review', prompt: 'review', invoke: paid });
      throw Object.assign(new Error('Add supporting evidence.'), { code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'EVIDENCE_INSUFFICIENT', reviewKind: 'semantic', repairKind: 'none' });
    });
    await expect(f.service()(f.options)).rejects.toMatchObject({ qualityFailureReason: 'EVIDENCE_INSUFFICIENT' });
    await expect(f.service()({ ...f.options, explicitResume: true })).rejects.toMatchObject({ code: 'QUESTION_REVISION_INPUT_REQUIRED' });
    expect(paid).toHaveBeenCalledTimes(2); expect(f.dependencies.generate).toHaveBeenCalledTimes(1);
  });
  test('semantic feedback rejection redrafts, while feedback-only repair retains the known draft', async () => {
    for (const reviewKind of ['semantic', 'feedback']) {
      const f = fixture({ action: 'revise_questions', questionIndices: [1] });
      let rejected = true;
      const paidDraft = jest.fn().mockResolvedValue({ content: 'Draft' });
      const paidReview = jest.fn(async () => ({ content: rejected ? 'Rejected review' : 'Accepted review' }));
      f.dependencies.generate.mockImplementation(async config => {
        if (!config.repairDraft) await config.paidCompletion({ phase: 'draft', prompt: 'draft', invoke: paidDraft });
        const review = await config.paidCompletion({ phase: 'feedback_review', prompt: 'review', invoke: paidReview });
        if (review.content === 'Rejected review') throw Object.assign(new Error('Feedback rejected'), { code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'FEEDBACK_INVALID', reviewKind,
          repairKind: reviewKind === 'semantic' ? 'redraft' : 'feedback', ...(reviewKind === 'feedback' ? { repairDraft: { questionText: 'Same original question' } } : {}) });
        return { success: true, questionData: { questionText: 'Checked draft', content: {}, correctAnswer: 'True', explanation: 'Checked', generationMetadata: structuredClone(reviewed) } };
      });
      await expect(f.service()(f.options)).rejects.toThrow('Feedback rejected'); rejected = false;
      await f.service()({ ...f.options, explicitResume: true });
      expect(paidDraft).toHaveBeenCalledTimes(reviewKind === 'semantic' ? 3 : 1); expect(paidReview).toHaveBeenCalledTimes(3);
    }
  });
  test.each(['ANSWER_INVALID', 'RUBRIC_INVALID'])('automatically repairs one %s rejection with bounded observations and durable call ordinals', async reason => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    const paidDraft = jest.fn().mockResolvedValue({ content: 'Draft' });
    const paidReview = jest.fn().mockResolvedValue({ content: 'Review' });
    let attempt = 0;
    f.dependencies.generate.mockImplementation(async config => {
      attempt += 1;
      await config.paidCompletion({ phase: 'draft', prompt: config.customPrompt, invoke: paidDraft });
      await config.paidCompletion({ phase: 'feedback_review', prompt: `review-${attempt}`, invoke: paidReview });
      if (attempt === 1) throw Object.assign(new Error('Rejected assessment contract'), { code: 'QUESTION_QUALITY_REVIEW',
        qualityFailureReason: reason, repairKind: 'redraft', reviewKind: 'semantic',
        rejectedDraft: { questionText: 'Rejected original', issues: ['Recompute the key or align the rubric.'], contentSummary: 'Approved learner task.' } });
      expect(config.customPrompt).toContain(reason);
      expect(config.customPrompt).toContain('Recompute the key or align the rubric.');
      expect(config.customPrompt).toContain('same independent checks');
      expect(config.instructorPrompt).toBe(f.options.latestRequest);
      return { success: true, questionData: { questionText: 'Checked repaired task', content: {}, correctAnswer: 'True', explanation: 'Checked', generationMetadata: structuredClone(reviewed) } };
    });
    const output = await f.service()(f.options);
    expect(output.snapshot.questions[0].questionText).toBe('Checked repaired task');
    expect(paidDraft).toHaveBeenCalledTimes(2); expect(paidReview).toHaveBeenCalledTimes(2);
    expect(Object.keys(f.options.run.result.questionRevision.items['revise-1'].receipts)).toEqual(['draft:0', 'feedback_review:0', 'draft:1', 'feedback_review:1']);
    expect(f.calls.some(call => call.name === `question_batch_revise-1_repair_${reason === 'ANSWER_INVALID' ? 'answer' : 'rubric'}`)).toBe(true);
  });
  test('an unreadable semantic review never auto-repairs or repurchases its saved good draft on explicit retry', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    const paidDraft = jest.fn().mockResolvedValue({ content: 'Known draft' }); const paidReview = jest.fn().mockResolvedValue({ content: 'Unreadable review' });
    let rejected = true;
    f.dependencies.generate.mockImplementation(async config => {
      await config.paidCompletion({ phase: 'draft', prompt: 'draft', invoke: paidDraft });
      await config.paidCompletion({ phase: 'feedback_review', prompt: 'review', invoke: paidReview });
      if (rejected) throw Object.assign(new Error('Incomplete review'), { code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'REVIEW_INVALID_RESPONSE', reviewKind: 'semantic', repairKind: 'redraft' });
      return { success: true, questionData: { questionText: 'Rechecked original draft', content: {}, correctAnswer: 'True', explanation: 'Checked', generationMetadata: structuredClone(reviewed) } };
    });
    await expect(f.service()(f.options)).rejects.toMatchObject({ qualityFailureReason: 'REVIEW_INVALID_RESPONSE' });
    expect(f.dependencies.generate).toHaveBeenCalledTimes(1); rejected = false;
    await f.service()({ ...f.options, explicitResume: true });
    expect(paidDraft).toHaveBeenCalledTimes(1); expect(paidReview).toHaveBeenCalledTimes(2);
  });
  test('saved evidence and completed outputs cannot replay after the actual selected source changes', async () => {
    for (const completed of [false, true]) {
      const f = fixture({ action: 'revise_questions', questionIndices: [1] });
      if (!completed) f.dependencies.generate.mockImplementationOnce(async config => {
        await config.paidCompletion({ phase: 'draft', prompt: 'draft', invoke: async () => ({ content: 'Known paid reply' }) });
        throw new Error('Stopped before normalization');
      });
      if (completed) await f.service()(f.options); else await expect(f.service()(f.options)).rejects.toThrow('Stopped before normalization');
      const saved = structuredClone(f.options.run.result.questionRevision);
      f.dependencies.validateSourceContract.mockRejectedValue(Object.assign(new Error('Selected ready material content changed'), { code: 'AUTHORING_SOURCE_CHANGED' }));
      const calls = f.dependencies.generate.mock.calls.length;
      await expect(f.service()({ ...f.options, explicitResume: true })).rejects.toMatchObject({ code: 'AUTHORING_SOURCE_CHANGED' });
      expect(f.dependencies.generate).toHaveBeenCalledTimes(calls);
      expect(f.options.run.result.questionRevision).toEqual(saved);
      expect(saved.items['revise-1'].receipts['draft:0'].response.content).toBeTruthy();
    }
  });
  test('saves an already returned paid response after cancellation but stops before constructing a candidate', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    let cancelled = false;
    f.options.guard.mockImplementation(async () => { if (cancelled) throw Object.assign(new Error('Stopped'), { name: 'AbortError' }); });
    f.dependencies.generate.mockImplementation(async config => config.paidCompletion({ phase: 'draft', prompt: 'cancel-test', invoke: async () => {
      cancelled = true; return { content: 'Already paid response', model: 'test' };
    } }));
    await expect(f.service()(f.options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.dependencies.savePaidReceipt).toHaveBeenCalledTimes(1);
    expect(f.dependencies.savePaidReceipt.mock.calls[0][0].state.items['revise-1'].receipts['draft:0'].response.content).toBe('Already paid response');
    expect(f.dependencies.validate).not.toHaveBeenCalled();
  });
  test('paid receipts require owner/session/run/lease matching even after cancellation', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    delete f.dependencies.savePaidReceipt;
    jest.spyOn(AuthoringRun, 'updateOne').mockResolvedValue({ matchedCount: 0 });
    await expect(f.service()(f.options)).rejects.toThrow('execution lease was lost');
    expect(AuthoringRun.updateOne.mock.calls[0][0]).toMatchObject({ _id: runId, owner, sessionId,
      status: 'running', leaseToken: 'lease', leaseUntil: { $gt: expect.any(Date) } });
    expect(AuthoringRun.updateOne.mock.calls[0][0]).not.toHaveProperty('cancelRequested');
  });
  test('authorized course material ownership is checked and out-of-scope evidence is refused', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [1] });
    f.options.session.materialIds = [materialId];
    f.dependencies.findMaterials.mockResolvedValue([{ _id: materialId }]);
    f.dependencies.retrieve.mockResolvedValue({ chunks: [{ content: 'Other instructor source', metadata: { materialId: 'foreign' } }] });
    await expect(f.service()(f.options)).rejects.toMatchObject({ code: 'QUESTION_EVIDENCE_SCOPE' });
    expect(f.dependencies.findMaterials.mock.calls[0][0]).toMatchObject({ uploadedBy: owner, folder: 'course', _id: { $in: [materialId] } });
    expect(f.dependencies.retrieve.mock.calls[0][2]).toMatchObject({ materialIds: [materialId] });
    expect(f.dependencies.generate).not.toHaveBeenCalled();
  });
  test('completed output is replayable but another request/version cannot reuse it', async () => {
    const f = fixture(); const first = await f.service()(f.options);
    expect(await f.service()(f.options)).toEqual(first);
    expect(f.dependencies.generate).toHaveBeenCalledTimes(2);
    await expect(f.service()({ ...f.options, latestRequest: 'A different request' })).rejects.toThrow('another request or version');
  });
});

describe('explicit learning-objective changes within a batch proposal', () => {
  const lo3 = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const threeObjectives = () => {
    const source = snapshot();
    source.questions = [question(1, lo1), question(2, lo2), question(3, lo3)];
    source.learningObjectives = [
      { _id: lo1, text: 'Explain the meaning of force.', generationMetadata: { subpoints: ['Force interactions'], sourceReferences: [{ materialId, excerpt: 'Force evidence' }] } },
      { _id: lo2, text: 'Explain changes in motion.', generationMetadata: { subpoints: ['Velocity changes'], sourceReferences: [{ materialId, excerpt: 'Motion evidence' }] } },
      { _id: lo3, text: 'Apply energy conservation.' }
    ].map(objective => ({ ...objective, quiz: quizId, createdBy: owner, order: 0 }));
    source.settings.planItems = [lo1, lo2, lo3].map(learningObjective => ({ type: 'true-false', difficulty: 'moderate', learningObjective, count: 1 }));
    return source;
  };
  const latestRequest = 'Combine the force and motion learning objectives while keeping all topics, and use 2 questions.';
  const changes = () => ({ authorizationQuote: 'Combine the force and motion learning objectives while keeping all topics',
    merges: [{ objectiveIds: [lo1, lo2], text: 'Explain how force changes motion.' }] });

  test('a count request alone cannot authorize merging, exclusions or source-only authority', () => {
    expect(() => normalizeObjectiveChanges({ ...changes(), authorizationQuote: 'Use 2 questions' }, 'Use 2 questions')).toThrow('explicitly authorize merging');
    expect(() => normalizeObjectiveChanges(changes(), 'Use 2 questions')).toThrow('exact authorization quote');
    expect(() => normalizeObjectiveChanges({ ...changes(), excludeObjectiveIds: [lo3] }, latestRequest)).toThrow('explicitly authorize excluding');
    expect(() => normalizeObjectiveChanges({ ...changes(), authorizationQuote: 'combine' }, 'Do not combine the objectives.')).toThrow('explicitly authorize merging');
    expect(() => normalizeObjectiveChanges({ ...changes(), authorizationQuote: 'combine' }, 'Discuss whether to combine the objectives.')).toThrow('explicitly authorize merging');
  });
  test('validates disjoint membership and preserves complete source goals, subpoints and evidence', async () => {
    expect(() => normalizeObjectiveChanges({ ...changes(), merges: [...changes().merges, { objectiveIds: [lo2, lo3], text: 'Another goal' }] }, latestRequest)).toThrow('disjoint');
    const source = threeObjectives(); const before = structuredClone(source);
    const revised = reviseCourseObjectives({ snapshot: source, changes: changes(), latestRequest, owner,
      requestId: 'test-request-12345678', baseVersionId: versionId });
    expect(source).toEqual(before);
    expect(revised.snapshot.learningObjectives).toHaveLength(2);
    const merged = revised.snapshot.learningObjectives[0];
    expect(merged.generationMetadata.subpoints).toEqual(expect.arrayContaining(['Explain the meaning of force.', 'Explain changes in motion.', 'Force interactions', 'Velocity changes']));
    expect(merged.generationMetadata.sourceReferences.map(reference => reference.excerpt)).toEqual(['Force evidence', 'Motion evidence']);
    expect(merged.generationMetadata.objectiveRevision.sourceGoals).toEqual([
      { id: lo1, text: 'Explain the meaning of force.' }, { id: lo2, text: 'Explain changes in motion.' }
    ]);
    const validated = new LearningObjective(merged);
    await validated.validate();
    expect(validated.toObject().generationMetadata.objectiveRevision).toMatchObject({ kind: 'merge', authorizationQuote: changes().authorizationQuote });
    expect(validated.toObject().generationMetadata.objectiveRevision.sourceObjectiveIds.map(String)).toEqual([lo1, lo2]);
    expect(validated.toObject().generationMetadata.objectiveRevision.sourceGoals.map(goal => ({ id: String(goal.id), text: goal.text })))
      .toEqual(merged.generationMetadata.objectiveRevision.sourceGoals);
    expect(new LearningObjective(before.learningObjectives[0]).toObject().generationMetadata).not.toHaveProperty('objectiveRevision');
    expect(() => reviseCourseObjectives({ snapshot: source, changes: { ...changes(), merges: [{ objectiveIds: [lo1, owner], text: 'Foreign merge' }] }, latestRequest })).toThrow('outside the current');
  });
  test('3 objectives can become a checked 2-question merged candidate while the original version stays intact', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 2, objectiveChanges: changes() });
    f.options.current.snapshot = threeObjectives(); f.options.latestRequest = latestRequest;
    const before = structuredClone(f.options.current.snapshot);
    expect(planCourseQuestionRevision({ snapshot: before, decision: { questionIndices: [], targetQuestionCount: 2 }, allowedQuestionTypes })).toMatchObject({ ready: false,
      diagnostic: { minimumQuestionCount: 3 } });
    const result = await f.service()(f.options);
    expect(result.snapshot.learningObjectives).toHaveLength(2); expect(result.snapshot.questions).toHaveLength(2);
    expect(result.snapshot.questions[0].learningObjective).toBe(result.snapshot.learningObjectives[0]._id);
    expect(result.snapshot.questions[1]).toEqual(before.questions[2]);
    expect(f.options.current.snapshot).toEqual(before); expect(f.dependencies.generate).toHaveBeenCalledTimes(1);
    expect(f.dependencies.generate.mock.calls[0][0].customPrompt).toContain('Explain the meaning of force.');
    expect(f.dependencies.generate.mock.calls[0][0].customPrompt).toContain('Explain changes in motion.');
    expect(f.dependencies.generate.mock.calls[0][0].requiredLearningGoals).toEqual([
      { id: lo1, text: 'Explain the meaning of force.' }, { id: lo2, text: 'Explain changes in motion.' }
    ]);
    expect(f.dependencies.generate.mock.calls[0][0].customPrompt).toContain('This individual question must require the learner to apply EVERY listed goal');
    expect(result.changes.join(' ')).toContain('preserving every source goal');
    const publish = jest.spyOn(Question.prototype, 'save');
    for (const candidate of result.snapshot.questions) await new Question(candidate).validate();
    expect(publish).not.toHaveBeenCalled();
  });
  test('a later revision retains the accepted merged source-goal contract without requiring the old objective records', () => {
    const merged = reviseCourseObjectives({ snapshot: threeObjectives(), changes: changes(), latestRequest, owner,
      requestId: 'test-request-12345678', baseVersionId: versionId }).snapshot;
    const result = planCourseQuestionRevision({ snapshot: merged, decision: { questionIndices: [1] }, allowedQuestionTypes, baseVersionId: versionId });
    expect(result).toMatchObject({ ready: true, plan: { tasks: [{ requiredLearningGoals: [
      { id: lo1, text: 'Explain the meaning of force.' }, { id: lo2, text: 'Explain changes in motion.' }
    ] }] } });
    delete merged.learningObjectives[0].generationMetadata.objectiveRevision.sourceGoals;
    expect(planCourseQuestionRevision({ snapshot: merged, decision: { questionIndices: [1] }, allowedQuestionTypes, baseVersionId: versionId }))
      .toMatchObject({ ready: false, diagnostic: { code: 'QUESTION_MERGED_GOALS_UNAVAILABLE' } });
    expect(planCourseQuestionRevision({ snapshot: merged, decision: { questionIndices: [3] }, allowedQuestionTypes, baseVersionId: versionId }))
      .toMatchObject({ ready: true, plan: { tasks: [{ sourceIndex: 3 }] } });
  });
  test('missing merged-goal checks cannot be replayed from a completed output or normalized paid draft', async () => {
    for (const completed of [false, true]) {
      const f = fixture({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 2, objectiveChanges: changes() });
      f.options.current.snapshot = threeObjectives(); f.options.latestRequest = latestRequest;
      if (!completed) f.dependencies.validate.mockRejectedValueOnce(new Error('Temporary deterministic conversion failure'));
      if (completed) await f.service()(f.options); else await expect(f.service()(f.options)).rejects.toThrow('Temporary deterministic');
      const state = structuredClone(f.options.run.result.questionRevision);
      const summary = completed ? state.output.snapshot.questions[0].generationMetadata.reviewSummary : state.items['revise-1'].generated.generationMetadata.reviewSummary;
      expect(Object.values(summary.checks).every(Boolean)).toBe(true);
      delete summary.goalCoverage;
      const paidBefore = f.calls.filter(call => call.paid).length;
      await expect(f.service()({ ...f.options, resumeState: state, explicitResume: true })).rejects.toMatchObject({ code: 'AUTHORING_REVIEW_POLICY_CHANGED' });
      expect(f.calls.filter(call => call.paid)).toHaveLength(paidBefore); expect(f.dependencies.generate).toHaveBeenCalledTimes(1);
    }
  });
  test('a merged-goal instruction repair keeps the exact required goals and preserves the unselected question', async () => {
    const f = fixture({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 2, objectiveChanges: changes() });
    f.options.current.snapshot = threeObjectives(); f.options.latestRequest = latestRequest;
    const generate = f.dependencies.generate.getMockImplementation(); let rejected = false;
    const seen = [];
    f.dependencies.generate.mockImplementation(async config => {
      seen.push(structuredClone(config.requiredLearningGoals));
      const result = await generate(config);
      if (!rejected) {
        rejected = true;
        throw Object.assign(new Error('The new item omitted its second merged goal'), { code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'INSTRUCTION_MISMATCH', repairKind: 'redraft',
          rejectedDraft: { questionText: 'Only one original goal', issues: ['Missing the second required learning goal.'] } });
      }
      expect(config.customPrompt).toContain('Missing the second required learning goal.');
      return result;
    });
    const before = structuredClone(f.options.current.snapshot.questions[2]);
    const result = await f.service()(f.options);
    expect(seen).toHaveLength(2); expect(seen[0]).toEqual(seen[1]); expect(seen[0].map(goal => goal.id)).toEqual([lo1, lo2]);
    expect(result.snapshot.questions[1]).toEqual(before);
    expect(result.snapshot.questions[0].generationMetadata.reviewSummary.goalCoverage).toEqual([
      { id: lo1, isCovered: true }, { id: lo2, isCovered: true }
    ]);
  });
  test('explicit exclusion creates a smaller consistent candidate without making paid calls', async () => {
    const quote = 'Exclude the motion learning objective';
    const f = fixture({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 2,
      objectiveChanges: { authorizationQuote: quote, excludeObjectiveIds: [lo2] } });
    f.options.current.snapshot = threeObjectives(); f.options.latestRequest = `${quote} and keep 2 questions.`;
    const result = await f.service()(f.options);
    expect(result.snapshot.learningObjectives.map(objective => objective._id)).toEqual([lo1, lo3]);
    expect(result.snapshot.questions.map(item => item.learningObjective)).toEqual([lo1, lo3]);
    expect(result.snapshot.settings.planItems.every(row => row.learningObjective !== lo2)).toBe(true);
    expect(f.dependencies.generate).not.toHaveBeenCalled();
    const unauthorized = fixture({ action: 'revise_questions', questionIndices: [], targetQuestionCount: 2,
      objectiveChanges: { authorizationQuote: 'Keep 2 questions', excludeObjectiveIds: [lo2] } });
    unauthorized.options.current.snapshot = threeObjectives(); unauthorized.options.latestRequest = 'Keep 2 questions';
    await expect(unauthorized.service()(unauthorized.options)).rejects.toThrow('explicitly authorize excluding');
    expect(unauthorized.dependencies.generate).not.toHaveBeenCalled(); expect(unauthorized.dependencies.findMaterials).not.toHaveBeenCalled();
  });
});
