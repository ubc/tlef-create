import { describe, expect, test } from '@jest/globals';
import {
  referenceTextScore,
  resolveReferenceChunk
} from '../../utils/referenceResolver.js';

const chunks = [
  { pageNumber: 1, content: 'Introduction to force, mass, and acceleration.' },
  { pageNumber: 2, content: 'Draw a free-body diagram and include only forces acting on the selected object.' },
  { pageNumber: 3, content: 'Static friction has a maximum value while kinetic friction acts during sliding.' }
];

describe('source reference resolution', () => {
  test('uses the stored excerpt instead of a stale chunk index', () => {
    const result = resolveReferenceChunk(chunks, {
      chunkIndex: 0,
      pageNumber: 1,
      excerpt: 'include only forces acting on the selected object'
    });

    expect(result.citedIndex).toBe(1);
    expect(result.resolvedBy).toBe('exact-excerpt');
  });

  test('recovers the correct page when the historical page number is wrong', () => {
    const result = resolveReferenceChunk(chunks, {
      pageNumber: 1,
      excerpt: 'Static friction has a maximum value while kinetic friction acts during sliding.'
    });

    expect(result.citedIndex).toBe(2);
    expect(result.resolvedBy).toBe('exact-excerpt');
  });

  test('falls back to page number when no excerpt is available', () => {
    expect(resolveReferenceChunk(chunks, { pageNumber: 2 }).citedIndex).toBe(1);
  });

  test('matches normalized text despite punctuation differences', () => {
    expect(referenceTextScore(
      'Free body diagram: forces acting on the object',
      'A free-body diagram shows the forces acting on the selected object.'
    )).toBeGreaterThan(0.6);
  });
});
