export type TraceStep = {
  status: string;
  message: string;
  metadata?: Record<string, unknown>;
};

const PUBLIC_STEP_DETAILS: Record<string, string> = {
  started: 'Loading the prompt strategy, model settings, and generation context.',
  'inventory-started': 'Scanning processed material chunks and preserving their source locations for evidence links.',
  'inventory-complete': 'The source inventory is ready for instructional analysis.',
  'inventory-fallback': 'Continuing with the cached material text because a structured inventory was unavailable.',
  'profile-started': 'Combining related source sections into teachable topic and skill clusters.',
  'profile-complete': 'The instructional clusters are ready for objective planning.',
  'digest-started': 'Removing document noise and identifying teachable topics, skills, and likely objective coverage.',
  'digest-complete': 'The cleaned instructional digest is ready.',
  'digest-fallback': 'Continuing with the source inventory because a structured digest was unavailable.',
  'budget-complete': 'A deterministic question budget has been allocated across the learning objectives.',
  'context-complete': 'Learning objectives, assigned materials, and existing question history are ready for the model.',
  'draft-started': 'The model is now drafting the learning-objective JSON from the prepared context.',
  'llm-started': 'The model is now drafting the quiz blueprint from the prepared context.',
  'draft-complete': 'The model draft has returned and is being checked against the source inventory.',
  'llm-complete': 'The model draft has returned and is being validated.',
  'repair-started': 'A targeted repair pass is adding coverage for source sections missed by the first draft.',
  'coverage-complete': 'Coverage checks have finished.',
  'parse-complete': 'The returned JSON is valid and ready for domain validation.',
  'count-sanitized': 'Invalid zero-count rows were removed before budget alignment.',
  'budget-aligned': 'Blueprint rows now match the fixed question budget and objective subpoints.',
  saved: 'The generated result has been saved to this learning object.',
  complete: 'The generation workflow has finished.'
};

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Format only explicitly allowlisted aggregate metadata. SSE metadata can grow
 * over time, so never dump the object into an instructor-facing generation log.
 */
export function formatPublicTraceMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return '';

  const details: string[] = [];
  const sections = finiteNumber(metadata.sections);
  const majorSections = finiteNumber(metadata.majorSections);
  const chunks = finiteNumber(metadata.chunks);
  const clusters = finiteNumber(metadata.clusters);
  const topics = finiteNumber(metadata.topics);
  const recommendedObjectiveCount = finiteNumber(metadata.recommendedObjectiveCount);
  const total = finiteNumber(metadata.total);
  const allocations = finiteNumber(metadata.allocations);
  const learningObjectives = finiteNumber(metadata.learningObjectives);
  const existingQuestions = finiteNumber(metadata.existingQuestions);
  const discardedRows = finiteNumber(metadata.discardedRows);
  const requiredSections = finiteNumber(metadata.requiredSections);
  const coveredSections = finiteNumber(metadata.coveredSections);
  const missingSectionCount = Array.isArray(metadata.missingSectionIds)
    ? metadata.missingSectionIds.length
    : null;

  if (sections !== null) details.push(`${sections} source section${sections === 1 ? '' : 's'}`);
  if (majorSections !== null) details.push(`${majorSections} major section${majorSections === 1 ? '' : 's'}`);
  if (chunks !== null) details.push(`${chunks} content chunk${chunks === 1 ? '' : 's'}`);
  if (clusters !== null) details.push(`${clusters} instructional cluster${clusters === 1 ? '' : 's'}`);
  if (topics !== null) details.push(`${topics} teachable topic${topics === 1 ? '' : 's'}`);
  if (recommendedObjectiveCount !== null) details.push(`${recommendedObjectiveCount} objectives recommended`);
  if (total !== null) details.push(`${total} questions planned`);
  if (allocations !== null) details.push(`${allocations} objective allocation${allocations === 1 ? '' : 's'}`);
  if (learningObjectives !== null) details.push(`${learningObjectives} learning objective${learningObjectives === 1 ? '' : 's'}`);
  if (existingQuestions !== null) details.push(`${existingQuestions} existing question${existingQuestions === 1 ? '' : 's'}`);
  if (discardedRows !== null) details.push(`${discardedRows} invalid row${discardedRows === 1 ? '' : 's'} removed`);
  if (requiredSections !== null && coveredSections !== null) {
    details.push(`${coveredSections}/${requiredSections} required sections covered`);
  }
  if (missingSectionCount !== null) {
    details.push(`${missingSectionCount} missing section${missingSectionCount === 1 ? '' : 's'} queued for repair`);
  }
  if (typeof metadata.materialQuality === 'string' && metadata.materialQuality.trim()) {
    details.push(`material quality: ${metadata.materialQuality.trim()}`);
  }
  if (typeof metadata.method === 'string' && metadata.method.trim()) {
    details.push(`budget method: ${metadata.method.trim()}`);
  }
  if (typeof metadata.modelAssisted === 'boolean') {
    details.push(metadata.modelAssisted ? 'model-assisted clustering' : 'structure-based clustering');
  }
  if (typeof metadata.repairApplied === 'boolean') {
    details.push(metadata.repairApplied ? 'coverage repair applied' : 'no coverage repair needed');
  }

  return details.join(' · ');
}

export function buildPublicWorkflowLog(
  steps: TraceStep[],
  isGenerating: boolean,
  emptyOutputText: string
) {
  if (steps.length === 0) return `[WAIT] ${emptyOutputText}`;

  return steps.map((step, index) => {
    const isCurrent = isGenerating && index === steps.length - 1;
    const marker = step.status === 'error' ? 'ERROR' : isCurrent ? 'NOW' : 'DONE';
    const metadata = formatPublicTraceMetadata(step.metadata);
    const explanation = PUBLIC_STEP_DETAILS[step.status];

    return [
      `[${marker}] ${step.message}`,
      metadata ? `       Result: ${metadata}` : '',
      explanation ? `       ${explanation}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}
