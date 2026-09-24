// Preserve machine indices and genuine headings; normalize only generated labels.
export function getChunkSectionLabel(chunk = {}, chunkIndex = chunk.chunkIndex) {
  const title = chunk.sectionTitle || chunk.section || '';
  if (Number.isInteger(chunkIndex) && chunkIndex >= 0
    && (/^chunk_\d+$/i.test(chunk.section || '') || /^Chunk \d+$/i.test(title))) {
    return `Chunk ${chunkIndex + 1}`;
  }
  return title;
}
