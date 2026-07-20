import { describe, expect, test } from '@jest/globals';
import { GENERAL_SYSTEM_PROMPTS } from '../../services/coursePromptDefaults.js';

describe('course prompt task responsibilities', () => {
  test('keeps blueprint planning separate from question writing', () => {
    const blueprint = GENERAL_SYSTEM_PROMPTS['quiz-blueprint'];
    const generation = GENERAL_SYSTEM_PROMPTS['question-generation'];

    expect(blueprint).toContain('QUIZ BLUEPRINT PLANNING');
    expect(blueprint).toContain('Do not draft question stems');
    expect(generation).toContain('QUESTION CONTENT GENERATION');
    expect(generation).toContain('Write the individual question');
    expect(blueprint).not.toBe(generation);
  });
});
