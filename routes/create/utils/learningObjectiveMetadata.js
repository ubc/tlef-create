const VALID_BLOOM_LEVELS = new Set([
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create'
]);

export function validateInstructorMetadata({ bloomLevel, subpoints }) {
  let normalizedBloomLevel;
  let normalizedSubpoints;

  if (bloomLevel !== undefined) {
    normalizedBloomLevel = String(bloomLevel || '').trim().toLowerCase();
    if (normalizedBloomLevel && !VALID_BLOOM_LEVELS.has(normalizedBloomLevel)) {
      return { error: 'Bloom level must be remember, understand, apply, analyze, evaluate, or create' };
    }
  }

  if (subpoints !== undefined) {
    if (!Array.isArray(subpoints)) {
      return { error: 'Subpoints must be an array of text values' };
    }
    normalizedSubpoints = subpoints
      .map(subpoint => String(subpoint || '').trim())
      .filter(Boolean);
    if (normalizedSubpoints.length > 20) {
      return { error: 'A learning objective can have at most 20 subpoints' };
    }
    if (normalizedSubpoints.some(subpoint => subpoint.length > 500)) {
      return { error: 'Each subpoint must be 500 characters or fewer' };
    }
  }

  return { bloomLevel: normalizedBloomLevel, subpoints: normalizedSubpoints };
}

export function buildInstructorMetadata(metadata) {
  const instructorAuthoredFields = [];
  if (metadata.bloomLevel) instructorAuthoredFields.push('bloomLevel');
  if (metadata.subpoints?.length) instructorAuthoredFields.push('subpoints');

  return {
    isAIGenerated: false,
    bloomLevel: metadata.bloomLevel || '',
    subpoints: metadata.subpoints || [],
    instructorAuthoredFields
  };
}

export function mergeInstructorProtectedMetadata(existingMetadata = {}, enrichment = {}) {
  const instructorAuthoredFields = new Set(existingMetadata.instructorAuthoredFields || []);
  const enrichedSubpoints = Array.isArray(enrichment.subpoints)
    ? enrichment.subpoints.filter(Boolean)
    : [];

  return {
    subpoints: instructorAuthoredFields.has('subpoints') && existingMetadata.subpoints?.length
      ? existingMetadata.subpoints
      : enrichedSubpoints.length > 0
        ? enrichedSubpoints
        : (existingMetadata.subpoints || []),
    bloomLevel: instructorAuthoredFields.has('bloomLevel') && existingMetadata.bloomLevel
      ? existingMetadata.bloomLevel
      : enrichment.bloomLevel || existingMetadata.bloomLevel || ''
  };
}
