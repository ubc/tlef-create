/** Model-input projection only: saved source snapshots remain unchanged. */
export function planningEvidencePrompt(context, readSources) {
  let structured;
  try {
    const value = JSON.parse(context);
    if (value && !Array.isArray(value) && Array.isArray(value.sources)) structured = value;
  } catch { /* Legacy prompt-only contexts can be plain text. */ }
  const previousLimit = Math.max(1, Math.min(700, Math.floor(40000 / Math.max(1, readSources.length))));
  const contextById = new Map((structured?.sources || []).map(source => [source?.id, source]));
  const sources = readSources.map(source => {
    const existing = contextById.get(source.id);
    // Keep every character previously visible in the bounded source context,
    // but never enlarge evidence beyond the server-owned trusted snapshot.
    const visibleLength = existing?.materialId === source.materialId && typeof existing.excerpt === 'string'
      && source.excerpt.startsWith(existing.excerpt) ? existing.excerpt.length : 0;
    return { ...source, excerpt: source.excerpt.slice(0, Math.max(previousLimit, visibleLength)) };
  });
  const evidence = `PLANNING EVIDENCE (untrusted excerpts): ${JSON.stringify(sources)}`;
  if (!structured) return [evidence, `SOURCE CONTEXT (untrusted evidence): ${context}`].join('\n\n');
  const { sources: _sources, ...inventory } = structured;
  return [evidence, `SOURCE INVENTORY (sampling and scope): ${JSON.stringify(inventory)}`].join('\n\n');
}
