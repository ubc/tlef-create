import { describe, expect, test } from '@jest/globals';
import {
  deriveSubpointsFromReferences,
  inferBloomLevelFromObjective,
  parseObjectiveEnrichmentResponse,
  scoreObjectiveSectionMatch
} from '../../services/llmService.js';

describe('objective enrichment response parsing', () => {
  test('extracts a complete JSON object from surrounding model text', () => {
    const result = parseObjectiveEnrichmentResponse(`Analysis complete.
      {"objectives":[{"objectiveId":"lo-1","subpoints":["Explain force vectors"]}]}
      End of response.`);

    expect(result).toHaveLength(1);
    expect(result[0].objectiveId).toBe('lo-1');
  });

  test('rejects truncated JSON so the source-grounded fallback can run', () => {
    expect(() => parseObjectiveEnrichmentResponse('{"objectives":[')).toThrow(
      'complete JSON value'
    );
  });
});

describe('deterministic objective enrichment fallback', () => {
  test('infers Bloom level from the instructor objective', () => {
    expect(inferBloomLevelFromObjective('Students will calculate net force.')).toBe('apply');
    expect(inferBloomLevelFromObjective('Students will compare two algorithms.')).toBe('analyze');
  });

  test('derives distinct subpoints from retrieved evidence', () => {
    const subpoints = deriveSubpointsFromReferences([
      {
        excerpt: 'Static friction prevents initial motion. Kinetic friction acts after sliding begins. Static friction prevents initial motion.'
      }
    ]);

    expect(subpoints).toEqual([
      'Static friction prevents initial motion.',
      'Kinetic friction acts after sliding begins.'
    ]);
  });

  test('prefers inventory sections that overlap the objective', () => {
    const objective = 'Students will calculate friction forces on an inclined plane.';
    const relevant = scoreObjectiveSectionMatch(objective, {
      title: 'Friction forces',
      content: 'Calculate static and kinetic friction on an inclined plane.',
      isMajor: true
    });
    const unrelated = scoreObjectiveSectionMatch(objective, {
      title: 'Course introduction',
      content: 'Welcome and grading policies.',
      isMajor: true
    });

    expect(relevant).toBeGreaterThan(unrelated);
  });
});
