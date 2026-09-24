import type { SourceReference } from '../services/api';

/** Keep stored vector indices zero based while presenting generated labels from one. */
export function sourceSectionLabel(reference: Pick<SourceReference, 'section' | 'chunkIndex'>): string | undefined {
  if (/^Chunk \d+$/i.test(reference.section?.trim() || '')
    && Number.isInteger(reference.chunkIndex) && reference.chunkIndex! >= 0) {
    return `Chunk ${reference.chunkIndex! + 1}`;
  }
  return reference.section;
}
