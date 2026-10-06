import { authoringWorkflowForRequest, automaticContinuationDecision } from '../../services/authoring/authoringContinuation.js';

describe('instructor authorization for bounded continuation', () => {
  test.each(['Create 15 practice questions about Newton laws.', '请生成十五道填空题，覆盖牛顿定律。',
    'I want two Multiple Choice questions about acceleration.'])('continues an explicit complete-question request: %s', text => {
    const workflow = authoringWorkflowForRequest(null, text, 'request-1');
    expect(workflow).toMatchObject({ target: 'questions', autoContinue: true, automaticContinuations: 0 });
    expect(text).toContain(workflow.authorization.quote);
  });
  test.each(['Generate learning objectives for introductory motion.', '请生成学习目标，不要生成题目。'])
    ('stops at objectives for an LO request: %s', text => {
      expect(authoringWorkflowForRequest(null, text, 'request-1')).toMatchObject({ target: 'objectives', autoContinue: false });
    });
  test.each(['Create a plan for 15 questions for me to review first.',
    '先生成教学计划供我确认，再生成十五道题。', 'Generate questions after my approval.',
    'Do not generate questions. Only discuss teaching ideas.'])('does not bypass a requested review or deferral: %s', text => {
    expect(authoringWorkflowForRequest(null, text, 'request-1').autoContinue).toBe(false);
  });
  test('a structured clarification retains its authorized endpoint and repair budget', () => {
    const previous = { ...authoringWorkflowForRequest(null, 'Create 15 practice questions.', 'first'), automaticContinuations: 1 };
    expect(authoringWorkflowForRequest(previous, 'Grade 10; formative practice.', 'answer', { clarification: true })).toEqual(previous);
    expect(authoringWorkflowForRequest({ version: 1, target: 'objectives', autoContinue: false },
      'Create 15 questions.', 'answer', { clarification: true }).autoContinue).toBe(false);
  });
  test.each([
    'Create a chart using the recorded water survey. First present a confirmable plan.',
    'Create a chart of the supplied survey. First give me a confirmable activity plan. Do not add conclusions or questions.',
    'Generate 15 questions about motion. First show me a blueprint.'
  ])('honors an explicit plan-first request without authorizing construction: %s', text => {
    const workflow = authoringWorkflowForRequest(null, text, 'request-1');
    expect(workflow).toMatchObject({ target: 'plan', autoContinue: false });
    expect(workflow.activityAuthorization).toBeUndefined();
  });
  test('a later explicit deferral revokes automatic generation', () => {
    const previous = authoringWorkflowForRequest(null, 'Create 15 questions.', 'first');
    expect(authoringWorkflowForRequest(previous, 'Do not generate questions yet.', 'stop').autoContinue).toBe(false);
  });
  test.each(['ANSWER_INVALID', 'QUESTION_DUPLICATE_DETECTED', 'QUESTION_SLICE_MISMATCH', 'QUESTION_PLANNED_SLICE_MISMATCH'])
    ('permits bounded checked-item repair for %s', code => {
      const workflow = authoringWorkflowForRequest(null, 'Create 15 questions.', 'first');
      expect(automaticContinuationDecision(workflow, { generation: { items: [
        { index: 0, status: 'ready' }, { index: 1, status: 'failed', failure: { code } }
      ] } })).toEqual({ allowed: true, kind: 'repair-questions', indices: [1] });
      expect(automaticContinuationDecision({ ...workflow, automaticContinuations: 2 },
        { generation: { items: [{ index: 1, status: 'failed', failure: { code } }] } }).allowed).toBe(false);
    });
  test.each(['MODEL_SERVICE_LIMIT_REACHED', 'REVIEW_UNAVAILABLE', 'REVIEW_INVALID_RESPONSE',
    'EVIDENCE_INSUFFICIENT', 'GENERATION_INTERRUPTED', 'UNKNOWN'])('does not blindly replay %s', code => {
      const workflow = authoringWorkflowForRequest(null, 'Create 15 questions.', 'first');
      expect(automaticContinuationDecision(workflow,
        { generation: { items: [{ index: 1, status: 'failed', failure: { code } }] } }).allowed).toBe(false);
    });
  test('restores only a known missing source index and preserves other failures', () => {
    const workflow = authoringWorkflowForRequest(null, 'Create 15 questions.', 'first');
    expect(automaticContinuationDecision(workflow, { generation: { items: [
      { index: 0, status: 'failed', failure: { code: 'MATERIAL_INDEX_MISSING' } }
    ] } })).toMatchObject({ allowed: true, kind: 'restore-material-search' });
    expect(automaticContinuationDecision(workflow, { generation: { items: [
      { index: 0, status: 'failed', failure: { code: 'MATERIAL_INDEX_MISSING' } },
      { index: 1, status: 'failed', failure: { code: 'REVIEW_UNAVAILABLE' } }
    ] } }).allowed).toBe(false);
  });
  test('brainstorming authorizes only learning objectives and native construction cannot authorize deferred questions', () => {
    expect(authoringWorkflowForRequest(null, 'Brainstorm learning objectives for momentum.', 'request-1'))
      .toMatchObject({ target: 'objectives', autoContinue: false });
    const native = authoringWorkflowForRequest(null, 'Create an H5P Chart using these supplied values. Do not generate questions.', 'request-2');
    expect(native.activityAuthorization.quote).toContain('Create an H5P Chart');
    expect(native.questionGenerationAllowed).toBe(false);
    expect(authoringWorkflowForRequest(null, 'Create an H5P Chart after I approve its plan.', 'request-3').activityAuthorization).toBeUndefined();
  });
});
