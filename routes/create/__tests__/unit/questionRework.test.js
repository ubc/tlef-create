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
test.each(['REVIEW_UNAVAILABLE', 'REVIEW_LIMIT_REACHED'])('never retries %s', async reason => {
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
