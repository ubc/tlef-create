import { describe, expect, it } from 'vitest';
import { sourceSectionLabel } from './sourceReferenceLabels';

describe('source reference display labels', () => {
  it('repairs legacy generated labels without changing the cited vector index', () => {
    const reference = { section: 'Chunk 0', chunkIndex: 4 };
    expect(sourceSectionLabel(reference)).toBe('Chunk 5');
    expect(reference.chunkIndex).toBe(4);
  });
  it('keeps actual instructional section names and unknown indices intact', () => {
    expect(sourceSectionLabel({ section: '2. Phase changes', chunkIndex: 0 })).toBe('2. Phase changes');
    expect(sourceSectionLabel({ section: 'Chunk 3: Evaluation', chunkIndex: 0 })).toBe('Chunk 3: Evaluation');
    expect(sourceSectionLabel({ section: 'Chunk 7' })).toBe('Chunk 7');
  });
});
