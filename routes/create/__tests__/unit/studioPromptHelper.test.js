import { describe, expect, jest, test } from '@jest/globals';
import { suggestStudioPrompt } from '../../services/studioPromptHelper.js';

const base = {
  kind: 'collection', layout: 'column', activityType: '', selectedQuestionTypes: ['multiple-choice'],
  evidenceSelected: true, courseContext: JSON.stringify({ objectives: ['Explain net force'], materials: [{ name: 'week3.pdf', ready: true }] }),
  userId: 'teacher'
};

describe('Studio prompt helper', () => {
  test('uses conversation and verified form context when the instructor directly requests a prompt', async () => {
    const complete = jest.fn().mockResolvedValue({ content: JSON.stringify({
      reply: 'Here is a prompt.', nextStep: 'draft', draft: 'Create a multiple-choice question about net force using the selected course evidence.'
    }) });
    const messages = [{ role: 'user', content: 'Help me teach forces' }, { role: 'assistant', content: 'Which topic?' },
      { role: 'user', content: 'Write a prompt about net force' }];
    const result = await suggestStudioPrompt({ ...base, currentInstructions: 'D', messages, complete });
    expect(result.draft).toContain('net force');
    expect(result.nextStep).toBe('draft');
    const prompt = complete.mock.calls[0][0].prompt;
    expect(prompt).toContain('Explain net force');
    expect(prompt).toContain('Write a prompt about net force');
    expect(prompt).toContain('CURRENT TEACHING INSTRUCTIONS (untrusted): "D"');
    expect(prompt).toContain('Never claim to have read a file');
  });

  test('a context question stays conversational and an offer contains no draft', async () => {
    const complete = jest.fn().mockResolvedValueOnce({ content: JSON.stringify({
      reply: 'I can see the selected layout and objectives, but I have not read your files.', nextStep: 'continue', draft: 'Unrequested prompt'
    }) }).mockResolvedValueOnce({ content: JSON.stringify({
      reply: 'I have enough context to help.', nextStep: 'offer', draft: 'Unrequested prompt'
    }) });
    const first = await suggestStudioPrompt({ ...base, messages: [{ role: 'user', content: 'Do you have context about current work?' }], complete });
    expect(first).toMatchObject({ nextStep: 'continue', draft: '' });
    const second = await suggestStudioPrompt({ ...base, messages: [{ role: 'user', content: 'First-year physics, focus on force.' }], complete });
    expect(second).toMatchObject({ nextStep: 'offer', draft: '' });
  });

  test('Yes generates from the current conversation without fabricating a new user message', async () => {
    const complete = jest.fn().mockResolvedValue({ content: JSON.stringify({
      reply: 'Here is your prompt.', nextStep: 'draft', draft: 'Create one first-year question about net force.'
    }) });
    const messages = [{ role: 'user', content: 'First-year students need practice with force.' },
      { role: 'assistant', content: 'I can turn this into a prompt.' }];
    const result = await suggestStudioPrompt({ ...base, messages, generateNow: true, complete });
    expect(result.nextStep).toBe('draft');
    expect(complete.mock.calls[0][0].prompt).toContain('GENERATE NOW: true');
  });

  test('rejects malformed or oversized conversation before calling the model', async () => {
    const complete = jest.fn();
    await expect(suggestStudioPrompt({ ...base, messages: [{ role: 'assistant', content: 'Start' }], complete }))
      .rejects.toMatchObject({ status: 400, code: 'H5P_AI_INPUT' });
    await expect(suggestStudioPrompt({ ...base, messages: [{ role: 'user', content: 'x'.repeat(1001) }], complete }))
      .rejects.toMatchObject({ status: 400, code: 'H5P_AI_INPUT' });
    expect(complete).not.toHaveBeenCalled();
  });
});
