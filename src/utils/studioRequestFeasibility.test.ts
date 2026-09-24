import { describe, expect, it } from 'vitest';
import { studioRequestFeasibility } from './studioRequestFeasibility';

describe('Studio request feasibility', () => {
  it('does not mistake an explicit exclusion for a multiple-choice request', () => {
    expect(studioRequestFeasibility('H5P.DocumentationTool 1.8',
      'Use written responses and export them to Word. Do not include multiple-choice questions.')).toBe('');
    expect(studioRequestFeasibility('H5P.DocumentationTool 1.8',
      'Add four multiple-choice questions, then export answers to Word.')).toContain('cannot contain multiple-choice');
  });
});
