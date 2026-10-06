import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { reviewQuestionSemantics, reviewQuestionWithDefaultPolicy, semanticReviewSchema } from '../../services/questionSemanticReview.js';
import { QUESTION_REVIEW_POLICY_VERSION, QUESTION_TIME_SCOPE_REVIEW_INSTRUCTION } from '../../services/questionReviewContract.js';
import { generateWithRework } from '../../services/questionRework.js';
import { createQuestionJobService, questionGenerationRequestHash, safeQuestionJobFailure } from '../../services/questionGenerationJobs.js';
import Question from '../../models/Question.js';
import RejectedQuestionDraft from '../../models/RejectedQuestionDraft.js';
import llmService from '../../services/llmService.js';

const passed = { contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true,
  feedbackIsConsistent: true, followsInstructorRequest: true, evidenceIsSufficient: true, issues: [], calculations: [] };
const completion = verdict => jest.fn().mockResolvedValue({ content: JSON.stringify(verdict), model: 'test-model' });
const drafts = [
  ['true-false', { questionText: 'Condensation changes gas to liquid.', correctAnswer: 'False', explanation: 'Gas becomes a liquid.',
    content: { options: [{ text: 'True', isCorrect: false }, { text: 'False', isCorrect: true }] } }],
  ['cloze', { questionText: 'Complete the change.', correctAnswer: 'gas', explanation: 'Condensation forms a liquid.',
    content: { textWithBlanks: 'Condensation changes gas to $$.', blankOptions: [['liquid', 'gas']], correctAnswers: ['gas'] } }],
  ['matching', { questionText: 'Match the processes.', correctAnswer: '0:1,1:0', explanation: 'Match the changes.',
    content: { leftItems: ['Condensation', 'Evaporation'], rightItems: ['Gas to liquid', 'Liquid to gas'], matchingPairs: [{ left: 0, right: 1 }, { left: 1, right: 0 }] } }],
  ['ordering', { questionText: 'Order water cycle changes from heating liquid.', correctAnswer: ['Condensation', 'Evaporation'], explanation: 'Heating precedes cooling.',
    content: { items: ['Evaporation', 'Condensation'], correctOrder: ['Condensation', 'Evaporation'] } }],
  ['crossword', { questionText: 'Complete the clue.', correctAnswer: 'Evaporation', explanation: 'Read each clue.',
    content: { words: [{ clue: 'Gas changing to liquid', answer: 'Evaporation' }] } }]
];
const essay = { questionText: 'Explain two ways cities could conserve water.', taskDescription: 'Propose two feasible approaches and explain trade-offs.',
  keywords: [{ keyword: 'repair leaks', alternatives: ['reduce pipe losses'], points: 2 }, { keyword: 'reuse water', alternatives: ['recycling'], points: 2 }],
  sampleAnswer: 'Repairing leaks reduces losses. Reusing treated water can reduce demand but requires infrastructure.',
  correctAnswer: 'See sample answer', explanation: 'Other defensible approaches can receive credit.' };

afterEach(() => jest.restoreAllMocks());
describe('semantic checks across answer formats', () => {
  test.each(drafts)('%s sends the complete saved key/content to an independent check and refuses a wrong answer', async (questionType, draft) => {
    const model = completion({ ...passed, answerIsCorrect: false, issues: ['The saved answer contradicts the stated water process.'] });
    let failure;
    try { await reviewQuestionSemantics(draft, { questionType, relevantContent: [{ content: 'Condensation changes gas to liquid; evaporation changes liquid to gas.' }], complete: model }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'ANSWER_INVALID', repairKind: 'redraft',
      rejectedDraft: { contentSummary: expect.stringContaining(JSON.stringify(draft.content)) } });
    expect(failure.repairDraft).toBeUndefined();
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][0].prompt).toContain(JSON.stringify(draft));
    expect(model.mock.calls[0][0].prompt).toContain('Solve answer-bearing tasks');
    expect(model.mock.calls[0][0].prompt).toContain('Condensation changes gas to liquid; evaporation');
    expect(draft.correctAnswer).toEqual(drafts.find(item => item[0] === questionType)[1].correctAnswer);
  });

  test('an essay is judged by the task and rubric, without requiring the sample to be the only answer', async () => {
    const model = completion(passed);
    const checked = await reviewQuestionSemantics(essay, { questionType: 'essay', instructorRequest: 'Credit justified alternatives.', complete: model });
    expect(checked).toMatchObject({ ...essay, qualityReview: 'ai-semantic-reviewed', reviewSummary: {
      kind: 'semantic', policyVersion: QUESTION_REVIEW_POLICY_VERSION, arithmeticChecks: 0, mediaInspection: 'not-performed'
    } });
    expect(model.mock.calls[0][0].prompt).toContain('sample answer is an example, not the only acceptable learner response');
    expect(model.mock.calls[0][0].prompt).toContain(JSON.stringify(essay.keywords));
    expect(model.mock.calls[0][0].prompt).toContain(essay.sampleAnswer);
  });

  test('a rubric mismatch gets a bounded rubric redraft and the same independent check', async () => {
    const model = completion({ ...passed, rubricIsAppropriate: false, issues: ['The rubric awards unrelated biology keywords for a water conservation task.'] });
    model.mockResolvedValueOnce({ content: JSON.stringify({ ...passed, rubricIsAppropriate: false, issues: ['Unrelated assessment keywords.'] }) })
      .mockResolvedValueOnce({ content: JSON.stringify(passed) });
    const onRepair = jest.fn(); const corrected = { ...essay, keywords: essay.keywords };
    const generate = jest.fn(async config => reviewQuestionSemantics(corrected, { questionType: 'essay', instructorRequest: config.instructorPrompt || config.customPrompt, complete: model }));
    await expect(generateWithRework({ config: { questionType: 'essay', customPrompt: 'Assess water conservation.' }, generate,
      onAttempt: async () => {}, onRepair, enabled: true })).resolves.toMatchObject({ qualityReview: 'ai-semantic-reviewed' });
    expect(onRepair).toHaveBeenCalledWith('rubric');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].customPrompt).toContain('reasonable alternative responses');
    expect(generate.mock.calls[1][0].repairDraft).toBeUndefined();
  });

  test.each([
    ['feedbackIsConsistent', 'FEEDBACK_INVALID'], ['followsInstructorRequest', 'INSTRUCTION_MISMATCH'],
    ['evidenceIsSufficient', 'EVIDENCE_INSUFFICIENT'], ['contentIsValid', 'ANSWER_INVALID']
  ])('a failed %s blocks publication with %s', async (field, reason) => {
    const model = completion({ ...passed, [field]: false, issues: ['A concrete task mismatch.'] });
    await expect(reviewQuestionSemantics(essay, { questionType: 'essay', instructorContext: 'Audience: beginning learners. Exclude desalination.',
      instructorRequest: 'Use only the supplied source.', relevantContent: [{ content: 'The source discusses repairing leaks only.' }], complete: model }))
      .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: reason, repairKind: reason === 'EVIDENCE_INSUFFICIENT' ? 'none' : 'redraft' });
    expect(model.mock.calls[0][0].prompt).toContain('Exclude desalination.');
    expect(model.mock.calls[0][0].prompt).toContain('Use only the supplied source.');
    expect(model.mock.calls[0][0].prompt).toContain('source-dependent assertions must follow from the supplied excerpts');
  });

  test('non-MC feedback failure uses a full redraft rather than the MC-only repair transport', async () => {
    let error;
    try { await reviewQuestionSemantics(drafts[1][1], { questionType: 'cloze', complete: completion({ ...passed, feedbackIsConsistent: false }) }); } catch (caught) { error = caught; }
    const generate = jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ success: true });
    const onRepair = jest.fn();
    await generateWithRework({ config: { questionType: 'cloze', customPrompt: 'Keep the gas-to-liquid example.' }, generate,
      onAttempt: async () => {}, onRepair, enabled: true });
    expect(onRepair).toHaveBeenCalledWith('redraft');
    expect(generate.mock.calls[1][0].repairDraft).toBeUndefined();
    expect(generate.mock.calls[1][0].customPrompt).toContain('feedback against the saved answers');
  });

  test('insufficient evidence asks for attention without automatically buying another draft', async () => {
    const generate = jest.fn(async () => reviewQuestionSemantics(essay, { questionType: 'essay', complete: completion({ ...passed, evidenceIsSufficient: false }) }));
    await expect(generateWithRework({ config: { questionType: 'essay' }, generate, onAttempt: async () => {}, enabled: true }))
      .rejects.toMatchObject({ qualityFailureReason: 'EVIDENCE_INSUFFICIENT' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['essay', essay],
    ['multiple-choice', { questionText: 'Which process changes gas to liquid?', correctAnswer: 'Condensation',
      content: { options: [
        { text: 'Condensation', isCorrect: true, chosenFeedback: 'Correct.', notChosenFeedback: 'Missed.' },
        { text: 'Evaporation', isCorrect: false, chosenFeedback: 'Wrong.', notChosenFeedback: 'Correct omission.' }
      ] } }]
  ])('%s missing evidence takes priority over simultaneous instruction and answer failures without automatic repair', async (questionType, draft) => {
    const model = completion({ ...passed, evidenceIsSufficient: false, followsInstructorRequest: false,
      answerIsCorrect: false, issues: ['The source-only request lacks evidence for the assertion.'] });
    const generate = jest.fn(async () => reviewQuestionWithDefaultPolicy({ draft, questionType,
      instructorRequest: 'Use only the supplied source.', complete: model }));
    const onAttempt = jest.fn(); const onRepair = jest.fn();
    await expect(generateWithRework({ config: { questionType }, generate, onAttempt, onRepair, enabled: true }))
      .rejects.toMatchObject({ qualityFailureReason: 'EVIDENCE_INSUFFICIENT', repairKind: 'none',
        rejectedDraft: { reviewSummary: { checks: { evidenceIsSufficient: false, followsInstructorRequest: false } } } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledTimes(1);
    expect(onAttempt.mock.calls).toEqual([[1]]);
    expect(onRepair).not.toHaveBeenCalled();
  });

  test('declared false arithmetic is mechanically rejected while valid arithmetic keeps the original activity unchanged', async () => {
    const draft = { questionText: 'Calculate total water demand.', content: { solutionText: '12 + 8 = 21' }, correctAnswer: '21', explanation: 'Add the values.' };
    await expect(reviewQuestionSemantics(draft, { questionType: 'guess-the-answer', complete: completion({ ...passed, calculations: [{ expression: '12+8', result: 21 }] }) }))
      .rejects.toMatchObject({ qualityFailureReason: 'ARITHMETIC_FALSE_EQUALITY', rejectedDraft: { calculationCheck: { computed: 20, claimed: 21 } } });
    const valid = { ...draft, correctAnswer: '20', content: { solutionText: '12 + 8 = 20' } };
    const checked = await reviewQuestionSemantics(valid, { questionType: 'guess-the-answer', complete: completion({ ...passed, calculations: [{ expression: '12+8', result: 20 }] }) });
    expect(checked.content).toEqual(valid.content);
    expect(checked.reviewSummary.arithmeticChecks).toBe(1);
  });

  test('a deliberately false distractor is not mistaken for an asserted solution', async () => {
    const draft = { questionText: 'Which equation is false?', correctAnswer: '2+2=5', explanation: 'The sum should be 4.',
      content: { options: [{ text: '2+2=5', isCorrect: true }, { text: '2+2=4', isCorrect: false }] } };
    await expect(reviewQuestionSemantics(draft, { questionType: 'multiple-choice', complete: completion(passed) })).resolves.toMatchObject({ correctAnswer: '2+2=5' });
  });

  test('time scope, initial conditions and quantifiers are part of the general check', async () => {
    const moving = { questionText: 'A moving vehicle has zero net force at one instant.', correctAnswer: 'It remains at rest or uniform motion.', explanation: 'Zero force implies a persistent state.' };
    const model = completion({ ...passed, answerIsCorrect: false, issues: ['The instantaneous condition does not imply an interval, and moving is already specified.'] });
    await expect(reviewQuestionSemantics(moving, { questionType: 'guess-the-answer', complete: model })).rejects.toMatchObject({ qualityFailureReason: 'ANSWER_INVALID' });
    expect(model.mock.calls[0][0].prompt).toContain(QUESTION_TIME_SCOPE_REVIEW_INSTRUCTION);
  });

  test('whole-activity review checks collection quantity and coverage instead of applying single-question exemptions', async () => {
    const model = completion({ ...passed, followsInstructorRequest: false, issues: ['Only five cards were supplied instead of six.'] });
    await expect(reviewQuestionSemantics({ questionText: 'Water changes', content: { cards: Array.from({ length: 5 }, (_, index) => ({ text: `Card ${index + 1}` })) } },
      { questionType: 'H5P.Flashcards 1.7', scope: 'activity', instructorRequest: 'Create six cards, including condensation.', complete: model }))
      .rejects.toMatchObject({ qualityFailureReason: 'INSTRUCTION_MISMATCH' });
    const prompt = model.mock.calls[0][0].prompt;
    expect(prompt).toContain('ENTIRE existing activity document');
    expect(prompt).toContain('Check all requested quantities, distribution');
    expect(prompt).not.toContain('do not reject one question for not containing the other batch items');
  });

  test('text and metadata checks do not claim to inspect audio, images or video', async () => {
    const model = completion({ ...passed, evidenceIsSufficient: false, issues: ['An audio-only answer cannot be verified from the supplied text.'] });
    await expect(reviewQuestionSemantics({ questionText: 'Transcribe the recording.', content: { audio: { path: 'saved-audio.wav' } }, correctAnswer: 'A transcript.' },
      { questionType: 'dictation', complete: model })).rejects.toMatchObject({ qualityFailureReason: 'EVIDENCE_INSUFFICIENT',
      rejectedDraft: { reviewSummary: { mediaInspection: 'not-performed' } } });
    expect(model.mock.calls[0][0].prompt).toContain('cannot listen to audio, inspect image pixels, watch videos');
  });

  test.each([{}, { ...passed, calculations: null }, { ...passed, answerIsCorrect: 'yes' }, { ...passed, correctAnswer: 'A changed key' }])(
    'malformed or answer-rewriting review output never changes the original draft', async verdict => {
      await expect(reviewQuestionSemantics(essay, { questionType: 'essay', complete: completion(verdict) })).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
      expect(essay.correctAnswer).toBe('See sample answer');
    });

  test.each([['REVIEW_UNAVAILABLE', new Error('PRIVATE transport response')], ['REVIEW_LIMIT_REACHED', Object.assign(new Error('PRIVATE allowance'), { status: 429 })]])(
    '%s is terminal for automatic rework and does not persist private service details', async (reason, outage) => {
      const model = jest.fn().mockRejectedValue(outage);
      let failure;
      try { await reviewQuestionSemantics(essay, { questionType: 'essay', complete: model }); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ qualityFailureReason: reason });
      expect(JSON.stringify(safeQuestionJobFailure(failure))).not.toContain('PRIVATE');
      expect(JSON.stringify(failure.rejectedDraft)).not.toContain('PRIVATE');
      const generate = jest.fn().mockRejectedValue(failure);
      await expect(generateWithRework({ config: { questionType: 'essay' }, generate, onAttempt: async () => {}, enabled: true })).rejects.toBe(failure);
      expect(generate).toHaveBeenCalledTimes(1);
    });

  test('cancellation stops review without a fallback or a successful result', async () => {
    const controller = new AbortController(); const abort = new Error('Stopped');
    const model = jest.fn(async () => { controller.abort(abort); return { content: JSON.stringify(passed) }; });
    await expect(reviewQuestionSemantics(essay, { questionType: 'essay', complete: model, signal: controller.signal })).rejects.toBe(abort);
    expect(model).toHaveBeenCalledTimes(1);
  });

  test.each(['AUTHORING_MODEL_UNCERTAIN', 'AUTHORING_CONTRACT_CHANGED', 'GENERATION_INTERRUPTED'])(
    'preserves %s from a durable completion wrapper instead of treating it as a provider outage', async code => {
      const error = Object.assign(new Error('The saved execution cannot be continued.'), { code });
      const model = jest.fn().mockRejectedValue(error);
      const mc = { questionText: 'Pick the water change.', correctAnswer: 'Condensation', content: { options: [
        { text: 'Condensation', isCorrect: true, chosenFeedback: 'Correct.', notChosenFeedback: 'Missed.' },
        { text: 'Evaporation', isCorrect: false, chosenFeedback: 'Wrong.', notChosenFeedback: 'Correct omission.' }
      ] } };
      for (const [draft, questionType] of [[essay, 'essay'], [mc, 'multiple-choice']]) {
        await expect(reviewQuestionWithDefaultPolicy({ draft, questionType, complete: model })).rejects.toBe(error);
      }
      expect(model).toHaveBeenCalledTimes(2);
    });
});

describe('review policy and persistence contract', () => {
  test('MC without a complete feedback contract receives semantic review rather than skipping review', async () => {
    const model = completion(passed);
    await expect(reviewQuestionWithDefaultPolicy({ draft: { questionText: 'Choose a water change.', correctAnswer: 'Condensation', content: { options: [
      { text: 'Condensation', isCorrect: true }, { text: 'Evaporation', isCorrect: false }
    ] } }, questionType: 'multiple-choice', complete: model })).resolves.toMatchObject({ qualityReview: 'ai-semantic-reviewed' });
    expect(model.mock.calls[0][0].jsonSchema).toBe(semanticReviewSchema);
  });

  test('MC with complete feedback keeps option identity and learner-action review, including temporal checks', async () => {
    const draft = { questionText: 'Which process converts gas to liquid?', correctAnswer: 'Condensation', explanation: 'Read the states.', content: { options: [
      { text: 'Condensation', isCorrect: true, chosenFeedback: 'Yes', notChosenFeedback: 'Missed' },
      { text: 'Evaporation', isCorrect: false, chosenFeedback: 'No', notChosenFeedback: 'Left out' }
    ] } };
    const model = completion({ contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true, evidenceIsSufficient: true, followsInstructorRequest: true, issues: [], explanation: 'Gas changes to liquid.', calculations: [], feedback: draft.content.options.map(option => ({
      optionText: option.text, isCorrect: option.isCorrect, rationale: option.isCorrect ? 'Gas becomes liquid.' : 'Liquid becomes gas.', calculations: []
    })) });
    const checked = await reviewQuestionWithDefaultPolicy({ draft, questionType: 'multiple-choice', complete: model });
    expect(checked.qualityReview).toBe('ai-feedback-reviewed');
    expect(checked.reviewSummary.kind).toBe('feedback');
    expect(checked.content.options[0].notChosenFeedback).toContain('correct option was not selected');
    expect(model.mock.calls[0][0].prompt).toContain(QUESTION_TIME_SCOPE_REVIEW_INSTRUCTION);
  });

  test.each(['source-only facts', 'media without a text description'])('MC refuses %s without a paid feedback repair', async scenario => {
    const draft = { questionText: 'Identify the states shown by the course figure.', correctAnswer: 'Gas to liquid', explanation: 'Read the states.',
      content: { image: { path: 'course-figure.png' }, options: [
        { text: 'Gas to liquid', isCorrect: true, chosenFeedback: 'Yes', notChosenFeedback: 'Missed' },
        { text: 'Liquid to gas', isCorrect: false, chosenFeedback: 'No', notChosenFeedback: 'Left out' }
      ] } };
    const model = completion({ contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true, evidenceIsSufficient: false,
      followsInstructorRequest: true, issues: ['Necessary figure evidence was not supplied.'], explanation: 'Read the states.', calculations: [], feedback: [] });
    const generate = jest.fn(() => reviewQuestionWithDefaultPolicy({ draft, questionType: 'multiple-choice',
      instructorRequest: scenario === 'source-only facts' ? 'Use only the supplied course figure.' : 'Identify what the image shows.', complete: model }));
    await expect(generateWithRework({ config: { questionType: 'multiple-choice' }, generate, enabled: true, onAttempt: async () => {} }))
      .rejects.toMatchObject({ qualityFailureReason: 'EVIDENCE_INSUFFICIENT', repairKind: 'none',
        rejectedDraft: { reviewSummary: { checks: { evidenceIsSufficient: false }, mediaInspection: 'not-performed' } } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][0].prompt).toContain('course-figure.png');
    expect(model.mock.calls[0][0].prompt).toContain('source-only request cannot invent facts or measurements');
    expect(model.mock.calls[0][0].prompt).toContain('cannot listen to audio, inspect image pixels, watch videos');
  });

  test('Question and rejected-draft schemas retain bounded review summaries and reject unsupported quality tags', async () => {
    const checked = await reviewQuestionSemantics(essay, { questionType: 'essay', complete: completion(passed) });
    const ids = { quiz: '111111111111111111111111', createdBy: '222222222222222222222222' };
    const document = new Question({ ...ids, type: 'essay', difficulty: 'moderate', questionText: essay.questionText, content: { taskDescription: essay.taskDescription },
      generationMetadata: { qualityReview: checked.qualityReview, reviewSummary: checked.reviewSummary } });
    expect(document.validateSync()).toBeUndefined();
    expect(document.toObject().generationMetadata.reviewSummary).toMatchObject(checked.reviewSummary);
    document.generationMetadata.qualityReview = 'certified-correct';
    expect(document.validateSync()?.errors['generationMetadata.qualityReview']).toBeDefined();
    const rejected = new RejectedQuestionDraft({ owner: ids.createdBy, quiz: ids.quiz, job: '333333333333333333333333', index: 0,
      contentSummary: JSON.stringify(essay), reviewSummary: checked.reviewSummary });
    expect(rejected.validateSync()).toBeUndefined();
    rejected.contentSummary = 'x'.repeat(8001);
    expect(rejected.validateSync()?.errors.contentSummary).toBeDefined();
  });

  test('changing review policy prevents old prepared drafts from matching the current reuse contract', () => {
    const input = { quizId: '111111111111111111111111', mode: 'append', questionConfigs: [{ questionType: 'true-false', customPrompt: 'Assess condensation.' }] };
    const stableJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    const oldHash = createHash('sha256').update(stableJson(input)).digest('hex');
    expect(questionGenerationRequestHash(input)).not.toBe(oldHash);
    expect(questionGenerationRequestHash(input)).toBe(questionGenerationRequestHash(structuredClone(input)));
  });

  test('a ready candidate from an older review policy is refused before retry work or publication starts', async () => {
    const owner = '222222222222222222222222'; const quizId = '111111111111111111111111';
    const questionConfigs = [{ questionType: 'true-false', customPrompt: 'Assess condensation.' }];
    const stableJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    const oldReceipt = { owner, quiz: quizId, status: 'partial', active: false,
      requestHash: createHash('sha256').update(stableJson({ quizId, mode: 'append', questionConfigs })).digest('hex'),
      items: [{ status: 'ready', savedQuestionId: '333333333333333333333333' }] };
    const JobModel = { init: async () => {}, findOne: jest.fn(async query => query.requestId === 'previous-generation-request' ? oldReceipt : null), create: jest.fn() };
    const QuizModel = { exists: async () => true }; const work = jest.fn();
    const service = createQuestionJobService({ JobModel, QuizModel, QuestionModel: {} });
    await expect(service.start({ owner, quizId, requestId: 'current-generation-request', retryFromRequestId: 'previous-generation-request',
      questionConfigs, work })).rejects.toMatchObject({ code: 'GENERATION_SNAPSHOT_CHANGED' });
    expect(work).not.toHaveBeenCalled(); expect(JobModel.create).not.toHaveBeenCalled();
  });

  test.each(['generateQuestion', 'generateQuestionStreaming'])('%s runs semantic review before returning a non-MC draft', async method => {
    const draft = { ...drafts[0][1], correctAnswer: 'True', content: { options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }] } };
    jest.spyOn(llmService, 'buildExpertPrompt').mockResolvedValue('Independent draft prompt');
    jest.spyOn(llmService, 'parseAndValidateResponse').mockReturnValue(draft);
    const model = jest.spyOn(llmService, 'streamCompletion');
    if (method === 'generateQuestionStreaming') model.mockResolvedValueOnce({ content: JSON.stringify(draft) }).mockResolvedValueOnce({ content: JSON.stringify(passed) });
    else {
      jest.spyOn(llmService, 'createLLMForConfig').mockReturnValue({ sendMessage: async () => ({ content: JSON.stringify(draft) }) });
      model.mockResolvedValue({ content: JSON.stringify(passed) });
    }
    const checked = await llmService[method]({ questionType: 'true-false', learningObjective: 'Explain condensation.',
      llmConfig: { provider: 'openai', model: 'gpt-5-nano', endpoint: 'https://invalid.test', apiKey: 'test-unused' } });
    expect(checked.questionData.generationMetadata).toMatchObject({ qualityReview: 'ai-semantic-reviewed', reviewSummary: { kind: 'semantic' } });
    expect(model.mock.calls.at(-1)[0].jsonSchema).toBe(semanticReviewSchema);
  });

  test.each(['generateQuestion', 'generateQuestionStreaming'])('%s refuses a semantically wrong non-MC draft without another paid generation', async method => {
    const draft = drafts[0][1];
    jest.spyOn(llmService, 'buildExpertPrompt').mockResolvedValue('Independent draft prompt');
    jest.spyOn(llmService, 'parseAndValidateResponse').mockReturnValue(draft);
    const model = jest.spyOn(llmService, 'streamCompletion');
    const rejection = { content: JSON.stringify({ ...passed, answerIsCorrect: false, issues: ['Wrong truth value.'] }) };
    let sendMessage;
    if (method === 'generateQuestionStreaming') model.mockResolvedValueOnce({ content: JSON.stringify(draft) }).mockResolvedValueOnce(rejection);
    else {
      sendMessage = jest.fn(async () => ({ content: JSON.stringify(draft) }));
      jest.spyOn(llmService, 'createLLMForConfig').mockReturnValue({ sendMessage }); model.mockResolvedValue(rejection);
    }
    await expect(llmService[method]({ questionType: 'true-false', learningObjective: 'Explain condensation.',
      llmConfig: { provider: 'openai', model: 'gpt-5-nano', endpoint: 'https://invalid.test', apiKey: 'test-unused' } }))
      .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'ANSWER_INVALID' });
    expect(model).toHaveBeenCalledTimes(method === 'generateQuestionStreaming' ? 2 : 1);
    if (sendMessage) expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
