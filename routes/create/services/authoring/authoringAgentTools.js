import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import { fail, objectId, parseDecision } from './authoringContracts.js';
import { updateTeachingRequirements } from './teachingRequirements.js';
import { isMaterialReady } from '../../utils/generationReadiness.js';
import { listAuthoringNativeActivities, listAuthoringQuestionTypes } from './authoringActivityCapabilities.js';
import { authoringMaterialExcluded, authoringSourceVersion } from './authoringTaskContext.js';
import { planCourseQuestionRevision } from './courseQuestionRevision.js';

// These are application tools, not arbitrary database, file or network access.
export const authoringAgentToolDefinitions = [
  { name: 'list_activity_types', description: 'Inspect installed AI activity capabilities, compatible layouts and template requirements. Native types without course-question adapters use Advanced types.', arguments: { representation: 'course-question or native-h5p, default course-question', container: 'column, interactive-book, question-set, standalone or mixed-activity', offset: 'integer, default 0', limit: 'integer 1–20, default 20' } },
  { name: 'list_materials', description: 'List authorized course material labels and readiness. Reading a label does not read the source.', arguments: { offset: 'integer, default 0', limit: 'integer 1–20, default 20' } },
  { name: 'read_material', description: 'Read one page of extracted text from an authorized material. Follow nextOffset for later text.', arguments: { materialId: 'material ID', offset: 'character offset, default 0', length: 'integer 1–6000, default 6000' } },
  { name: 'search_materials', description: 'Search a page of authorized extracted sources lexically. Follow nextOffset to search more sources; this is not semantic retrieval or proof of complete coverage.', arguments: { query: 'search text, 1–300 characters', offset: 'material offset, default 0' } },
  { name: 'read_objectives', description: 'Read authorized saved learning objectives, without changing them.', arguments: { offset: 'integer, default 0', limit: 'integer 1–20, default 20' } },
  { name: 'select_materials', description: 'Propose up to 20 ready authorized materials for the next plan. This does not mutate the course or activity.', arguments: { materialIds: 'array of distinct material IDs' } },
  { name: 'select_objectives', description: 'Propose up to 8 authorized saved learning objectives for an initial teaching plan. This stages existing objectives without editing them.', arguments: { objectiveIds: 'array of distinct objective IDs, at most 8' } },
  { name: 'check_requirements', description: 'Read saved instructor requirements, explicit latest question count, and unresolved questions before planning. Does not generate content.', arguments: {} },
  { name: 'check_question_revision', description: 'Check a proposed course-question batch revision against the current saved version, question count and objective coverage without generating questions or changing content.', arguments: { scope: 'all to revise all questions; omit for quantity-only changes or explicit questionIndices', questionIndices: 'distinct one-based indices; [] or omitted with targetQuestionCount for quantity-only change', removeQuestionIndices: 'optional distinct one-based removal indices', targetQuestionCount: 'optional integer 1–20', questionType: 'optional supported course question type', difficulty: 'optional easy, moderate or hard', selectionMode: 'optional single or multiple for multiple-choice', objectiveChanges: 'optional {authorizationQuote:exact latest instructor quote,merges:[{objectiveIds:[existing IDs],text:merged goal}],excludeObjectiveIds:[existing IDs]}; count-only requests authorize no merge or exclusion' } }
];

const inputError = message => fail(message, 400, 'AUTHORING_AGENT_TOOL');
const integer = (value, fallback, max, minimum = 0) => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > max) inputError('Choose an offset or page size within this tool’s supported range.');
  return result;
};
const page = args => ({ offset: integer(args.offset, 0, 100000), limit: integer(args.limit, 20, 20, 1) });
const ids = (values, maximum = 20, label = 'material') => {
  if (!Array.isArray(values) || values.length > maximum || values.some(value => !objectId(value)) || new Set(values).size !== values.length) inputError(`Choose up to ${maximum} distinct ${label} IDs.`);
  return values;
};

export function createAuthoringAgentTools({ session, userId, latestRequest = '', signal, guard = async () => {}, canSelectMaterials = true,
  current = null, allowedQuestionTypes, requestId }) {
  const owner = String(userId || '');
  const selectedIds = (session.materialIds || []).map(String);
  const selectedObjectives = (session.objectiveIds || []).map(String);
  const courseId = String(session.courseId || '');
  const materialFilter = () => ({ folder: courseId, uploadedBy: owner,
    ...(session.contextCourse === true ? {} : { _id: { $in: selectedIds } }) });
  const authorize = async () => {
    signal?.throwIfAborted();
    await guard();
    if (!owner || String(session.owner) !== owner || !objectId(courseId)
      || !await Folder.exists({ _id: courseId, instructor: owner })) {
      fail('The authorized course is no longer available.', 404, 'AUTHORING_AGENT_SCOPE');
    }
  };
  const materialLabel = material => ({ id: String(material._id), name: String(material.name || '').slice(0, 255),
    type: material.type, status: material.processingStatus, ready: isMaterialReady(material), sourceVersion: authoringSourceVersion(material) });
  const objectiveLabel = objective => ({ id: String(objective._id), quizId: String(objective.quiz), sourceVersion: authoringSourceVersion(objective),
    text: String(objective.text || '').slice(0, 1000),
    subpoints: (objective.subpoints || objective.generationMetadata?.subpoints || []).slice(0, 12).map(point => String(point).slice(0, 400)) });
  const objectiveClauses = async () => {
    const quizzes = await Quiz.find({ folder: courseId, createdBy: owner }).select('learningObjectives').lean();
    const links = quizzes.flatMap(quiz => (quiz.learningObjectives || []).map(id => ({ _id: String(id), quiz: quiz._id })));
    return session.contextCourse === true ? links : links.filter(link => selectedObjectives.includes(link._id));
  };

  const handlers = {
    async list_activity_types(args) {
      const { offset, limit } = page(args);
      const representation = args.representation || 'course-question';
      const container = args.container || 'column';
      if (!['course-question', 'native-h5p'].includes(representation) || !['column', 'interactive-book', 'question-set', 'standalone', 'mixed-activity'].includes(container)) inputError('Choose a supported activity representation and layout.');
      const types = representation === 'native-h5p' ? listAuthoringNativeActivities() : listAuthoringQuestionTypes({ container, includeUnavailable: true });
      return { types: types.slice(offset, offset + limit), total: types.length,
        nextOffset: offset + limit < types.length ? offset + limit : null,
        summary: `Checked ${Math.min(limit, Math.max(0, types.length - offset))} installed activity capabilities and their AI authoring requirements.` };
    },
    async list_materials(args) {
      const { offset, limit } = page(args);
      const rows = await Material.find(materialFilter()).sort({ _id: 1 }).skip(offset).limit(limit + 1)
        .select('name type processingStatus processingMetadata updatedAt checksum').lean();
      const materials = rows.slice(0, limit).filter(row => !authoringMaterialExcluded(session, row, latestRequest)).map(materialLabel);
      return { materials, nextOffset: rows.length > limit ? offset + limit : null,
        summary: `Listed ${materials.length} authorized materials${materials.length ? `: ${materials.slice(0, 3).map(material => material.name).join(', ').slice(0, 200)}` : ''}.` };
    },
    async read_material(args) {
      if (!objectId(args.materialId)) inputError('Choose a valid material ID.');
      const offset = integer(args.offset, 0, 100000000);
      const length = integer(args.length, 6000, 6000, 1);
      // Keep the owner, course and original scope constraints when adding an ID.
      const material = await Material.findOne({ $and: [materialFilter(), { _id: args.materialId }] })
        .select('name type content processingStatus processingMetadata updatedAt checksum').lean();
      if (!material) inputError('That material is not available in this conversation’s authorized context.');
      if (authoringMaterialExcluded(session, material, latestRequest)) inputError('That material is excluded by the current instructor request.');
      if (!isMaterialReady(material)) inputError('That material must finish processing before it can be read.');
      const source = String(material.content || '');
      if (offset > source.length) inputError('The requested text offset is beyond the end of this material.');
      return { material: materialLabel(material), offset, text: source.slice(offset, offset + length),
        totalCharacters: source.length, nextOffset: offset + length < source.length ? offset + length : null,
        summary: `Read “${materialLabel(material).name}” · characters ${offset}–${Math.min(source.length, offset + length)} of ${source.length}.` };
    },
    async search_materials(args) {
      if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 300) inputError('Provide a search query of 1–300 characters.');
      const offset = integer(args.offset, 0, 100000);
      const rows = await Material.find(materialFilter()).sort({ _id: 1 }).skip(offset).limit(21)
        .select('name type content processingStatus processingMetadata updatedAt checksum').lean();
      const query = args.query.toLocaleLowerCase().trim();
      const terms = [...new Set(query.match(/[\p{L}\p{N}]+/gu) || [])].slice(0, 20);
      const results = rows.slice(0, 20).filter(row => isMaterialReady(row) && !authoringMaterialExcluded(session, row, latestRequest)).flatMap(material => {
        const source = String(material.content || '');
        const lowered = source.toLocaleLowerCase();
        const exact = lowered.indexOf(query);
        const hits = terms.map(term => lowered.indexOf(term)).filter(index => index >= 0);
        if (exact < 0 && !hits.length) return [];
        const at = exact >= 0 ? exact : Math.min(...hits);
        const excerptOffset = Math.max(0, at - 200);
        return [{ material: materialLabel(material), score: (exact >= 0 ? 2 : 0) + hits.length,
          offset: excerptOffset, excerpt: source.slice(excerptOffset, excerptOffset + 900) }];
      }).sort((a, b) => b.score - a.score).slice(0, 10);
      return { results, scannedMaterials: Math.min(rows.length, 20), nextOffset: rows.length > 20 ? offset + 20 : null,
        summary: `Searched ${Math.min(rows.length, 20)} authorized materials; found ${results.length} matching excerpts${results.length ? ` in ${results.slice(0, 3).map(result => result.material.name).join(', ').slice(0, 200)}` : ''}.` };
    },
    async read_objectives(args) {
      const { offset, limit } = page(args);
      const clauses = await objectiveClauses();
      const rows = clauses.length ? await LearningObjective.find({ createdBy: owner, $or: clauses }).sort({ _id: 1 })
        .skip(offset).limit(limit + 1).select('text quiz updatedAt subpoints generationMetadata.subpoints').lean() : [];
      const objectives = rows.slice(0, limit).map(objectiveLabel);
      return { objectives, nextOffset: rows.length > limit ? offset + limit : null,
        summary: `Read ${objectives.length} authorized learning objectives.` };
    },
    async select_materials(args) {
      if (!canSelectMaterials) inputError('A teaching plan or activity already exists. Material selection cannot change in this revision; start a new conversation to build with different materials.');
      const requested = ids(args.materialIds);
      const materials = await Material.find({ $and: [materialFilter(), { _id: { $in: requested } }] })
        .select('name type processingStatus processingMetadata updatedAt checksum').lean();
      if (materials.length !== requested.length) inputError('One or more materials are outside this conversation’s authorized context.');
      if (materials.some(material => !isMaterialReady(material))) inputError('Every selected material must finish processing before planning.');
      if (materials.some(material => authoringMaterialExcluded(session, material, latestRequest))) inputError('A selected material is excluded by the current instructor request.');
      return { materialIds: requested, materials: materials.map(materialLabel), summary: `Selected ${requested.length} ready authorized materials for a proposed plan${materials.length ? `: ${materials.slice(0, 3).map(material => materialLabel(material).name).join(', ').slice(0, 200)}` : ''}.` };
    },
    async select_objectives(args) {
      if (!canSelectMaterials) inputError('A teaching plan or activity already exists. Objective selection cannot change in this revision; start a new conversation to use different objectives.');
      const requested = ids(args.objectiveIds, 8, 'learning objective');
      const clauses = (await objectiveClauses()).filter(clause => requested.includes(clause._id));
      const rows = clauses.length ? await LearningObjective.find({ createdBy: owner, $or: clauses }).select('text quiz updatedAt subpoints generationMetadata.subpoints').lean() : [];
      if (rows.length !== requested.length) inputError('One or more objectives are outside this conversation’s authorized context or no longer belong to an owned course learning object.');
      return { objectiveIds: requested, objectives: rows.map(objectiveLabel), summary: `Selected ${requested.length} authorized learning objectives for a proposed plan.` };
    },
    async check_requirements() {
      const requirements = updateTeachingRequirements(session.teachingRequirements, latestRequest, 'agent-check');
      return { fields: Object.fromEntries(Object.entries(requirements.fields || {}).map(([key, item]) => [key, item.value])),
        countIssue: requirements.countIssue || null, openQuestions: requirements.openQuestions || [],
        summary: `Checked ${Object.keys(requirements.fields || {}).length} saved teaching requirements.` };
    },
    async check_question_revision(args) {
      if (current?.representation !== 'course-linked') inputError('This check requires a current course-linked activity.');
      try {
        const normalized = { ...args };
        const quantityOnly = !['questionType', 'difficulty', 'selectionMode'].some(field => normalized[field] != null);
        if (normalized.targetQuestionCount != null && quantityOnly) {
          if (normalized.scope == null && normalized.questionIndices == null) normalized.questionIndices = [];
          // A redundant all + empty selection on a pure quantity request must
          // not turn a free count check into permission to regenerate content.
          if (normalized.scope === 'all' && Array.isArray(normalized.questionIndices) && !normalized.questionIndices.length) delete normalized.scope;
        }
        const decision = parseDecision({ ...normalized, action: 'revise_questions', reply: 'Check the proposed revision.', clarification: [] }, current.snapshot?.questions?.length || 0, allowedQuestionTypes, latestRequest);
        const planned = planCourseQuestionRevision({ snapshot: current.snapshot, decision, teachingRequirements: session.teachingRequirements,
          baseVersionId: current._id, requestId, allowedQuestionTypes, latestRequest, owner });
        return planned.ready ? { ready: true, targetQuestionCount: planned.plan.targetQuestionCount,
          revisionCount: planned.plan.tasks.filter(task => task.kind === 'revise').length,
          additionCount: planned.plan.tasks.filter(task => task.kind === 'add').length,
          removedQuestionIndices: planned.plan.removedQuestionIndices,
          summary: `Checked the proposed revision for ${planned.plan.targetQuestionCount} questions while preserving saved objective coverage.` }
          : { ready: false, diagnostic: planned.diagnostic, summary: planned.diagnostic.message };
      } catch (error) {
        // Argument diagnostics are observations for the next bounded decision.
        // Authorization, cancellation and persistence failures still stop work.
        if (error.code !== 'AUTHORING_RESPONSE') throw error;
        const message = String(error.message).slice(0, 600);
        return { ready: false, diagnostic: { code: 'QUESTION_REVISION_ARGUMENTS_INVALID', message }, summary: message };
      }
    }
  };

  return {
    async execute(name, args = {}) {
      if (!Object.hasOwn(handlers, name) || !args || Array.isArray(args) || typeof args !== 'object'
        || JSON.stringify(args).length > 4000) inputError('Choose a supported teaching tool with bounded arguments.');
      await authorize();
      const result = await handlers[name](args);
      signal?.throwIfAborted();
      await guard();
      return result;
    }
  };
}
