import { createHash } from 'node:crypto';

export const MATERIAL_CLASSIFICATIONS = ['lecture-notes', 'slides', 'worked-examples', 'assessment', 'reference-reading', 'mixed', 'unknown'];
export const teachingObjectiveInstruction = 'Write student-observable learning objectives using an assessable action verb, the specific content, and conditions when useful. Avoid understand/know/learn-only outcomes. Align the cognitive work with what the selected materials actually teach and what the instructor requests. Split compound goals only when their outcomes can be assessed independently; do not create synonymous objectives for the same narrow topic. Before drafting, identify the relevant taught concepts and compare them with required topics and exclusions. Retain the requested topics rather than substituting a familiar textbook example. Proposed objectives are editable drafts, not proof of exhaustive source coverage.';
const fields = ['materialId', 'materialName', 'sourceFile', 'chunkIndex', 'pageNumber', 'pageStart', 'pageEnd', 'excerpt', 'relevanceScore', 'section', 'sectionId'];
const cut = (value, maximum) => String(value || '').trim().slice(0, maximum);
const idOf = value => String(value?._id ?? value ?? '');
const fail = message => { throw Object.assign(new Error(message), { code: 'H5P_ASSISTANT_INVALID_SOURCE', status: 400 }); };

// This receives server-owned references. Task IDs never supply their own text.
export function normalizePlanningSources(sources = []) {
  if (!Array.isArray(sources) || sources.length > 512) fail('The planning source snapshot is invalid.');
  const byId = new Map();
  for (const source of sources) {
    if (!source || !idOf(source.materialId) || (source.excerpt != null && (typeof source.excerpt !== 'string' || source.excerpt.length > 12000))) fail('Planning sources require valid owned material references.');
    const reference = { ...Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]])), materialId: idOf(source.materialId) };
    const signature = JSON.stringify(['materialId', 'chunkIndex', 'pageNumber', 'pageStart', 'pageEnd', 'excerpt', 'section', 'sectionId'].map(key => reference[key] ?? null));
    const id = (Object.hasOwn(source, 'id') ? source.id : undefined) || `src-${createHash('sha256').update(signature).digest('hex').slice(0, 24)}`;
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) fail('A planning source ID is invalid.');
    const previous = byId.get(id);
    if (previous && fields.filter(key => !['materialName', 'sourceFile', 'relevanceScore'].includes(key)).some(key => previous[key] !== reference[key])) fail('A planning source ID refers to different evidence.');
    if (!previous) byId.set(id, { ...reference, id });
  }
  return [...byId.values()];
}

function classify(material, excerpts) {
  const name = cut(material.name, 255).toLocaleLowerCase();
  const rules = [
    ['slides', /\bslides?\b|幻灯片|课件/], ['lecture-notes', /\blecture[ -]?notes?\b|\bnotes?\b|讲义|课堂笔记/],
    ['worked-examples', /\bworked[ -]?examples?\b|\bsolutions?\b|例题|解题示例/],
    ['assessment', /\b(?:quiz|exam|assignment|problem[ -]?set|worksheet)\b|试题|作业|测验/],
    ['reference-reading', /\b(?:reading|chapter|textbook|article)\b|阅读|教材|文献/]
  ];
  const metadataKinds = rules.filter(([, rule]) => rule.test(name)).map(([kind]) => kind);
  if (metadataKinds.length) return { classification: metadataKinds.length > 1 ? 'mixed' : metadataKinds[0], basis: 'metadata' };
  const sample = excerpts.slice(0, 4).map(source => source.excerpt.slice(0, 800)).join('\n').toLocaleLowerCase();
  const textKinds = rules.filter(([, rule]) => rule.test(sample)).map(([kind]) => kind);
  return { classification: textKinds.length > 1 ? 'mixed' : textKinds[0] || 'unknown', basis: textKinds.length ? 'text-excerpts' : 'uncertain' };
}

/** Factual baseline: classification is an inference, reading is provenance. */
export function buildMaterialTeachingBrief({ materials = [], objectives = [], sources = [], instructions = '', teachingRequirements = {}, userId } = {}) {
  if (!Array.isArray(materials) || materials.length > 20 || materials.some(material => idOf(material.uploadedBy) !== idOf(userId))) fail('The teaching brief must use authorized materials.');
  const materialIds = new Set(materials.map(idOf));
  const allReferences = normalizePlanningSources(sources);
  const references = allReferences.filter(source => source.excerpt?.trim());
  if (allReferences.some(source => !materialIds.has(idOf(source.materialId)))) fail('The teaching brief contains evidence outside the selected materials.');
  if (!Array.isArray(objectives) || objectives.length > 8) fail('The teaching brief contains too many learning objectives.');
  const field = key => cut(teachingRequirements?.fields?.[key]?.value, 1000);
  const objectiveRows = objectives.slice(0, 8).map(objective => {
    const objectiveSources = normalizePlanningSources(objective.sourceReferences || []);
    if (objectiveSources.some(source => !materialIds.has(idOf(source.materialId)))) fail('A teaching goal refers to an unselected material.');
    const readSources = objectiveSources.filter(source => source.excerpt?.trim());
    return { id: idOf(objective.id || objective._id), text: cut(objective.text, 500), sourceIds: readSources.map(source => source.id).slice(0, 16),
      grounding: readSources.length ? 'material-grounded' : 'instructor-brief' };
  });
  const assumptions = [
    ['audience', 'Introductory learners', 'No learner level was specified.'],
    ['purpose', 'Formative practice', 'No assessment purpose was specified.'],
    ['difficulty', 'Moderate', 'No difficulty was specified.']
  ].filter(([key]) => !field(key)).map(([key, value, reason]) => ({ key, value, reason, provenance: 'default' }));
  const explicitTopics = [field('topic'), field('mustCover')].filter(Boolean).map(value => value.slice(0, 300));
  const topics = explicitTopics.length ? [...new Set(explicitTopics)] : objectiveRows.map(objective => objective.text.slice(0, 300));
  return { version: 1, grounding: materials.length ? 'material-grounded' : 'instructor-brief',
    summary: cut(topics.join('; ') || instructions, 1000),
    materials: materials.map(material => {
      const selected = references.filter(source => idOf(source.materialId) === idOf(material));
      return { id: idOf(material), name: cut(material.name, 255), format: ['pdf', 'docx', 'url', 'text'].includes(material.type) ? material.type : 'unknown',
        ...classify(material, selected), readStatus: selected.length ? 'sampled' : 'not-read', sourceCount: selected.length, sourceIds: selected.map(source => source.id).slice(0, 16) };
    }),
    scope: { topics: topics.slice(0, 12), exclusions: field('exclusions') ? [field('exclusions').slice(0, 300)] : [],
      coverage: materials.length ? references.length ? 'sampled' : 'not-read' : 'instructor-brief' },
    objectives: objectiveRows, assumptions, visualSupport: references.length ? 'text-only' : 'none' };
}

// A model can summarize read evidence, but cannot update teacher requirements,
// invent source IDs, or change the already saved learning objectives here.
export function applyTeachingOverview(brief, overview, sources) {
  if (!overview || typeof overview !== 'object' || Array.isArray(overview) || typeof overview.summary !== 'string' || !overview.summary.trim()
    || overview.summary.length > 1000 || !Array.isArray(overview.materialClassifications) || overview.materialClassifications.length > 20) fail('The model teaching overview is invalid.');
  const trusted = new Map(normalizePlanningSources(sources).filter(source => source.excerpt?.trim()).map(source => [source.id, source]));
  const next = structuredClone(brief?.toObject?.() || brief);
  if (typeof overview.summary === 'string' && overview.summary.trim() && overview.summary.length <= 1000) next.summary = overview.summary.trim();
  for (const proposal of overview.materialClassifications || []) {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) fail('A material classification is invalid.');
    const material = next.materials.find(row => row.id === proposal.materialId);
    if (!material || !MATERIAL_CLASSIFICATIONS.includes(proposal.classification) || !Array.isArray(proposal.sourceIds) || !proposal.sourceIds.length
      || proposal.sourceIds.length > 8 || proposal.sourceIds.some(id => trusted.get(id)?.materialId !== material.id)) fail('A material classification has no authorized reading evidence.');
    material.classification = proposal.classification; material.basis = 'text-excerpts';
  }
  return next;
}
