import { expect, jest, test } from '@jest/globals';
import { generateWithRework } from '../../services/questionRework.js';
const config = { questionType: 'multiple-choice', customPrompt: 'Calculate normal force to 0.1 N.' };
const invalid = reason => Object.assign(new Error('Rejected'), { code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: reason,
  rejectedDraft: { questionText: '12 kg at 30 degrees', calculationCheck: { expression: '12*9.8*0.866025403784', claimed: 101.823389485, computed: 101.844587484998 } } });
test('one rework receives the arithmetic discrepancy and preserves the approved instruction', async () => {
  const generate = jest.fn().mockRejectedValueOnce(invalid('ARITHMETIC_FALSE_EQUALITY')).mockResolvedValue({ saved: true });
  const onAttempt = jest.fn();
  await expect(generateWithRework({ config, generate, onAttempt, enabled: true })).resolves.toEqual({ saved: true });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1][0].instructorPrompt).toBe(config.customPrompt);
  expect(generate.mock.calls[1][0].customPrompt).toContain('101.844587484998');
  expect(onAttempt.mock.calls).toEqual([[1], [2]]);
});
test('a rejected rework stops after two attempts, retaining the final failure', async () => {
  const error = invalid('ANSWER_INVALID'); const generate = jest.fn().mockRejectedValue(error);
  await expect(generateWithRework({ config, generate, onAttempt: async () => {}, enabled: true })).rejects.toBe(error);
  expect(generate).toHaveBeenCalledTimes(2);
});
test.each(['REVIEW_UNAVAILABLE', 'REVIEW_LIMIT_REACHED', 'REVIEW_INVALID_RESPONSE'])('never retries %s', async reason => {
  const generate = jest.fn().mockRejectedValue(invalid(reason));
  await expect(generateWithRework({ config, generate, onAttempt: async () => {}, enabled: true })).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
});
test('cancellation prevents a second call', async () => {
  const controller = new AbortController();
  const generate = jest.fn(async () => { controller.abort(new Error('Stopped')); throw invalid('ANSWER_INVALID'); });
  await expect(generateWithRework({ config, generate, onAttempt: async () => {}, enabled: true, signal: controller.signal })).rejects.toThrow('Stopped');
  expect(generate).toHaveBeenCalledTimes(1);
});
test('feedback-only repair reuses the exact draft and approved prompt, with one recheck', async () => {
  const error = invalid('ARITHMETIC_FALSE_EQUALITY');
  error.repairDraft = { questionText: '12 kg at 30 degrees', correctAnswer: '101.8 N', content: { options: [{ text: '101.8 N', isCorrect: true }] } };
  const generate = jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ saved: true });
  const onRepair = jest.fn();
  await generateWithRework({ config, generate, onAttempt: async () => {}, onRepair, enabled: true });
  expect(onRepair).toHaveBeenCalledWith('feedback');
  expect(generate.mock.calls[1][0]).toMatchObject({ customPrompt: config.customPrompt, repairDraft: error.repairDraft,
    repairObservation: { reason: 'ARITHMETIC_FALSE_EQUALITY', calculationCheck: error.rejectedDraft.calculationCheck } });
});
test.each([['ANSWER_INVALID', 'answer'], ['INSTRUCTION_MISMATCH', 'instructions']])('%s requests a full redraft with its own strategy', async (reason, strategy) => {
  const error = invalid(reason); error.repairDraft = { questionText: 'Old' };
  const generate = jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ saved: true });
  const onRepair = jest.fn();
  await generateWithRework({ config, generate, onAttempt: async () => {}, onRepair, enabled: true });
  expect(onRepair).toHaveBeenCalledWith(strategy);
  expect(generate.mock.calls[1][0].repairDraft).toBeUndefined();
});
test.each([['QUESTION_DUPLICATE_DETECTED', 'novelty'], ['QUESTION_PLANNED_SLICE_MISMATCH', 'slice']])('%s receives bounded targeted repair context', async (code, strategy) => {
  const error = Object.assign(new Error('Rejected draft'), { code, repairContext: { similarStem: 'Compare opposing forces', slice: 'Net force reasoning' } });
  const generate = jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ saved: true });
  const onRepair = jest.fn();
  await generateWithRework({ config, generate, onAttempt: async () => {}, onRepair, enabled: true });
  expect(onRepair).toHaveBeenCalledWith(strategy);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1][0]).toMatchObject({ instructorPrompt: config.customPrompt });
  expect(generate.mock.calls[1][0].customPrompt).toContain('Net force reasoning');
});
test('evidence failure stops without a real refresh callback', async () => {
  const error = invalid('EVIDENCE_INSUFFICIENT'); const generate = jest.fn().mockRejectedValue(error);
  await expect(generateWithRework({ config, generate, onAttempt: async () => {}, enabled: true })).rejects.toBe(error);
  expect(generate).toHaveBeenCalledTimes(1);
});
test('a failed evidence refresh never counts or purchases another draft', async () => {
  const generate = jest.fn().mockRejectedValue(invalid('EVIDENCE_INSUFFICIENT'));
  const onAttempt = jest.fn();
  const prepareRepair = jest.fn().mockRejectedValue(Object.assign(new Error('Index unavailable'), { code: 'MATERIAL_INDEX_MISSING' }));
  await expect(generateWithRework({ config, generate, onAttempt, prepareRepair, enabled: true })).rejects.toMatchObject({ code: 'MATERIAL_INDEX_MISSING' });
  expect(generate).toHaveBeenCalledTimes(1); expect(onAttempt.mock.calls).toEqual([[1]]);
});
test('evidence refresh completes before the second draft and preserves its scope', async () => {
  const sequence = [];
  const generate = jest.fn(async request => { sequence.push('draft'); if (sequence.length === 1) throw invalid('EVIDENCE_INSUFFICIENT'); return request; });
  const prepareRepair = jest.fn(async ({ strategy }) => { expect(strategy).toBe('evidence'); sequence.push('source refresh'); });
  const result = await generateWithRework({ config, generate, onAttempt: async () => {}, prepareRepair, enabled: true });
  expect(sequence).toEqual(['draft', 'source refresh', 'draft']);
  expect(result.instructorPrompt).toBe(config.customPrompt);
  expect(result.customPrompt).toContain('New hypothetical examples');
});
