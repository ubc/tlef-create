import { resolveAuthoringActivity } from './authoringActivityCapabilities.js';
import { resolveAuthoringContext } from './authoringContext.js';
import { effectiveTeachingBrief } from './authoringRequirements.js';
import { digest, fail } from './authoringContracts.js';
import { AuthoringRun, AuthoringSession, AuthoringVersion } from '../../models/StudioAuthoring.js';
import { readNative } from './artifactVersionService.js';
import { buildAssistantContext } from '../studioAssistantPlanning.js';
import { generateStudioActivity, validateStudioRequestFeasibility } from '../h5pStudioAIService.js';
import { reviewQuestionSemantics } from '../questionSemanticReview.js';
import { QUESTION_REVIEW_POLICY_VERSION } from '../questionReviewContract.js';
import { authoringOperation } from './authoringOperations.js';
import { nativeReviewFailureMessage } from './nativeReviewFailureMessage.js';
import llmService from '../llmService.js';
import { isMaterialReady } from '../../utils/generationReadiness.js';

const copy = value => structuredClone(value);
export const NATIVE_REVIEW_WORKFLOW_VERSION = 'native-review-workflow-v1';
export const nativeActivityInputHash = (session, plan) => digest({ plan, sessionId: String(session._id),
  reviewPolicyVersion: QUESTION_REVIEW_POLICY_VERSION });
const sourceSignature = context => digest({
  courseId: String(context.course?._id || ''),
  materials: context.materials.map(item => ({ id: String(item._id), updatedAt: item.updatedAt,
    status: item.processingStatus })).sort((a, b) => a.id.localeCompare(b.id)),
  objectives: context.objectives.map(item => ({ id: String(item._id), updatedAt: item.updatedAt,
    text: item.text })).sort((a, b) => a.id.localeCompare(b.id))
});

export function validateNativePlanLibrary(library, catalog, { template } = {}) {
  const capability = resolveAuthoringActivity({ library, catalog });
  const usableTemplate = capability?.mode === 'template' && template?.library === library && template?.params?.params;
  if (!capability || capability.representation !== 'native-h5p' || (capability.mode !== 'generate' && !usableTemplate)) {
    fail('Choose a directly generatable installed activity. Prepare required media templates in Advanced types first.', 422, 'AUTHORING_NATIVE_TYPE');
  }
  return capability;
}

const templateFingerprint = template => digest({ library: template.library, params: template.params });
const requirementSignature = session => digest(Object.fromEntries(Object.entries(session.teachingRequirements?.fields || {})
  .map(([field, item]) => [field, item?.value])));
const selectedIds = values => (values || []).map(String).sort();
async function resolveOwnedRevisionTemplate(session, plan) {
  const version = await AuthoringVersion.findOne({ _id: plan.baseVersionId, sessionId: session._id, owner: session.owner });
  if (!version || version.contentId !== plan.templateContentId || !await AuthoringSession.exists({
    _id: session._id, owner: session.owner, currentVersionId: version._id
  })) fail('The current activity changed. Request a new revision of its latest version.', 409, 'AUTHORING_CONTRACT_CHANGED');
  return readNative(version.contentId, String(session.owner));
}

/** A requested revision already authorizes drafting a candidate. Its immutable
 * base and source scope are saved with the paid receipts, not inferred again
 * from a later conversation or from the current UI title. */
export async function proposeNativeActivityRevision({ session, current, template, latestRequest, catalog,
  resolveContext = resolveAuthoringContext }) {
  if (!current || String(current.owner) !== String(session.owner) || String(current.sessionId) !== String(session._id)
    || String(current._id) !== String(session.currentVersionId) || !current.contentId || !template?.params?.params) {
    fail('Choose the current owned activity before requesting a native revision.', 409, 'AUTHORING_CONTRACT_CHANGED');
  }
  const capability = validateNativePlanLibrary(template.library, catalog, { template });
  const instructions = `${effectiveTeachingBrief(session)}\nLATEST INSTRUCTOR CHANGE: ${latestRequest}\nPreserve existing content and media except where the instructor explicitly requests a change.`;
  if (instructions.length > 12000) fail('Shorten the teaching brief before revising this activity.', 400, 'AUTHORING_INPUT');
  await validateStudioRequestFeasibility(template.library, instructions);
  const context = await resolveContext(String(session.owner), { courseId: String(session.courseId),
    materialIds: selectedIds(session.materialIds), objectiveIds: selectedIds(session.objectiveIds) });
  if (context.materials.some(item => !isMaterialReady(item))) {
    fail('Wait for the selected materials to finish processing before revising this activity.', 409, 'MATERIALS_NOT_READY');
  }
  return { version: 1, kind: 'revision', library: template.library, title: capability.label,
    baseVersionId: String(current._id), templateContentId: current.contentId, templateFingerprint: templateFingerprint(template),
    courseId: String(session.courseId), materialIds: selectedIds(session.materialIds), objectiveIds: selectedIds(session.objectiveIds),
    sourceSignature: sourceSignature(context), requirementSignature: requirementSignature(session),
    latestRequest, instructions, reviewPolicyVersion: QUESTION_REVIEW_POLICY_VERSION };
}

export async function validateNativeActivityRevisionPlan({ session, plan, catalog,
  resolveContext = resolveAuthoringContext, resolveTemplate = resolveOwnedRevisionTemplate }) {
  if (plan?.kind !== 'revision' || String(plan.baseVersionId) !== String(session.currentVersionId)
    || plan.courseId !== String(session.courseId) || plan.reviewPolicyVersion !== QUESTION_REVIEW_POLICY_VERSION
    || plan.requirementSignature !== requirementSignature(session)
    || digest(selectedIds(plan.materialIds)) !== digest(selectedIds(session.materialIds))
    || digest(selectedIds(plan.objectiveIds)) !== digest(selectedIds(session.objectiveIds))) {
    fail('The saved native revision belongs to a different activity or teaching scope. Request a new proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
  }
  const template = await resolveTemplate(session, plan);
  validateNativePlanLibrary(plan.library, catalog, { template });
  if (template.library !== plan.library || templateFingerprint(template) !== plan.templateFingerprint) {
    fail('The saved activity template changed. Request a new revision before generating.', 409, 'AUTHORING_CONTRACT_CHANGED');
  }
  const context = await resolveContext(String(session.owner), { courseId: String(session.courseId),
    materialIds: plan.materialIds, objectiveIds: plan.objectiveIds });
  if (sourceSignature(context) !== plan.sourceSignature || context.materials.some(item => !isMaterialReady(item))) {
    fail('The selected sources changed after this proposal. Ask for an updated plan before generating.', 409, 'AUTHORING_SOURCE_CHANGED');
  }
  return { template, context };
}

const nativeSourceContract = (session, plan) => ({ version: 1, kind: plan.kind === 'revision' ? 'revision' : 'initial',
  courseId: plan.courseId, materialIds: selectedIds(plan.materialIds), objectiveIds: selectedIds(plan.objectiveIds),
  sourceSignature: plan.sourceSignature, reviewPolicyVersion: plan.reviewPolicyVersion,
  requirementSignature: plan.requirementSignature,
  ...(plan.kind === 'revision' ? { library: plan.library, baseVersionId: plan.baseVersionId,
    templateContentId: plan.templateContentId, templateFingerprint: plan.templateFingerprint } : { baseVersionId: null }) });

/** Generated native candidates retain their checked source contract through
 * packaging and acceptance. Explicit manual edits and historical restores do
 * not acquire a new generation claim from this contract. */
export async function validateNativeSourceContract({ session, contract, catalog,
  resolveContext = resolveAuthoringContext, resolveTemplate = resolveOwnedRevisionTemplate }) {
  if (contract?.version !== 1 || !['initial', 'revision'].includes(contract.kind)
    || contract.reviewPolicyVersion !== QUESTION_REVIEW_POLICY_VERSION) {
    fail('The saved native activity has no current generation review contract. Request a new proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
  }
  if (contract.kind === 'revision') return validateNativeActivityRevisionPlan({ session, plan: contract, catalog, resolveContext, resolveTemplate });
  if (session.currentVersionId || contract.courseId !== String(session.courseId)
    || contract.requirementSignature !== requirementSignature(session)
    || digest(selectedIds(contract.materialIds)) !== digest(selectedIds(session.materialIds))
    || digest(selectedIds(contract.objectiveIds)) !== digest(selectedIds(session.objectiveIds))) {
    fail('The saved native activity belongs to a different teaching scope. Request a new proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
  }
  const context = await resolveContext(String(session.owner), { courseId: String(session.courseId),
    materialIds: contract.materialIds, objectiveIds: contract.objectiveIds });
  if (sourceSignature(context) !== contract.sourceSignature || context.materials.some(item => !isMaterialReady(item))) {
    fail('The selected sources changed after this proposal. Ask for an updated plan before generating.', 409, 'AUTHORING_SOURCE_CHANGED');
  }
  return { context };
}

export async function proposeNativeActivityPlan({ session, library, latestRequest, revision, catalog,
  resolveContext = resolveAuthoringContext }) {
  const capability = validateNativePlanLibrary(library, catalog);
  const instructions = [effectiveTeachingBrief(session), `LATEST INSTRUCTOR REQUEST: ${latestRequest}`].join('\n\n');
  if (instructions.length > 12000) fail('Shorten the teaching brief before creating this activity.', 400, 'AUTHORING_INPUT');
  await validateStudioRequestFeasibility(library, instructions);
  const context = await resolveContext(String(session.owner), { courseId: String(session.courseId),
    materialIds: session.materialIds.map(String), objectiveIds: (session.objectiveIds || []).map(String) });
  if (context.materials.some(item => !isMaterialReady(item))) {
    fail('Wait for the selected materials to finish processing before reviewing this activity plan.', 409, 'MATERIALS_NOT_READY');
  }
  return { version: 1, revision, status: 'awaiting_approval', library, title: capability.label,
    courseId: String(session.courseId), requirementSignature: requirementSignature(session), reviewPolicyVersion: QUESTION_REVIEW_POLICY_VERSION,
    instructions, brief: [...new Set([session.instructions, latestRequest].filter(Boolean))].join('\n\n'), sourceSignature: sourceSignature(context),
    materialIds: session.materialIds.map(String), objectiveIds: (session.objectiveIds || []).map(String) };
}

const defaults = {
  resolveContext: resolveAuthoringContext, buildContext: buildAssistantContext,
  resolveTemplate: resolveOwnedRevisionTemplate,
  generate: generateStudioActivity, review: reviewQuestionSemantics,
  complete: options => llmService.streamCompletion(options), operation: authoringOperation,
  async persistPaid({ session, run, state, checkpoint }) {
    if (!run.leaseToken) fail('This AI response cannot be saved without an active execution lease.');
    const saved = await AuthoringRun.updateOne({ _id: run._id, owner: session.owner, sessionId: session._id,
      status: 'running', leaseToken: run.leaseToken, leaseUntil: { $gt: new Date() } }, {
      $set: { checkpoint, result: { nativeActivity: state } },
      $push: { steps: { $each: [{ name: checkpoint, createdAt: new Date() }], $slice: -40 } }
    });
    if (!saved.matchedCount) fail('The task lease was lost before its AI response could be saved.');
  }
};

/** Native drafts use the same owned run, candidate version and explicit
 * acceptance boundary as course questions. Paid responses are saved before
 * interpretation; replay never purchases an uncertain request automatically.
 */
export function createNativeActivityAuthoring(overrides = {}) {
  const dependencies = { ...defaults, ...overrides };
  return async ({ session, run, plan = session.nativePlan, guard, checkpoint, signal,
    resumeState, explicitResume = false, catalog }) => {
    const revision = plan?.kind === 'revision';
    if (!revision) validateNativePlanLibrary(plan?.library, catalog);
    const inputHash = nativeActivityInputHash(session, plan);
    let state = resumeState || run.result?.nativeActivity;
    if (state && (state.version !== 1 || state.inputHash !== inputHash)) {
      fail('The saved native draft belongs to a different teaching plan. Review the latest proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
    }
    state = state ? copy(state) : { version: 1, inputHash, receipts: {}, phase: 'ready', ...(revision ? { plan: copy(plan) } : {}) };
    const save = async (name, paid = false) => {
      if (paid) await dependencies.persistPaid({ session, run, state: copy(state), checkpoint: name });
      else { await guard(); await checkpoint(name, { nativeActivity: copy(state) }); }
      run.result = { nativeActivity: copy(state) };
    };
    const revisionContext = revision ? await validateNativeActivityRevisionPlan({ session, plan, catalog,
      resolveContext: dependencies.resolveContext, resolveTemplate: dependencies.resolveTemplate }) : null;
    const approvedContext = revisionContext || await validateNativeSourceContract({ session, contract: nativeSourceContract(session, plan), catalog,
      resolveContext: dependencies.resolveContext, resolveTemplate: dependencies.resolveTemplate });
    const context = approvedContext.context;
    if (sourceSignature(context) !== plan.sourceSignature || context.materials.some(item => !isMaterialReady(item))) {
      fail('The selected sources changed after this proposal. Ask for an updated plan before generating.', 409, 'AUTHORING_SOURCE_CHANGED');
    }
    if (state.phase === 'completed') {
      if (state.output?.reviewSummary?.policyVersion !== QUESTION_REVIEW_POLICY_VERSION) {
        fail('The saved native draft used an older review policy. Ask for a new proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
      }
      await validateNativeSourceContract({ session, contract: state.output.nativeSourceContract, catalog,
        resolveContext: dependencies.resolveContext, resolveTemplate: dependencies.resolveTemplate });
      run.result = { nativeActivity: copy(state) };
      return copy(state.output);
    }
    if (state.failure && !explicitResume) fail('This native activity needs your instruction or explicit retry.', 409, 'AUTHORING_NATIVE_RETRY');
    if (explicitResume) {
      const reviewContextChanged = state.reviewContextVersion !== NATIVE_REVIEW_WORKFLOW_VERSION;
      const reviewOnly = ['REVIEW_UNAVAILABLE', 'REVIEW_LIMIT_REACHED', 'REVIEW_INVALID_RESPONSE'].includes(state.failure?.reason)
        || (reviewContextChanged && state.failure?.reason === 'INSTRUCTION_MISMATCH');
      const redraft = state.failure?.code === 'H5P_AI_INVALID'
        || ['ANSWER_INVALID', 'RUBRIC_INVALID', 'FEEDBACK_INVALID'].includes(state.failure?.reason)
        || (!reviewOnly && state.failure?.reason === 'INSTRUCTION_MISMATCH')
        || String(state.failure?.reason || '').startsWith('ARITHMETIC_');
      for (const [key, receipt] of Object.entries(state.receipts)) {
        if (receipt.phase === 'pending' || redraft || (reviewOnly && key.startsWith('review:'))) delete state.receipts[key];
      }
      delete state.failure;
    }
    if (!state.context) {
      const evidence = context.materials.length ? await dependencies.operation('retrieve_sources', 'Read selected evidence for the native activity',
        () => dependencies.buildContext(context.materials, { userId: String(session.owner), signal })) : { context: '', sources: [] };
      state.context = { evidence: evidence.context, sources: evidence.sources || [],
        objectives: context.objectives.map(item => ({ id: String(item._id), text: item.text })) };
      await save('native_context_saved');
    }
    const ordinals = new Map();
    const complete = phase => async options => {
      const ordinal = ordinals.get(phase) || 0; ordinals.set(phase, ordinal + 1);
      const key = `${phase}:${ordinal}`, promptHash = digest(options.prompt);
      const receipt = state.receipts[key];
      if (receipt?.phase === 'saved') {
        if (receipt.promptHash !== promptHash) fail('The native generation contract changed. Ask for a new proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
        return copy(receipt.response);
      }
      if (receipt?.phase === 'pending') fail('The previous AI response is unknown. Resume explicitly.', 409, 'AUTHORING_MODEL_UNCERTAIN');
      await guard(); signal?.throwIfAborted();
      state.receipts[key] = { phase: 'pending', promptHash }; await save(`native_${phase}_model_pending`);
      const response = await dependencies.complete({ ...options, userId: String(session.owner), signal });
      state.receipts[key] = { phase: 'saved', promptHash, response: { content: String(response?.content || ''),
        ...(typeof response?.model === 'string' ? { model: response.model } : {}) } };
      await save(`native_${phase}_model_saved`, true);
      await guard(); signal?.throwIfAborted();
      return copy(state.receipts[key].response);
    };
    try {
      const generated = await dependencies.operation('generate_native_activity', `Draft ${plan.title}`, () => dependencies.generate({
        library: plan.library, instructions: plan.instructions, context: JSON.stringify(state.context),
        ...(revision ? { template: revisionContext.template, templateContentId: plan.templateContentId } : {}),
        userId: String(session.owner), complete: complete('draft'), catalog }));
      await guard();
      const workflowContext = revision ? {
        stage: 'native_revision_candidate_review', baseVersionId: plan.baseVersionId,
        authorization: 'The instructor explicitly requested this revision of the current saved activity. The generated result is a candidate for preview and later Accept changes.',
        completedStage: 'Any earlier request to show a first confirmable activity plan belonged to setup and has already been completed outside the activity document.',
        reviewTask: 'Evaluate the candidate against the latest revision request and all retained teaching, data, answer, feedback and evidence constraints. Do not require the activity parameters to contain another planning card.'
      } : {
        stage: 'approved_native_plan_candidate_review', approvedPlanRevision: plan.revision,
        authorization: 'Before this generation, the instructor reviewed the native activity plan in CREATE and explicitly chose Accept plan & generate. The generated result is a candidate for preview and later Accept changes.',
        completedStage: 'The earlier request to first provide a confirmable activity plan has already been fulfilled in the CREATE conversation and plan approval UI, outside the activity document.',
        reviewTask: 'Evaluate the candidate content against the approved teaching and data requirements. Preserve every content constraint, including exclusions. Do not require the generated activity parameters to contain the earlier plan or repeat its approval step.'
      };
      state.reviewContextVersion = NATIVE_REVIEW_WORKFLOW_VERSION;
      const checked = await dependencies.review({ questionText: generated.document.metadata.title,
        content: generated.document.parameters }, { questionType: plan.library, scope: 'activity',
        relevantContent: state.context.sources.map(source => ({ content: source.excerpt })),
        instructorContext: JSON.stringify({ workflowContext, learningObjectives: state.context.objectives }), instructorRequest: plan.instructions,
        complete: complete('review'), signal });
      const latestContext = await dependencies.resolveContext(String(session.owner), { courseId: String(session.courseId),
        materialIds: plan.materialIds, objectiveIds: plan.objectiveIds });
      if (sourceSignature(latestContext) !== plan.sourceSignature) {
        fail('The selected sources changed during generation. Review an updated proposal before saving.', 409, 'AUTHORING_SOURCE_CHANGED');
      }
      if (revision) await validateNativeActivityRevisionPlan({ session, plan, catalog,
        resolveContext: dependencies.resolveContext, resolveTemplate: dependencies.resolveTemplate });
      state.output = { document: generated.document, representation: 'native-fork',
        reviewSummary: checked.reviewSummary, sourceReferences: state.context.sources,
        nativeSourceContract: nativeSourceContract(session, plan),
        changes: [revision ? 'Proposed an independent native H5P revision. Review the full preview; course questions are unchanged.'
          : `Created ${plan.title} as an independent Studio activity.`] };
      state.phase = 'completed'; await save('native_activity_saved');
      return copy(state.output);
    } catch (error) {
      state.failure = { code: error.code || 'AUTHORING_NATIVE_FAILED', reason: error.qualityFailureReason || '',
        message: nativeReviewFailureMessage(error) || (error.status ? String(error.message).slice(0, 600) : 'The native activity could not finish. Saved work is preserved.'),
        issues: (error.rejectedDraft?.issues || []).slice(0, 8).map(issue => String(issue).slice(0, 600)),
        reviewSummary: error.rejectedDraft?.reviewSummary };
      try { await save('native_activity_failed'); } catch { /* Preserve the saved paid receipt when cancellation prevents a later checkpoint. */ }
      throw error;
    }
  };
}

export const buildNativeActivityCandidate = createNativeActivityAuthoring();
