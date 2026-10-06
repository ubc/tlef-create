import { expect, jest, test } from '@jest/globals';
import { listH5PTypeAdapters } from '../../config/h5pTypeAdapterRegistry.js';
import llmService from '../../services/llmService.js';
import { QuestionAIStrategyRegistry, questionAuthoringStrategies } from '../../services/questionAuthoringStrategies.js';
import { buildBranchingStructure } from '../../utils/branchingScenarioBuilder.js';
import { reviewQuestionWithDefaultPolicy } from '../../services/questionSemanticReview.js';
import { QUESTION_REVIEW_POLICY_VERSION, QUESTION_REVIEW_VERDICT_FIELDS } from '../../services/questionReviewContract.js';

test('every canonical adapter keeps the legacy behavior boundary without a second type list', () => {
  const registry = new QuestionAIStrategyRegistry();
  for (const adapter of listH5PTypeAdapters()) expect(registry.resolve(adapter.type).id).toBe('legacy-create-question');
  expect(() => registry.resolve('not-a-real-type')).toThrow(expect.objectContaining({ code: 'QUESTION_TYPE_UNSUPPORTED' }));
  expect(() => registry.register('not-a-real-type', { id: 'unsupported' })).toThrow('canonical H5P adapter registry');
});

test('a class strategy with private state overrides format and validation without changing orchestration', async () => {
  class RevealAnswerStrategy {
    id = 'reveal-answer-test';
    #solution = 'The upward normal force.';
    prompt() { return `Return a task and solution. The supported answer is ${this.#solution}`; }
    validateNormalize({ responseContent }) {
      const parsed = JSON.parse(responseContent);
      if (parsed.solution !== this.#solution) throw new Error('The answer is not supported by this contract.');
      return { questionText: parsed.task, content: { solutionText: this.#solution }, correctAnswer: this.#solution, explanation: 'Supported by the task.' };
    }
  }
  const original = questionAuthoringStrategies.resolve('guess-the-answer');
  questionAuthoringStrategies.register('guess-the-answer', new RevealAnswerStrategy(), { replace: true });
  try {
    expect(llmService.getFormatInstructions('guess-the-answer')).toContain('The upward normal force');
    const prompt = await llmService.buildExpertPrompt('Identify equilibrium forces.', 'guess-the-answer', [], 'easy', '', [], 'Ask about a stationary object.');
    expect(prompt).toContain('Return a task and solution');
    expect(prompt).toContain('RELEVANT COURSE MATERIALS');
    expect(llmService.parseAndValidateResponse(JSON.stringify({ task: '  What balances gravity?  ', solution: 'The upward normal force.' }), 'guess-the-answer'))
      .toMatchObject({ questionText: 'What balances gravity?', content: { solutionText: 'The upward normal force.' } });
    expect(() => llmService.parseAndValidateResponse(JSON.stringify({ task: 'What balances gravity?', solution: 'Friction.' }), 'guess-the-answer'))
      .toThrow(expect.objectContaining({ code: 'QUESTION_INVALID_RESPONSE' }));
  } finally { questionAuthoringStrategies.register('guess-the-answer', original, { replace: true }); }
});

test('a future canonical adapter can register an independent contract with no LLM-service type branch', () => {
  const adapter = { type: 'synthetic-card', mainLibrary: 'H5P.SyntheticCard 1.0' };
  const registry = new QuestionAIStrategyRegistry({ adapters: () => [...listH5PTypeAdapters(), adapter] });
  registry.register(adapter.type, { id: 'synthetic-card-ai', prompt: () => 'Return {"task":"...","answer":"..."}.',
    validateNormalize({ responseContent }) {
      const parsed = JSON.parse(responseContent);
      if (typeof parsed.answer !== 'string') throw new Error('Missing answer.');
      return { questionText: parsed.task, content: { answer: parsed.answer }, correctAnswer: parsed.answer, explanation: 'Review the answer.' };
    }
  });
  const strategy = registry.resolve(adapter.type);
  expect(strategy.prompt({ questionType: adapter.type })).toContain('"task"');
  expect(strategy.validateNormalize({ responseContent: '{"task":"Recall the concept.","answer":"Force"}' })).toMatchObject({ correctAnswer: 'Force' });
  expect(() => registry.register(adapter.type, { id: 'replacement' })).toThrow('already registered');
  registry.register(adapter.type, { id: 'replacement' }, { replace: true });
  expect(registry.resolve(adapter.type).id).toBe('replacement');
});

test('a custom complete prompt replaces complex legacy prompts while a format-only hook keeps ordinary evidence instructions', async () => {
  const registry = new QuestionAIStrategyRegistry();
  registry.register('documentation-tool', { id: 'custom-documentation', buildPrompt({ instructorPrompt }) { return `CUSTOM COMPLEX TASK: ${instructorPrompt}`; } });
  expect(await registry.resolve('documentation-tool').buildPrompt({ questionType: 'documentation-tool', instructorPrompt: 'Reflect on this.' }))
    .toBe('CUSTOM COMPLEX TASK: Reflect on this.');
  expect(await registry.resolve('multiple-choice').buildPrompt({ questionType: 'multiple-choice' })).toBeNull();
});

test('invalid or asynchronous validation hooks cannot cross the synchronous Question parser boundary', async () => {
  const registry = new QuestionAIStrategyRegistry().register('guess-the-answer', { id: 'invalid', validateNormalize: () => ({}) });
  expect(() => registry.resolve('guess-the-answer').validateNormalize({})).toThrow(expect.objectContaining({ code: 'QUESTION_INVALID_RESPONSE' }));
  expect(() => registry.register('guess-the-answer', { id: 'async-invalid', validateNormalize: async () => { throw new Error('Async failure.'); } }, { replace: true }))
    .toThrow('must be synchronous');
  expect(() => registry.register('guess-the-answer', { id: 'async-prompt-invalid', prompt: async () => 'Format' }, { replace: true }))
    .toThrow('must be synchronous');
  registry.register('guess-the-answer', { id: 'promise-invalid', validateNormalize: () => Promise.reject(new Error('Unexpected async draft.')) }, { replace: true });
  expect(() => registry.resolve('guess-the-answer').validateNormalize({})).toThrow(expect.objectContaining({ code: 'QUESTION_INVALID_RESPONSE' }));
  registry.register('guess-the-answer', { id: 'promise-prompt-invalid', prompt: () => Promise.reject(new Error('Unexpected async format.')) }, { replace: true });
  expect(() => registry.resolve('guess-the-answer').prompt({})).toThrow('synchronously');
  await new Promise(resolve => setImmediate(resolve));
});

test('complex legacy strategies preserve source-aware branching and documentation contracts', async () => {
  const prompt = await llmService.buildExpertPrompt('Resolve an AI policy concern.', 'branching-scenario',
    [{ content: 'Ask a clarifying question in private.' }], 'moderate', 'Group projects', [], 'Show plausible decisions.', 'single', 2, 2);
  expect(prompt).toContain('Ask a clarifying question in private');
  expect(prompt).toContain('Show plausible decisions');
  const draft = { introText: 'A group decides how to use AI.', nodes: buildBranchingStructure(2, 2).map(node => node.type === 'text'
    ? { index: node.index, question: null, alternatives: [] }
    : { index: node.index, question: `Decision ${node.index}?`, alternatives: node.alternatives.map((choice, index) => ({
      text: `Choice ${node.index}.${index + 1}`, nextContentId: choice.nextContentId,
      feedback: choice.nextContentId < 0 ? 'A distinct consequence.' : null
    })) }) };
  expect(llmService.parseAndValidateResponse(JSON.stringify(draft), 'branching-scenario')).toMatchObject({
    questionText: 'Branching Scenario', content: { nodes: expect.arrayContaining([expect.objectContaining({ index: 1 })]) }, correctAnswer: null, explanation: null
  });
  const documentation = await llmService.buildExpertPrompt('Reflect on the learning process.', 'documentation-tool', [], 'easy', '', [], 'Read, respond and export.');
  expect(documentation).toContain('Documentation Tool');
  expect(documentation).toContain('Reflect on the learning process');
  expect(llmService.parseAndValidateResponse('{"title":"Reflection","pages":[{"type":"export"}]}', 'documentation-tool'))
    .toMatchObject({ questionText: 'Documentation Tool', content: { title: 'Reflection', pages: [{ type: 'export' }] }, correctAnswer: null });
});

test('an async class review hook keeps private state and receives evidence, teacher constraints and the guarded completion callback', async () => {
  class ReviewedRecallStrategy {
    id = 'reviewed-recall';
    #expected = 'The upward normal force.';
    async review(context) {
      if (context.draft.correctAnswer !== this.#expected) throw Object.assign(new Error('Wrong answer'), {
        code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'ANSWER_INVALID'
      });
      return reviewQuestionWithDefaultPolicy({ ...context, instructorContext: `Expected equilibrium solution: ${this.#expected}` });
    }
  }
  const registry = new QuestionAIStrategyRegistry().register('guess-the-answer', new ReviewedRecallStrategy());
  const complete = jest.fn(async () => ({ content: JSON.stringify({ contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true,
    feedbackIsConsistent: true, followsInstructorRequest: true, evidenceIsSufficient: true, issues: [], calculations: [] }) }));
  const context = { draft: { questionText: 'What balances weight?', correctAnswer: 'The upward normal force.' },
    questionType: 'guess-the-answer', relevantContent: [{ content: 'The object is stationary.' }], instructorRequest: 'Exclude friction.', complete };
  expect(await registry.resolve('guess-the-answer').review(context)).toMatchObject({ qualityReview: 'ai-semantic-reviewed' });
  expect(complete.mock.calls[0][0].prompt).toContain('The object is stationary.');
  expect(complete.mock.calls[0][0].prompt).toContain('Exclude friction.');
  await expect(registry.resolve('guess-the-answer').review({ ...context, draft: { ...context.draft, correctAnswer: 'Friction.' } }))
    .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'ANSWER_INVALID' });
});

test('a format-only strategy inherits semantic checks, and an unreviewed hook result is refused', async () => {
  const registry = new QuestionAIStrategyRegistry().register('guess-the-answer', { id: 'format-only', prompt: () => 'Recall the force.' });
  const complete = jest.fn(async () => ({ content: JSON.stringify({ contentIsValid: true, answerIsCorrect: false,
    rubricIsAppropriate: true, feedbackIsConsistent: true, followsInstructorRequest: true, evidenceIsSufficient: true,
    issues: ['Friction does not balance vertical weight in this case.'], calculations: [] }) }));
  const context = { draft: { questionText: 'What balances weight on a horizontal surface?', correctAnswer: 'Friction.' }, questionType: 'guess-the-answer', complete };
  await expect(registry.resolve('guess-the-answer').review(context)).rejects.toMatchObject({ qualityFailureReason: 'ANSWER_INVALID' });
  registry.register('guess-the-answer', { id: 'unreviewed', review: async ({ draft }) => draft }, { replace: true });
  await expect(registry.resolve('guess-the-answer').review(context)).rejects.toMatchObject({ qualityFailureReason: 'REVIEW_INVALID_RESPONSE' });
});

test('a custom review cannot silently change the key or question, even with passing metadata', async () => {
  const registry = new QuestionAIStrategyRegistry();
  const draft = { questionText: 'What balances weight?', correctAnswer: 'Normal force', content: { solutionText: 'Normal force' } };
  const reviewSummary = { kind: 'semantic', policyVersion: QUESTION_REVIEW_POLICY_VERSION, mediaInspection: 'not-performed',
    checks: Object.fromEntries(QUESTION_REVIEW_VERDICT_FIELDS.map(key => [key, true])) };
  for (const change of [{ correctAnswer: 'Friction' }, { questionText: 'What resists sliding?' }, { content: { solutionText: 'Friction' } }]) {
    registry.register('guess-the-answer', { id: 'answer-changing', review: async ({ draft }) => ({ ...draft, ...change,
      qualityReview: 'ai-semantic-reviewed', reviewSummary }) }, { replace: true });
    await expect(registry.resolve('guess-the-answer').review({ draft })).rejects.toMatchObject({ qualityFailureReason: 'REVIEW_INVALID_RESPONSE' });
  }
  expect(draft.correctAnswer).toBe('Normal force');
});
