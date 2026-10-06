import { AuthoringRun } from '../../models/StudioAuthoring.js';
import { resolveAuthoringContext } from './authoringContext.js';
import { effectiveTeachingBrief } from './authoringRequirements.js';
import { allowedObjectiveSourceReferences } from './authoringTaskContext.js';
import { buildAssistantContext, proposeAssistantObjectives } from '../studioAssistantPlanning.js';
import { buildMaterialTeachingBrief, normalizePlanningSources } from '../studioTeachingBrief.js';
import { authoringOperation } from './authoringOperations.js';
import { digest, fail } from './authoringContracts.js';

export function createNativeTeachingStep(overrides = {}) {
  const dependencies = { resolveContext: resolveAuthoringContext, buildContext: buildAssistantContext,
    proposeObjectives: proposeAssistantObjectives, operation: authoringOperation,
    persist: async ({ session, run, state }) => {
      await AuthoringRun.updateOne({ _id: run._id, owner: session.owner, sessionId: session._id },
        { $set: { nativeTeachingState: state } });
    }, ...overrides };
  return async function prepareNativeTeaching({ session, run, latestRequest, guard, checkpoint, signal, explicitResume = false }) {
    const owner = String(session.owner);
    const context = await dependencies.resolveContext(owner, { courseId: String(session.courseId),
      materialIds: session.materialIds.map(String), objectiveIds: (session.objectiveIds || []).map(String) });
    const inputHash = digest({ requestId: run.input?.requestId || run.requestId, latestRequest,
      course: String(session.courseId), requirements: { fields: Object.fromEntries(Object.entries(session.teachingRequirements?.fields || {})
        .sort(([left], [right]) => left.localeCompare(right)).map(([name, field]) => [name, field.value])), countIssue: session.teachingRequirements?.countIssue || '' },
      materials: context.materials.map(material => [String(material._id), material.updatedAt, digest(material.content || '')]).sort(([a], [b]) => a.localeCompare(b)),
      objectives: context.objectives.map(objective => [String(objective._id), objective.text, objective.updatedAt]).sort(([a], [b]) => a.localeCompare(b)) });
    let state = run.nativeTeachingState ? structuredClone(run.nativeTeachingState) : { version: 1, inputHash, phase: 'ready' };
    if (state.version !== 1 || state.inputHash !== inputHash) fail('The teaching sources or request changed. Start a fresh native activity proposal.', 409, 'AUTHORING_SOURCE_CHANGED');
    const save = async () => { await dependencies.persist({ session, run, state: structuredClone(state) }); run.nativeTeachingState = structuredClone(state); };
    if (!['ready', 'model_pending', 'model_saved', 'completed'].includes(state.phase)
      || (['model_saved', 'completed'].includes(state.phase) && (!Array.isArray(state.objectives) || !state.objectives.length))) {
      fail('The saved learning-objective result is incomplete. Start a fresh native proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
    }
    if (state.phase === 'completed') {
      if (!state.teachingBrief?.objectives?.length) fail('The saved activity goals are incomplete.', 409, 'AUTHORING_CONTRACT_CHANGED');
      await guard(); return state.teachingBrief;
    }
    if (state.phase === 'model_pending') {
      if (!explicitResume) fail('The learning-objective request has an unknown outcome. Retry explicitly before purchasing another request.', 409, 'AUTHORING_NATIVE_TEACHING_UNKNOWN');
      state.phase = 'ready'; await save();
    }
    if (state.phase === 'ready') {
      await guard(); signal?.throwIfAborted();
      const evidence = context.materials.length ? await dependencies.operation('read_native_materials', 'Read materials for the activity goals',
        () => dependencies.buildContext(context.materials, { userId: owner, signal }))
        : { context: 'Brainstorming from the instructor brief. No course sources were supplied; do not invent citations.', sources: [] };
      state.sources = normalizePlanningSources([...(evidence.sources || []), ...allowedObjectiveSourceReferences(
        context.objectives.flatMap(objective => objective.generationMetadata?.sourceReferences || []), session.materialIds)]);
      if (context.objectives.length) state.objectives = context.objectives.map(objective => ({ id: String(objective._id), text: objective.text,
        sourceReferences: state.sources.filter(source => (objective.generationMetadata?.sourceReferences || [])
          .some(reference => String(reference.materialId) === String(source.materialId) && reference.excerpt === source.excerpt)) }));
      else {
        state.phase = 'model_pending'; await save(); await checkpoint('native_objectives_model_pending');
        const objectives = await dependencies.operation('propose_native_objectives', 'Brainstorm the activity learning objectives',
          () => dependencies.proposeObjectives({ instructions: `${effectiveTeachingBrief(session)}\nLATEST REQUEST: ${latestRequest}\nPropose one or two observable goals for this specific native activity. Preserve all supplied data and exclusions. Goals are editable teaching recommendations; do not add factual claims or generate questions.`,
            context: evidence.context, sources: state.sources, materials: context.materials,
            teachingRequirements: session.teachingRequirements, userId: owner, signal, promptBased: !context.materials.length }));
        // A returned paid result remains recoverable even if Stop races it.
        state.objectives = objectives; state.phase = 'model_saved'; await save();
        await guard(); await checkpoint('native_objectives_saved');
      }
    }
    await guard();
    state.teachingBrief = await dependencies.operation('classify_native_materials', 'Summarize materials and activity goals', async () =>
      buildMaterialTeachingBrief({ materials: context.materials, objectives: state.objectives, sources: state.sources,
        instructions: effectiveTeachingBrief(session), teachingRequirements: session.teachingRequirements, userId: owner }));
    state.phase = 'completed'; await save(); await guard();
    return state.teachingBrief;
  };
}

export const prepareNativeTeaching = createNativeTeachingStep();
