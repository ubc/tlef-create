import { afterEach, describe, expect, jest, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import { assessAuthoringRequirements, buildRequirementsPrompt, effectiveTeachingBrief } from '../../services/authoring/authoringRequirements.js';

const request = { userId: 'test-owner', instructions: 'Help create quizzes from this material.',
  materials: [{ name: 'Synthetic motion notes', type: 'text', content: 'PRIVATE full course source' }] };
afterEach(() => jest.restoreAllMocks());
describe('requirements before planning', () => {
  test('rejects missing identity and an already stopped task before any model call', async () => {
    const complete = jest.spyOn(llmService, 'streamCompletion');
    await expect(assessAuthoringRequirements({ ...request, userId: null })).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    const controller = new AbortController(); controller.abort();
    await expect(assessAuthoringRequirements({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).not.toHaveBeenCalled();
  });
  test('preserves the original brief and explicit later answers separately from material labels', () => {
    const brief = effectiveTeachingBrief({ instructions: 'Make a physics activity.', requirementAnswers: [{ requestId: 'one', text: 'Exactly two easy MCQs.' }] });
    expect(brief).toContain('Make a physics activity.');
    expect(brief).toContain('Exactly two easy MCQs.');
    expect(brief).toContain('later answers supersede conflicting earlier requirements');
    const prompt = buildRequirementsPrompt({ ...request, instructions: brief });
    expect(prompt).toContain('Synthetic motion notes');
    expect(prompt).not.toContain('PRIVATE');
    expect(prompt).toContain('Do not generate objectives');
  });
  test('refuses an oversized combined brief rather than dropping instructor constraints', () => {
    expect(() => effectiveTeachingBrief({ instructions: 'x'.repeat(12000), requirementAnswers: [{ text: 'One question.' }] }))
      .toThrow(expect.objectContaining({ code: 'AUTHORING_INPUT' }));
  });
  test.each([
    { ready: false, reply: 'Choose a question count.', clarification: [{ question: 'Count?', options: ['One', 'Three'] }] },
    { ready: true, reply: 'Your brief is clear.', clarification: [] }
  ])('admits a coherent requirements assessment: %j', async result => {
    const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: JSON.stringify(result) });
    expect(await assessAuthoringRequirements(request)).toEqual(result);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({ jsonMode: true, maxTokens: 1800, userId: 'test-owner' });
  });
  test.each([
    { ready: false, reply: 'Choose.', clarification: [] },
    { ready: true, reply: 'Clear.', clarification: [{ question: 'Count?', options: ['One', 'Three'] }] },
    { reply: 'Clear.' }
  ])('rejects inconsistent assessments without starting another model call: %j', async result => {
    const complete = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: JSON.stringify(result) });
    await expect(assessAuthoringRequirements(request)).rejects.toMatchObject({ code: 'AUTHORING_RESPONSE' });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
