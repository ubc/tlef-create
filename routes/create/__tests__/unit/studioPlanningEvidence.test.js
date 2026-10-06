import { describe, expect, test } from '@jest/globals';
import { planningEvidencePrompt } from '../../services/studioPlanningEvidence.js';

describe('planning evidence input projection', () => {
  test('sends each source once while retaining late evidence and sampling provenance', () => {
    const sources = Array.from({ length: 32 }, (_, index) => ({ id: `src-${index}`, materialId: 'm1',
      chunkIndex: index, pageNumber: index + 1, excerpt: `UNIQUE-${index} ` + 'a'.repeat(750) + ` LATE-FACT-${index}` }));
    const context = JSON.stringify({ inventory: [{ materialId: 'm1', readableChunks: 80 }], totalChunks: 80,
      notice: 'Bounded sample, not exhaustive.', sampled: true, sources });
    const before = structuredClone(sources);
    const projected = planningEvidencePrompt(context, sources);
    for (const source of sources) {
      expect(projected.split(source.excerpt)).toHaveLength(2);
      expect(projected).toContain(`LATE-FACT-${source.chunkIndex}`);
    }
    expect(projected).toContain('"sampled":true');
    expect(projected).toContain('"totalChunks":80');
    expect(projected).toContain('Bounded sample, not exhaustive.');
    expect(projected).toContain('"pageNumber":32');
    expect(sources).toEqual(before);
    expect(projected.length).toBeLessThan(context.length + 300);
  });

  test('does not import a conflicting or foreign context source into the trusted evidence table', () => {
    const source = { id: 'src-owned', materialId: 'm1', excerpt: 'Owned evidence.' };
    const context = JSON.stringify({ sampled: true, sources: [
      { ...source, excerpt: 'UNTRUSTED REPLACEMENT' },
      { id: 'foreign', materialId: 'other', excerpt: 'FOREIGN EVIDENCE' }
    ] });
    const result = planningEvidencePrompt(context, [source]);
    expect(result).toContain('Owned evidence.');
    expect(result).not.toContain('UNTRUSTED REPLACEMENT');
    expect(result).not.toContain('FOREIGN EVIDENCE');
  });

  test('retains legacy text and bounded saved-objective evidence absent from a structured context', () => {
    const source = { id: 'src-objective', materialId: 'm1', excerpt: 'e'.repeat(2000) };
    expect(planningEvidencePrompt('A prompt-only teaching brief.', [source])).toContain('A prompt-only teaching brief.');
    const projected = planningEvidencePrompt(JSON.stringify({ sources: [], sampled: true }), [source]);
    expect(projected).toContain('e'.repeat(700));
    expect(projected).not.toContain('e'.repeat(701));
  });
});
