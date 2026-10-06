import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { AuthoringMessage } from '../../models/StudioAuthoring.js';
import { parseDecision } from '../../services/authoring/authoringContracts.js';
import { buildAuthoringDecisionPrompt } from '../../services/authoring/authoringDecisionPrompt.js';
import { assessAuthoringRequirements, buildRequirementsPrompt } from '../../services/authoring/authoringRequirements.js';
import llmService from '../../services/llmService.js';

const choices = { question: 'Which topics should the activity cover?', options: ['Motion', 'Forces'] };
const parse = clarification => parseDecision({ action: 'reply', reply: 'Choose the teaching focus.', clarification: [clarification] }, 0).clarification[0];
afterEach(() => jest.restoreAllMocks());

describe('clarification input modes', () => {
  test.each(['Which topics should the activity cover?', '希望覆盖哪些主题？', 'Which scope should we cover?'])('defaults combinable legacy topic choices to multiple: %s', question => {
    expect(parse({ ...choices, question })).toMatchObject({ selectionMode: 'multiple' });
  });
  test('keeps historical quantity and mutually exclusive conflict choices single by default', () => {
    expect(parse({ ...choices, question: 'How many questions?' })).not.toHaveProperty('selectionMode');
    expect(parse({ ...choices, question: 'How many questions for this topic?' })).not.toHaveProperty('selectionMode');
    expect(parse({ ...choices, question: 'Which topic resolves the conflict?' })).not.toHaveProperty('selectionMode');
    expect(parse({ ...choices, options: ['All topics', 'Only motion'] })).not.toHaveProperty('selectionMode');
  });
  test('preserves an explicit single topic resolution and custom-input policy', () => {
    expect(parse({ ...choices, selectionMode: 'single', allowCustomInput: false }))
      .toMatchObject({ selectionMode: 'single', allowCustomInput: false });
    expect(parse({ question: 'Teaching focus?', options: ['Motion', 'Forces'], selectionMode: 'multiple', allowCustomInput: true }))
      .toMatchObject({ selectionMode: 'multiple', allowCustomInput: true });
  });
  test.each([{ selectionMode: 'many' }, { selectionMode: true }, { allowCustomInput: 'true' }, { allowCustomInput: 1 }])('rejects invalid input controls before saving: %j', controls => {
    expect(() => parse({ ...choices, ...controls })).toThrow(expect.objectContaining({ code: 'AUTHORING_RESPONSE' }));
  });
  test('persists explicit controls without manufacturing a mode for old quantity cards', () => {
    const message = new AuthoringMessage({ owner: 'aaaaaaaaaaaaaaaaaaaaaaaa', sessionId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      key: 'clarification', role: 'assistant', text: 'Choose the teaching focus.',
      clarification: [parse({ ...choices, allowCustomInput: true }), { question: 'Count?', options: ['One', 'Three'] }] });
    expect(message.validateSync()).toBeUndefined();
    expect(message.toObject().clarification[0]).toEqual({ ...choices, selectionMode: 'multiple', allowCustomInput: true });
    expect(message.toObject().clarification[1]).not.toHaveProperty('selectionMode');
  });
  test('carries multiple/custom controls from a real requirements assessment into the saved-message contract', async () => {
    const result = { ready: false, reply: 'Choose the teaching focus.', clarification: [{ ...choices, selectionMode: 'multiple', allowCustomInput: true }] };
    jest.spyOn(llmService, 'streamCompletion').mockResolvedValue({ content: JSON.stringify(result) });
    expect(await assessAuthoringRequirements({ instructions: 'Explore a physics activity.', materials: [], userId: 'instructor' })).toEqual(result);
  });
  test.each([
    () => buildAuthoringDecisionPrompt({ latestRequest: 'Explore physics topics.', initial: true }),
    () => buildAuthoringDecisionPrompt({ latestRequest: 'Choose topics for the revision.' }),
    () => buildRequirementsPrompt({ instructions: 'Explore physics topics.', materials: [] })
  ])('instructs every decision path to distinguish combinable topics from conflicting alternatives', prompt => {
    const instruction = prompt();
    expect(instruction).toContain('selectionMode:"multiple" for combinable topic');
    expect(instruction).toContain('selectionMode:"single" for mutually exclusive decisions');
    expect(instruction).toContain('Set allowCustomInput:true');
    expect(instruction).toContain('Do not add Other');
  });
});
