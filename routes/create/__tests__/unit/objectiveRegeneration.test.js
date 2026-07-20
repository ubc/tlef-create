import { afterEach, describe, expect, jest, test } from '@jest/globals';
import llmService from '../../services/llmService.js';

describe('single learning-objective regeneration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses the unified completion path and a reasoning-safe GPT-5 output budget', async () => {
    const completion = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({
      content: '"Students will be able to analyze force diagrams."',
      model: 'gpt-5.1'
    });
    const llmConfig = {
      provider: 'openai',
      model: 'gpt-5.1',
      apiKey: 'test-key',
      endpoint: 'https://api.openai.com/v1'
    };

    const result = await llmService.regenerateSingleObjective(
      'Students will understand forces.',
      [{ name: 'Mechanics', type: 'pdf', content: 'Free-body diagrams and force vectors.' }],
      'Quiz: Mechanics',
      null,
      'Focus on analysis.',
      llmConfig
    );

    expect(result).toBe('Students will be able to analyze force diagrams.');
    expect(completion).toHaveBeenCalledWith(expect.objectContaining({
      llmConfig,
      maxTokens: 1200,
      temperature: 0.6
    }));
  });

  test('rejects an empty model response instead of saving an empty objective', async () => {
    jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: '   ', model: 'gpt-4o-mini' });

    await expect(llmService.regenerateSingleObjective(
      'Students will understand forces.',
      [{ name: 'Mechanics', type: 'pdf', content: 'Force vectors.' }],
      '',
      null,
      null,
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test-key', endpoint: 'https://api.openai.com/v1' }
    )).rejects.toThrow('No valid learning objective found');
  });
});
