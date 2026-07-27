import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/api';
import { getBlueprintGenerationError } from './blueprintErrorPresentation';

describe('Blueprint error presentation', () => {
  it('preserves actionable backend messages and assigns a specific title', () => {
    expect(getBlueprintGenerationError(new ApiError(
      'The AI response ended before the Blueprint was complete. Please retry.',
      502,
      'AI_OUTPUT_INCOMPLETE'
    ))).toEqual({
      title: 'Incomplete AI Response',
      message: 'The AI response ended before the Blueprint was complete. Please retry.'
    });
  });

  it('keeps unknown failures recoverable', () => {
    expect(getBlueprintGenerationError(new Error('Network disconnected'))).toEqual({
      title: 'Blueprint Generation Failed',
      message: 'Network disconnected'
    });
  });
});
