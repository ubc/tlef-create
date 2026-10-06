import { fail } from './authoringContracts.js';
import { authoringSourceVersion } from './authoringTaskContext.js';
import { isMaterialReady } from '../../utils/generationReadiness.js';

export const REQUIREMENT_SAMPLE_LIMITS = Object.freeze({ materials: 20, totalCharacters: 18000, materialCharacters: 6000, spans: 5 });

// Read existing, authorized extracted text. No embedding or model request is
// needed to establish the subject before asking the teacher a scope question.
export function sampleRequirementMaterials(materials, { userId, observations = [] } = {}) {
  if (!Array.isArray(materials) || materials.length > REQUIREMENT_SAMPLE_LIMITS.materials
    || materials.some(material => String(material.uploadedBy || '') !== String(userId || '') || !userId || !isMaterialReady(material))) {
    fail('The teaching scope must use ready materials owned by the current instructor.', 409, 'AUTHORING_REQUIREMENT_SOURCES');
  }
  const budget = Math.min(REQUIREMENT_SAMPLE_LIMITS.materialCharacters,
    Math.floor(REQUIREMENT_SAMPLE_LIMITS.totalCharacters / Math.max(1, materials.length)));
  return materials.map(material => {
    const text = String(material.content || '');
    const materialId = String(material._id);
    const sourceVersion = authoringSourceVersion(material);
    const length = Math.max(1, Math.floor(budget / REQUIREMENT_SAMPLE_LIMITS.spans));
    const previous = observations.filter(observation => observation.tool === 'read_material'
      && observation.data?.material?.id === materialId
      && observation.provenance?.some(reference => reference.kind === 'material' && reference.id === materialId && reference.sourceVersion === sourceVersion
        && reference.start === observation.data.offset && reference.end === observation.data.end)
      && Number.isInteger(observation.data.offset) && observation.data.offset >= 0 && observation.data.offset < text.length
      && Number.isInteger(observation.data.end) && observation.data.end > observation.data.offset && observation.data.end <= text.length
      && typeof observation.data.excerpt === 'string' && observation.data.excerpt.length <= observation.data.end - observation.data.offset
      && text.slice(observation.data.offset, observation.data.offset + observation.data.excerpt.length) === observation.data.excerpt).slice(-20);
    const recordedOffsets = previous.slice(-2).map(observation => observation.data.offset);
    const priorCovers = (start, end) => {
      let coveredEnd = start;
      for (const observation of [...previous].sort((a, b) => a.data.offset - b.data.offset)) {
        if (observation.data.offset > coveredEnd) break;
        coveredEnd = Math.max(coveredEnd, observation.data.end);
        if (coveredEnd >= end) return true;
      }
      return false;
    };
    const lastOffset = Math.max(0, text.length - length);
    const offsets = text.length <= budget ? [0] : [...new Set([...recordedOffsets,
      ...Array.from({ length: REQUIREMENT_SAMPLE_LIMITS.spans }, (_, index) => Math.floor(lastOffset * index / (REQUIREMENT_SAMPLE_LIMITS.spans - 1)))])]
      .slice(0, REQUIREMENT_SAMPLE_LIMITS.spans);
    const spans = offsets.map(offset => {
      const end = Math.min(text.length, offset + (text.length <= budget ? budget : length));
      return { offset, end, text: text.slice(offset, end), obtainedFrom: priorCovers(offset, end)
        ? 'verified-prior-reading' : 'extracted-text-sample' };
    }).filter(span => span.text.trim());
    return { material: { id: materialId, name: String(material.name || '').slice(0, 255), type: material.type, sourceVersion },
      readStatus: spans.length ? 'sampled' : 'empty', totalCharacters: text.length,
      sampledCharacters: spans.reduce((total, span) => total + span.text.length, 0),
      priorReadRanges: previous.map(observation => ({ offset: observation.data.offset, end: observation.data.end })), spans };
  });
}
