import crypto from 'node:crypto';

const id = value => String(value?._id || value || '');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = message => { throw Object.assign(new Error(message), { code: 'AUTHORING_RESPONSE', status: 422 }); };
const ids = value => {
  if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== 'string' || !/^[a-f\d]{24}$/i.test(item))
    || new Set(value).size !== value.length) invalid('Objective changes must identify distinct objectives in this saved version.');
  return [...value];
};
const authorizes = (quote, latestRequest, verb) => {
  const match = quote.match(verb);
  if (!match) return false;
  const before = latestRequest.slice(Math.max(0, latestRequest.indexOf(quote) - 100), latestRequest.indexOf(quote)) + quote.slice(0, match.index);
  const clause = before.split(/[.!?。！？;\n]/).at(-1) || '';
  return !/\b(?:do not|don't|never|without|avoid|not)\b(?:\s+\w+){0,5}\s*$|(?:不要|不用|别|避免)\s*$/i.test(clause)
    && !/\b(?:discuss|consider|brainstorm|explore|whether|what if|should we|should i)\b|讨论|考虑|是否|要不要/i.test(clause);
};

/** Only current human input can authorize changes to objective membership.
 * Instructor materials and model-written descriptions never supply authority.
 */
export function normalizeObjectiveChanges(changes, latestRequest) {
  if (changes == null) return undefined;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)
    || typeof changes.authorizationQuote !== 'string' || !changes.authorizationQuote.trim()
    || changes.authorizationQuote.length > 1000 || typeof latestRequest !== 'string'
    || !latestRequest.includes(changes.authorizationQuote)) invalid('Objective changes need an exact authorization quote from the latest instructor message.');
  const quote = changes.authorizationQuote;
  const merges = changes.merges ?? [];
  if (!Array.isArray(merges) || merges.length > 10) invalid('Use a bounded set of objective merge groups.');
  const excluded = ids(changes.excludeObjectiveIds ?? []);
  const updates = changes.updates ?? [];
  if (!Array.isArray(updates) || updates.length > 20) invalid('Use a bounded set of objective text updates.');
  if (!merges.length && !excluded.length && !updates.length) invalid('Specify an objective update, merge or exclusion.');
  if (updates.length && !authorizes(quote, latestRequest, /\b(?:update|revise|edit|change|rewrite|replace)\b[^.!?\n]{0,60}\b(?:learning objectives?|learning goals?)\b|(?:修改|更新|调整|重写)(?:[^。！？\n]{0,20})(?:学习目标|教学目标)/i)) {
    invalid('The latest quoted instruction must explicitly authorize updating learning objectives.');
  }
  if (merges.length && !authorizes(quote, latestRequest, /\b(?:merge|combine|consolidate)\b|合并|整合/i)) {
    invalid('The latest quoted instruction must explicitly authorize merging learning objectives.');
  }
  if (excluded.length && !authorizes(quote, latestRequest, /\b(?:exclude|remove|omit|drop|skip)\b|排除|删除|移除|略过/i)) {
    invalid('The latest quoted instruction must explicitly authorize excluding learning objectives.');
  }
  const used = new Set(excluded);
  const normalized = merges.map(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) invalid('Each objective merge needs its source objectives and a new objective text.');
    const objectiveIds = ids(group.objectiveIds);
    if (objectiveIds.length < 2 || typeof group.text !== 'string' || !group.text.trim() || group.text.trim().length > 500) {
      invalid('Merge at least two objectives into a nonempty objective of at most 500 characters.');
    }
    for (const objectiveId of objectiveIds) {
      if (used.has(objectiveId)) invalid('Merge groups and exclusions must be disjoint.');
      used.add(objectiveId);
    }
    return { objectiveIds, text: group.text.trim() };
  });
  const normalizedUpdates = updates.map(update => {
    if (!update || typeof update !== 'object' || Array.isArray(update)) invalid('Each objective update needs its current ID and a new objective text.');
    const [objectiveId] = ids([update.objectiveId]);
    if (used.has(objectiveId)) invalid('Objective updates, merge groups and exclusions must be disjoint.');
    if (typeof update.text !== 'string' || !update.text.trim() || update.text.trim().length > 500) invalid('Updated objective text must contain 1–500 characters.');
    used.add(objectiveId);
    return { objectiveId, text: update.text.trim() };
  });
  return { authorizationQuote: quote, merges: normalized, excludeObjectiveIds: excluded, updates: normalizedUpdates };
}

const unique = values => [...new Map(values.map(value => [hash(value), value])).values()];
const rowKey = row => hash({ learningObjective: id(row.learningObjective), type: row.type, difficulty: row.difficulty,
  selectionMode: row.selectionMode, branchingLayers: row.branchingLayers, branchingChoices: row.branchingChoices,
  pedagogicalIntent: row.pedagogicalIntent, bloomLevel: row.bloomLevel, useCustomPromptOnly: row.useCustomPromptOnly });

/** Return a candidate only. Source snapshots and published records stay intact. */
export function reviseCourseObjectives({ snapshot, changes, latestRequest, requestId, baseVersionId, owner }) {
  const normalized = normalizeObjectiveChanges(changes, latestRequest);
  const candidate = copy(snapshot);
  if (!normalized) return { snapshot: candidate, affectedQuestionIndices: [], excludedQuestionIndices: [], changes: [] };
  const objectives = candidate.learningObjectives || [];
  const membership = new Map(objectives.map(objective => [id(objective), objective]));
  for (const objectiveId of [...normalized.excludeObjectiveIds, ...normalized.merges.flatMap(group => group.objectiveIds), ...normalized.updates.map(update => update.objectiveId)]) {
    if (!membership.has(objectiveId)) invalid('An objective change refers to an objective outside the current saved version.');
  }
  const excluded = new Set(normalized.excludeObjectiveIds);
  const remap = new Map(); const replacements = new Map();
  const edited = new Set();
  for (const update of normalized.updates) {
    const source = membership.get(update.objectiveId);
    if (source.text === update.text) continue;
    const metadata = { ...(source.generationMetadata || {}), objectiveRevision: {
      kind: 'edit', sourceObjectiveIds: source.generationMetadata?.objectiveRevision?.sourceObjectiveIds || [update.objectiveId],
      sourceGoals: source.generationMetadata?.objectiveRevision?.sourceGoals?.length
        ? source.generationMetadata.objectiveRevision.sourceGoals : [{ id: update.objectiveId, text: source.text }],
      authorizationQuote: normalized.authorizationQuote, requestId, baseVersionId: String(baseVersionId), revisedAt: new Date().toISOString()
    } };
    delete metadata.coverageDiagnostics; delete metadata.enrichmentDiagnostics;
    replacements.set(update.objectiveId, { ...source, text: update.text, generationMetadata: metadata,
      editHistory: [...(source.editHistory || []), { editedBy: String(owner), editedAt: new Date().toISOString(),
        changes: 'Updated learning objective text on explicit instructor request.', previousText: source.text }] });
    edited.add(update.objectiveId);
  }
  for (const group of normalized.merges) {
    const sources = group.objectiveIds.map(objectiveId => membership.get(objectiveId));
    const sourceIds = [...group.objectiveIds].sort();
    const mergedId = hash({ baseVersionId: String(baseVersionId), requestId, sourceIds }).slice(0, 24);
    const first = sources[0];
    const metadata = { ...(first.generationMetadata || {}),
      sourceReferences: unique(sources.flatMap(source => source.generationMetadata?.sourceReferences || [])),
      sourceSectionIds: unique(sources.flatMap(source => source.generationMetadata?.sourceSectionIds || [])),
      subpoints: unique(sources.flatMap(source => [source.text, ...(source.subpoints || []), ...(source.generationMetadata?.subpoints || [])]).filter(Boolean)),
      instructorAuthoredFields: unique([...sources.flatMap(source => source.generationMetadata?.instructorAuthoredFields || []), 'subpoints']),
      objectiveRevision: { kind: 'merge', sourceObjectiveIds: sourceIds,
        sourceGoals: unique(sources.flatMap(source => source.generationMetadata?.objectiveRevision?.sourceGoals?.length
          ? source.generationMetadata.objectiveRevision.sourceGoals : [{ id: id(source), text: source.text }])),
        authorizationQuote: normalized.authorizationQuote,
        requestId, baseVersionId: String(baseVersionId), revisedAt: new Date().toISOString() } };
    delete metadata.coverageDiagnostics; delete metadata.enrichmentDiagnostics;
    const merged = { ...first, _id: mergedId, id: mergedId, text: group.text, generationMetadata: metadata,
      generatedFrom: unique(sources.flatMap(source => source.generatedFrom || [])),
      editHistory: [...(first.editHistory || []), { editedBy: String(owner), editedAt: new Date().toISOString(),
        changes: `Merged ${sources.length} existing learning objectives on explicit instructor request.`, previousText: sources.map(source => source.text).join('\n') }] };
    for (const objectiveId of group.objectiveIds) remap.set(objectiveId, mergedId);
    const firstInOrder = objectives.find(objective => group.objectiveIds.includes(id(objective)));
    replacements.set(id(firstInOrder), merged);
  }
  candidate.learningObjectives = objectives.flatMap(objective => replacements.has(id(objective)) ? [replacements.get(id(objective))]
    : excluded.has(id(objective)) || remap.has(id(objective)) ? [] : [objective]);
  if (!candidate.learningObjectives.length) invalid('Keep at least one learning objective, or start a new activity with a new teaching scope.');
  const affectedQuestionIndices = []; const excludedQuestionIndices = [];
  for (const [index, question] of (candidate.questions || []).entries()) {
    const old = id(question.learningObjective);
    if (excluded.has(old)) excludedQuestionIndices.push(index + 1);
    else if (remap.has(old) || edited.has(old)) { question.learningObjective = remap.get(old) || question.learningObjective; affectedQuestionIndices.push(index + 1); }
    if (question.generationMetadata?.supportingLearningObjectives) {
      if (!excluded.has(old) && question.generationMetadata.supportingLearningObjectives.some(reference => edited.has(id(reference)) || remap.has(id(reference)))) {
        if (!affectedQuestionIndices.includes(index + 1)) affectedQuestionIndices.push(index + 1);
      }
      question.generationMetadata.supportingLearningObjectives = unique(question.generationMetadata.supportingLearningObjectives
        .map(reference => remap.get(id(reference)) || id(reference)).filter(reference => !excluded.has(reference)));
    }
  }
  const rows = [];
  for (const original of candidate.settings?.planItems || []) {
    if (excluded.has(id(original.learningObjective))) continue;
    const row = { ...original, learningObjective: remap.get(id(original.learningObjective)) || original.learningObjective };
    const merged = candidate.learningObjectives.find(objective => id(objective) === id(row.learningObjective));
    if (merged?.generationMetadata?.objectiveRevision?.kind === 'merge' && merged.generationMetadata.objectiveRevision.requestId === requestId) {
      row.customPrompt = [row.customPrompt, `Cover every source learning goal in this merged objective: ${merged.generationMetadata.subpoints.join('; ')}`].filter(Boolean).join('\n');
    }
    const key = rowKey(row);
    const existing = normalized.merges.length ? rows.find(item => item.key === key) : undefined;
    if (existing) {
      existing.row.count += row.count;
      existing.row.customPrompt = [...new Set([existing.row.customPrompt, row.customPrompt].filter(Boolean))].join('\n');
      if (existing.row.questionTasks || row.questionTasks) existing.row.questionTasks = [...(existing.row.questionTasks || []), ...(row.questionTasks || [])];
    } else rows.push({ key, row });
  }
  if (rows.some(item => (item.row.customPrompt || '').length > 4000)) invalid('The merged objective plan exceeds its saved instruction limit. Merge fewer objectives or shorten the plan instructions.');
  candidate.settings = { ...(candidate.settings || {}), planItems: rows.map(item => item.row) };
  return { snapshot: candidate, affectedQuestionIndices, excludedQuestionIndices,
    changes: [normalized.merges.length ? `Merged ${normalized.merges.length} objective group${normalized.merges.length === 1 ? '' : 's'} while preserving every source goal and evidence reference.` : '',
      edited.size ? `Updated ${edited.size} learning objective${edited.size === 1 ? '' : 's'}; their affected questions require new checks in the proposed version.` : '',
      excluded.size ? `Excluded ${excluded.size} learning objective${excluded.size === 1 ? '' : 's'} and their questions on explicit instructor request.` : ''].filter(Boolean) };
}
