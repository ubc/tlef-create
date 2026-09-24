import { getChunkSectionLabel } from './chunkLabels.js';

// The installed UBC provider writes flat payloads. Keep legacy nested payloads
// readable and removable without ever dropping the selected-material boundary.
export function qdrantMetadataFilter(field, values) {
  const ids = [...new Set(values.filter(value => value != null).map(String).filter(Boolean))];
  if (!ids.length) throw new Error('A non-empty vector metadata scope is required.');
  return { should: [
    { key: field, match: { any: ids } },
    { key: `metadata.${field}`, match: { any: ids } }
  ] };
}

export function readQdrantChunk(point) {
  const payload = point.payload || {};
  const metadata = { ...payload, ...(payload.metadata || {}) };
  delete metadata.content;
  delete metadata.metadata;
  // UBC 0.1.5 overwrites chunkIndex when it internally subdivides each chunk.
  // Preserve our outer source index explicitly; old generated section IDs also
  // provide that index. Neither path changes stored vector IDs or source text.
  const generatedSection = /^chunk_(\d+)$/.exec(metadata.section || '');
  const sourceIndex = Number.isInteger(metadata.sourceChunkIndex)
    ? metadata.sourceChunkIndex
    : generatedSection ? Number(generatedSection[1]) : metadata.chunkIndex;
  if (Number.isInteger(sourceIndex) && sourceIndex >= 0) metadata.chunkIndex = sourceIndex;
  metadata.sectionTitle = getChunkSectionLabel(metadata);
  return {
    content: payload.content || payload.pageContent || payload.metadata?.content || '',
    score: point.score,
    metadata
  };
}
