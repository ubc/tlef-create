import { describe, expect, jest, test } from '@jest/globals';
import { feedbackReviewSchema, reviewQuestionFeedback } from '../../services/questionFeedbackReview.js';

const question = {
  questionText: 'What is condensation?', correctAnswer: 'Gas changes to liquid.', explanation: 'Original explanation',
  content: { selectionMode: 'single', options: [
    { text: 'Gas changes to liquid.', isCorrect: true, chosenFeedback: 'Correct.', notChosenFeedback: 'This describes vaporization, not condensation.' },
    { text: 'Liquid changes to gas.', isCorrect: false, chosenFeedback: 'Incorrect.', notChosenFeedback: 'You confused the direction.' }
  ] }
};
const reviewed = { contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true, evidenceIsSufficient: true, followsInstructorRequest: true, issues: ['The omission feedback reverses the correct concept.'], explanation: 'Condensation converts gas to liquid as energy is lost.', calculations: [], feedback: [
  { optionText: 'Gas changes to liquid.', isCorrect: true, rationale: 'Condensation changes gas to liquid.', calculations: [] },
  { optionText: 'Liquid changes to gas.', isCorrect: false, rationale: 'Liquid changing to gas describes evaporation.', calculations: [] }
] };
const complete = payload => jest.fn().mockResolvedValue({ content: JSON.stringify(payload), model: 'test-model' });

describe('independent question feedback review', () => {
  test('retains a bounded private rejected draft and observations, while the receipt remains generic', async () => {
    const { safeQuestionJobFailure } = await import('../../services/questionGenerationJobs.js');
    const review = { ...reviewed, answerIsCorrect: false, issues: ['The marked option contradicts condensation.'] };
    let error;
    try { await reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete(review) }); } catch (caught) { error = caught; }
    expect(error.rejectedDraft).toMatchObject({ questionText: question.questionText, issues: review.issues });
    expect(JSON.stringify(safeQuestionJobFailure(error))).not.toContain(review.issues[0]);
    expect(JSON.stringify(safeQuestionJobFailure(error))).not.toContain(question.questionText);
  });

  test.each([
    [{ ...reviewed, answerIsCorrect: false }, 'ANSWER_INVALID'],
    [{ ...reviewed, followsInstructorRequest: false }, 'INSTRUCTION_MISMATCH'],
    [{ ...reviewed, evidenceIsSufficient: false }, 'EVIDENCE_INSUFFICIENT'],
    [{ ...reviewed, contentIsValid: false }, 'ANSWER_INVALID'],
    [{ ...reviewed, rubricIsAppropriate: false }, 'RUBRIC_INVALID'],
    [{ ...reviewed, feedback: [] }, 'FEEDBACK_INVALID'],
    [{}, 'REVIEW_INVALID_RESPONSE']
  ])('reports a structured failure without storing review prose', async (payload, reason) => {
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete(payload) }))
      .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: reason });
  });
  test('scopes review to one item without dropping the instructor constraints', async () => {
    const model = complete(reviewed);
    await reviewQuestionFeedback(question, { questionType: 'multiple-choice',
      instructorRequest: 'SINGLE-QUESTION TASK. Row: create two questions; do not invent measurements.', complete: model });
    expect(model.mock.calls[0][0].prompt).toContain('assess only this item and its assigned planned slice');
    expect(model.mock.calls[0][0].prompt).toContain('do not invent measurements');
  });
  test('repairs contradictory feedback without changing answer flags or mutating the input', async () => {
    const model = complete(reviewed);
    const result = await reviewQuestionFeedback(question, { questionType: 'multiple-choice', relevantContent: [{ content: 'Condensation is gas to liquid.' }], complete: model });
    expect(result.content.options[0].chosenFeedback).toBe(`Correct. ${reviewed.feedback[0].rationale}`);
    expect(result.content.options[0].notChosenFeedback).toBe(`This correct option was not selected. ${reviewed.feedback[0].rationale}`);
    expect(result.content.options[1].chosenFeedback).toBe(`This option is incorrect. ${reviewed.feedback[1].rationale}`);
    expect(result.content.options[1].notChosenFeedback).toBe(`Correctly left unselected. ${reviewed.feedback[1].rationale}`);
    expect(result.content.options.map(x => x.isCorrect)).toEqual([true, false]);
    expect(result.correctAnswer).toBe(question.correctAnswer);
    expect(question.content.options[0].notChosenFeedback).toContain('vaporization');
    expect(result.qualityReview).toBe('ai-feedback-reviewed');
    expect(model.mock.calls[0][0].prompt).toContain('Condensation is gas to liquid.');
  });
  test('rejects an incorrect answer rather than saving a silently changed key', async () => {
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete({ ...reviewed, answerIsCorrect: false }) })).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
  });
  test('rejects a factually correct draft that ignores the current instructor request', async () => {
    const model = complete({ ...reviewed, followsInstructorRequest: false });
    await expect(reviewQuestionFeedback(question, {
      questionType: 'multiple-choice', instructorRequest: 'Ask about a sealed cold glass, not runoff.', complete: model
    })).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', message: expect.stringContaining('instruction check') });
    expect(model.mock.calls[0][0].prompt).toContain('CURRENT INSTRUCTOR REQUEST (task data): Ask about a sealed cold glass, not runoff.');
  });
  test.each(['.', ':', '!'])('omission feedback does not inherit a redundant standalone verdict ending in %s', async punctuation => {
    const result = await reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete({ ...reviewed,
      feedback: [
        { ...reviewed.feedback[0], rationale: `Correct${punctuation} Condensation changes gas to liquid.` },
        { ...reviewed.feedback[1], rationale: `Incorrect${punctuation} Liquid changing to gas describes evaporation.` }
      ]
    }) });
    expect(result.content.options[0].chosenFeedback).toBe('Correct. Condensation changes gas to liquid.');
    expect(result.content.options[1].notChosenFeedback).toBe('Correctly left unselected. Liquid changing to gas describes evaporation.');
  });
  test('rejects incomplete or malformed review output', async () => {
    for (const payload of [{ ...reviewed, feedback: [reviewed.feedback[0]] }, { ...reviewed, explanation: '' }, {}, null]) {
      await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete(payload) })).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
    }
  });
  test.each([
    ['reordered feedback', [...reviewed.feedback].reverse()],
    ['changed option text', [{ ...reviewed.feedback[0], optionText: 'Liquid changes to gas.' }, reviewed.feedback[1]]],
    ['changed answer flag', [{ ...reviewed.feedback[0], isCorrect: false }, reviewed.feedback[1]]],
    ['missing option identity', [{ rationale: 'Gas becomes liquid.' }, reviewed.feedback[1]]],
    ['empty rationale', [{ ...reviewed.feedback[0], rationale: ' ' }, reviewed.feedback[1]]],
    ['legacy unconstrained feedback', [{ chosenFeedback: 'Correct', notChosenFeedback: 'Incorrect' }, reviewed.feedback[1]]]
  ])('rejects %s rather than attaching prose to the wrong answer', async (_label, feedback) => {
    await expect(reviewQuestionFeedback(question, {
      questionType: 'multiple-choice', complete: complete({ ...reviewed, feedback })
    })).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
  });
  test('does not spend an extra request for another type or an activity without option feedback', async () => {
    const model = complete(reviewed);
    expect(await reviewQuestionFeedback(question, { questionType: 'true-false', complete: model })).toBe(question);
    const noFeedback = { ...question, content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No' }] } };
    expect(await reviewQuestionFeedback(noFeedback, { questionType: 'multiple-choice', complete: model })).toBe(noFeedback);
    expect(model).not.toHaveBeenCalled();
  });
  test('supplies bounded course premises and one bounded review request', async () => {
    const model = complete(reviewed);
    const instructorContext = 'In this fictional setting, gravity points upward. '.repeat(1000);
    await reviewQuestionFeedback(question, { questionType: 'multiple-choice', instructorContext, complete: model });
    expect(model).toHaveBeenCalledTimes(1);
    const request = model.mock.calls[0][0];
    expect(request.prompt).toContain(instructorContext.slice(0, 16000));
    expect(request.prompt).not.toContain(instructorContext);
    expect(request.maxTokens).toBeLessThanOrEqual(8000);
  });
  test('classifies a checker transport error as terminal for generation fallback, preserving aborts', async () => {
    const outage = jest.fn().mockRejectedValue(new Error('Premature close'));
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: outage }))
      .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', cause: expect.any(Error) });
    expect(outage).toHaveBeenCalledTimes(1);
    const abort = Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: jest.fn().mockRejectedValue(abort) }))
      .rejects.toBe(abort);
  });
  test('distinguishes a review usage limit from an incorrect-answer verdict', async () => {
    const limit = Object.assign(new Error('PRIVATE provider usage details'), { status: 429 });
    const model = jest.fn().mockRejectedValue(limit);
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: model }))
      .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'REVIEW_LIMIT_REACHED' });
    expect(model).toHaveBeenCalledTimes(1);
  });
  test('requests learner-facing explanation without banning legitimate course vocabulary', async () => {
    const payload = { ...reviewed, explanation: 'The historical draft presents the author’s proposed policy.' };
    const model = complete(payload);
    const result = await reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: model });
    expect(result.explanation).toBe(payload.explanation);
    expect(model.mock.calls[0][0].prompt).toContain('Write explanation and every rationale directly for the learner');
    expect(model.mock.calls[0][0].prompt).toContain('Put review observations only in issues');
  });
  test('renders verified equations and leaves the original question and answer key unchanged', async () => {
    const model = complete({ ...reviewed, calculations: [{ expression: '(18 + 6) / 3', result: 8 }] });
    const result = await reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: model });
    expect(result.explanation).toContain('(18 + 6) / 3 = 8.');
    expect(result.questionText).toBe(question.questionText);
    expect(result.correctAnswer).toBe(question.correctAnswer);
    expect(result.content.options.map(option => option.isCorrect)).toEqual([true, false]);
    expect(model).toHaveBeenCalledTimes(1);
  });
  test('computes newly written incline feedback while preserving the correct rounded answer and option identities', async () => {
    const incline = { ...question, questionText: 'A block slides down a 30° incline with kinetic friction 0.20 and g = 9.80 m/s². Find its acceleration to two decimal places.',
      correctAnswer: '3.20 m/s²', content: { ...question.content, options: [
        { ...question.content.options[0], text: '3.20 m/s²' },
        { ...question.content.options[1], text: '6.60 m/s²' }
      ] } };
    const payload = { ...reviewed, issues: [], explanation: 'Friction opposes motion, so the downslope acceleration is approximately 3.20 m/s².',
      calculations: [{ expression: '9.8*(0.5-0.2*0.8660254037844386)' }],
      feedback: [
        { optionText: '3.20 m/s²', isCorrect: true, rationale: 'Subtract kinetic friction from the downslope gravitational component.', calculations: [] },
        { optionText: '6.60 m/s²', isCorrect: false, rationale: 'Adding friction in the direction of motion would produce approximately 6.60 m/s².', calculations: [{ expression: '9.8*(0.5+0.2*0.8660254037844386)' }] }
      ] };
    const model = complete(payload);
    const result = await reviewQuestionFeedback(incline, { questionType: 'multiple-choice', complete: model });
    expect(result.explanation).toContain('≈ 3.202590209.');
    expect(result.content.options[1].chosenFeedback).toContain('≈ 6.597409791.');
    expect(result.reviewSummary.arithmeticChecks).toBe(2);
    expect(result.questionText).toBe(incline.questionText);
    expect(result.correctAnswer).toBe('3.20 m/s²');
    expect(result.content.options.map(({ text, isCorrect }) => ({ text, isCorrect })))
      .toEqual(incline.content.options.map(({ text, isCorrect }) => ({ text, isCorrect })));
    expect(feedbackReviewSchema.schema.properties.calculations.items).toMatchObject({ required: ['expression'], properties: { expression: { type: 'string' } }, additionalProperties: false });
    expect(feedbackReviewSchema.schema.properties.calculations.items.properties).not.toHaveProperty('result');
    expect(model.mock.calls[0][0].prompt).toContain('expression only');
  });
  test.each([
    ['wrong distractor derivation', { expression: '12 + 8 - 3', result: 20 }, 'ARITHMETIC_FALSE_EQUALITY'],
    ['wrong multiplication', { expression: '7 * 8', result: 54 }, 'ARITHMETIC_FALSE_EQUALITY'],
    ['division by zero', { expression: '3 / 0', result: 0 }, 'ARITHMETIC_DIVISION_BY_ZERO'],
    ['unsupported expression', { expression: 'Math.max(1, 2)', result: 2 }, 'ARITHMETIC_UNSUPPORTED_EXPRESSION']
  ])('rejects %s rather than saving unchecked arithmetic or silently changing an answer', async (_label, calculation, qualityFailureReason) => {
    const payload = { ...reviewed, feedback: reviewed.feedback.map((item, index) => index === 1 ? { ...item, calculations: [calculation] } : item) };
    const model = complete(payload);
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: model }))
      .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityCheck: 'arithmetic', qualityFailureReason });
    expect(model).toHaveBeenCalledTimes(1);
  });
  test('rejects false explicit prose equations even if the declared calculation list is empty', async () => {
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete({ ...reviewed, explanation: 'The result is 7 × 8 = 54.' }) }))
      .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW' });
  });
  test('retains the exact deterministic mismatch in the private rejected draft', async () => {
    const payload = { ...reviewed, issues: [], feedback: reviewed.feedback.map((item, index) => index === 1
      ? { ...item, calculations: [{ expression: '9.8*(0.500+0.20*0.866)', result: 6.59 }] } : item) };
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete(payload) }))
      .rejects.toMatchObject({ rejectedDraft: { issues: [], calculationCheck: {
        location: 'option 2 feedback', expression: '9.8*(0.500+0.20*0.866)', computed: expect.closeTo(6.59736, 12), claimed: 6.59
      } } });
  });
  test('requires calculation declarations but allows non-arithmetic hypothetical premises', async () => {
    await expect(reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete({ ...reviewed, calculations: undefined }) }))
      .rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'ARITHMETIC_INVALID_SCHEMA' });
    const payload = { ...reviewed, explanation: 'In this hypothetical simulation, gravity points upward; the released bead accelerates upward.' };
    const result = await reviewQuestionFeedback(question, { questionType: 'multiple-choice', complete: complete(payload) });
    expect(result.explanation).toBe(payload.explanation);
  });
});

test('feedback repair calls only the reviewer, retains the answer, and still rejects an incorrect answer', async () => {
  const { default: llm } = await import('../../services/llmService.js');
  const model = jest.spyOn(llm, 'streamCompletion').mockResolvedValue({ content: JSON.stringify(reviewed) });
  const draftPrompt = jest.spyOn(llm, 'buildExpertPrompt');
  try {
    const input = { repairDraft: question, questionType: 'multiple-choice', instructorPrompt: 'Ask about condensation',
      relevantContent: [{ content: 'Condensation is gas to liquid.' }], llmConfig: { model: 'fixture-model', provider: 'openai' } };
    const result = await llm.generateQuestionStreaming(input);
    expect(draftPrompt).not.toHaveBeenCalled(); expect(model).toHaveBeenCalledTimes(1);
    expect(result.questionData.questionText).toBe(question.questionText);
    expect(result.questionData.correctAnswer).toBe(question.correctAnswer);
    expect(result.questionData.content.options.map(option => [option.text, option.isCorrect])).toEqual(question.content.options.map(option => [option.text, option.isCorrect]));
    model.mockResolvedValue({ content: JSON.stringify({ ...reviewed, answerIsCorrect: false }) });
    await expect(llm.generateQuestionStreaming(input)).rejects.toMatchObject({ qualityFailureReason: 'ANSWER_INVALID' });
    model.mockResolvedValue({ content: JSON.stringify({ ...reviewed, calculations: [{ expression: '12*9.8*0.866025403784', result: 101.823389485 }] }) });
    await expect(llm.generateQuestionStreaming(input)).rejects.toMatchObject({ qualityFailureReason: 'ARITHMETIC_FALSE_EQUALITY' });
    expect(draftPrompt).not.toHaveBeenCalled();
  } finally { model.mockRestore(); draftPrompt.mockRestore(); }
});
