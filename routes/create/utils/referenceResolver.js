const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is',
  'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with'
]);

export function normalizeReferenceText(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulTokens(value = '') {
  return normalizeReferenceText(value)
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token));
}

export function referenceTextScore(excerpt = '', content = '') {
  const normalizedExcerpt = normalizeReferenceText(excerpt);
  const normalizedContent = normalizeReferenceText(content);

  if (!normalizedExcerpt || !normalizedContent) return 0;
  if (normalizedContent.includes(normalizedExcerpt)) return 1;

  const excerptTokens = meaningfulTokens(normalizedExcerpt);
  if (excerptTokens.length === 0) return 0;

  const contentTokens = new Set(meaningfulTokens(normalizedContent));
  const matchedTokens = excerptTokens.filter(token => contentTokens.has(token));
  const uniqueMatches = new Set(matchedTokens).size;
  const uniqueExcerptTokens = new Set(excerptTokens).size;

  return uniqueExcerptTokens > 0 ? uniqueMatches / uniqueExcerptTokens : 0;
}

export function resolveReferenceChunk(chunks = [], reference = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { citedIndex: -1, matchScore: 0, resolvedBy: 'unavailable' };
  }

  const requestedChunkIndex = Number.parseInt(reference.chunkIndex, 10);
  const requestedPageNumber = Number.parseInt(reference.pageNumber, 10);
  const excerpt = reference.excerpt || '';
  const section = normalizeReferenceText(reference.section || '');

  if (excerpt) {
    const ranked = chunks.map((chunk, index) => {
      const textScore = referenceTextScore(excerpt, chunk.content || '');
      const pageMatches = Number.isInteger(requestedPageNumber)
        && Number(chunk.pageNumber) === requestedPageNumber;
      const indexMatches = Number.isInteger(requestedChunkIndex) && index === requestedChunkIndex;
      const sectionMatches = section
        && normalizeReferenceText(chunk.sectionTitle || chunk.section || '').includes(section);
      const score = Math.min(
        1,
        (textScore * 0.84)
          + (pageMatches ? 0.1 : 0)
          + (sectionMatches ? 0.04 : 0)
          + (indexMatches ? 0.02 : 0)
      );

      return { index, score, textScore };
    }).sort((a, b) => b.score - a.score);

    if (ranked[0]?.textScore >= 0.18) {
      return {
        citedIndex: ranked[0].index,
        matchScore: ranked[0].score,
        resolvedBy: ranked[0].textScore === 1 ? 'exact-excerpt' : 'excerpt-similarity'
      };
    }
  }

  if (Number.isInteger(requestedPageNumber)) {
    const pageIndex = chunks.findIndex(chunk => Number(chunk.pageNumber) === requestedPageNumber);
    if (pageIndex >= 0) {
      return { citedIndex: pageIndex, matchScore: 0, resolvedBy: 'page-number' };
    }
  }

  if (Number.isInteger(requestedChunkIndex) && requestedChunkIndex >= 0 && requestedChunkIndex < chunks.length) {
    return { citedIndex: requestedChunkIndex, matchScore: 0, resolvedBy: 'chunk-index' };
  }

  return { citedIndex: 0, matchScore: 0, resolvedBy: 'first-chunk-fallback' };
}
