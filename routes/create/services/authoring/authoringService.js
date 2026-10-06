import { updateTeachingRequirements, reconcileQuestionCount } from './teachingRequirements.js';
import { authoringOperation, withAuthoringOperations } from './authoringOperations.js';
import { readAuthoringTokenUsage, summarizeModelTokenReceipts } from './authoringTokenUsage.js';
import { resolveAuthoringContext, ensureDraftCourse } from './authoringContext.js';
import { runAuthoringAgent, canResumeAuthoringAgent } from './authoringAgent.js';
import { runCourseQuestionRevision } from './courseQuestionRevision.js';
import { authoringModeForRequest } from './authoringMode.js';
import { authoringMaterialExcluded, rebaseAuthoringTaskContext, loadAuthoringTaskContext, mergeAuthoringTaskContext, authoringScopeHash } from './authoringTaskContext.js';
import { proposeNativeActivityPlan, proposeNativeActivityRevision, buildNativeActivityCandidate, validateNativeSourceContract, nativeActivityInputHash } from './nativeActivityAuthoring.js';
import { queueAuthoringMessage, promoteAuthoringMessages } from './authoringQueue.js';
import { validateAuthoringSourceContract } from './authoringSourceContract.js';
import { authoringWorkflowForRequest, automaticContinuationDecision } from './authoringContinuation.js';
import { canonicalClarificationAnswers } from './authoringClarificationAnswers.js';
import { sampleRequirementMaterials } from './authoringRequirementSources.js';
import { nativeReviewFailureMessage } from './nativeReviewFailureMessage.js';
import restoreMaterialIndex from '../materialIndexRecovery.js';
import { prepareNativeTeaching } from './authoringNativeTeaching.js';
import { reviseNativeTeachingObjectives, replaceNativeLearningGoals } from './nativeTeachingObjectives.js';
import { assessAuthoringRequirements, effectiveTeachingBrief } from './authoringRequirements.js';
import crypto from 'node:crypto';
import { assistantRecoveryMessage, canReviseAssistantPlan } from './assistantRecovery.js';
import mongoose from 'mongoose';
import { AuthoringSession as Session, AuthoringMessage as Message, AuthoringRun as Run, AuthoringVersion as Version } from '../../models/StudioAuthoring.js';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import LegacySession from '../../models/StudioAssistantSession.js';
import { createAssistantSession, readAssistantSession, approveAssistantPlan, resumeAssistantSession, updateAssistantPlan, updateAssistantObjectives } from '../studioAssistantService.js';
import { proposeAssistantPlan, proposeAssistantObjectives, buildAssistantContext, getAssistantQuestionTypes } from '../studioAssistantPlanning.js';
import { isMaterialReady } from '../../utils/generationReadiness.js';
import Quiz from '../../models/Quiz.js';
import { acceptVersion, createVersion, readCourseSnapshot, readNative, cloneDocument } from './artifactVersionService.js';
import { digest, stableId, fail, objectId, requestId, validateCommand, validateObjectiveEdits, parseDecision, versionSummary } from './authoringContracts.js';

const LEASE_MS = 90_000;
const MAX_RUN_MS = 20 * 60_000;
const terminal = ['succeeded', 'failed', 'interrupted', 'cancelled'];
const userFor = owner => ({ id: String(owner) });
const activeControllers = new Map();
let timer;
let ticking = false;

async function savedNativeActivity(session, owner) {
  if (session.currentVersionId || !['generating', 'generated'].includes(session.nativePlan?.status)) return null;
  if (session.nativePlan.status === 'generated' && session.candidateVersionId) return null;
  // The immutable execution was approved with generating status. Packaging
  // marks the plan generated before saving its candidate; that lifecycle flag
  // must not detach the already checked response after a packaging failure.
  const inputHash = nativeActivityInputHash(session, { ...session.nativePlan, status: 'generating' });
  const previous = await Run.findOne({ owner, sessionId: session._id, status: { $in: terminal },
    'result.nativeActivity.version': 1, 'result.nativeActivity.inputHash': inputHash,
    ...(session.nativePlan.status === 'generated' ? { checkpoint: 'output_saved', 'result.nativeActivity.phase': 'completed' } : {}) })
    .sort({ updatedAt: -1, _id: -1 }).select('result.nativeActivity').lean();
  return previous?.result?.nativeActivity || null;
}

export async function ownedSession(owner, id) {
  if (!objectId(id)) fail('Task not found.', 404);
  const session = await Session.findOne({ _id: id, owner });
  if (!session || !await Folder.exists({ _id: session.courseId, instructor: owner })) fail('Task not found.', 404);
  return session;
}
const say = (session, key, role, text, runId, clarification = []) => Message.updateOne({ sessionId: session._id, key }, {
  $setOnInsert: { owner: session.owner, sessionId: session._id, key, role, text, runId, clarification }
}, { upsert: true });

export async function readAuthoringSession(owner, id, attempt = 0) {
  const session = await ownedSession(owner, id);
  const [messages, versions, run, assistant, pastRuns, queued, tokenUsage] = await Promise.all([
    Message.find({ owner, sessionId: id }).sort({ _id: -1 }).limit(100).lean(),
    Version.find({ owner, sessionId: id }).sort({ number: -1 }).limit(100).lean(),
    session.activeRunId ? Run.findOne({ _id: session.activeRunId, owner }).lean() : null,
    session.assistantId ? readAssistantSession(owner, String(session.assistantId)).catch(error => {
      if (error.status === 404) return null;
      throw error;
    }) : null,
    Run.find({ owner, sessionId: id }).sort({ _id: -1 }).limit(20).select('steps operations').lean(),
    Run.find({ owner, sessionId: id, deferred: true }).sort({ _id: -1 }).limit(30).select('input status createdAt').lean(),
    readAuthoringTokenUsage(owner, id)
  ]);
  // A saved plan edit uses the shared assistant endpoint. Reconcile only after
  // the previous authoring execution has finished; never interrupt a worker.
  if (session.status === 'needs_attention' && !session.currentVersionId
    && assistant?.status === 'awaiting_approval' && (!run || terminal.includes(run.status))) {
    const reconciled = await Session.updateOne({ _id: id, owner, revision: session.revision,
      status: 'needs_attention', activeRunId: session.activeRunId || null }, {
      $set: { status: 'awaiting_approval', error: '' }, $inc: { revision: 1 }
    });
    if (reconciled.modifiedCount && attempt < 2) return readAuthoringSession(owner, id, attempt + 1);
  }
  const latest = await Session.findOne({ _id: id, owner }).select('updatedAt');
  if (latest && +latest.updatedAt !== +session.updatedAt && attempt < 2) return readAuthoringSession(owner, id, attempt + 1);
  const nativeState = run?.result?.nativeActivity || await savedNativeActivity(session, owner);
  const nativeFailure = nativeState?.failure;
  const nativeDiagnosis = nativeFailure && nativeReviewFailureMessage({ code: nativeFailure.code, qualityFailureReason: nativeFailure.reason });
  // Diagnose a historical receipt without rewriting it. An older native
  // failure must never replace the error of a later, unrelated execution.
  const currentNativeError = run?.status === 'failed' && run.result?.nativeActivity?.failure
    && run.errorCode === nativeFailure?.code && nativeDiagnosis;
  return { id: String(session._id), title: session.title, courseId: String(session.courseId),
    quizId: session.quizId ? String(session.quizId) : null, materialIds: session.materialIds.map(String), objectiveIds: (session.objectiveIds || []).map(String), contextCourse: session.contextCourse === true,
    teachingRequirements: session.teachingRequirements, teachingBrief: assistant?.teachingBrief || session.teachingBrief || null,
    workflow: session.workflow ? { target: session.workflow.target, autoContinue: session.workflow.autoContinue,
      automaticContinuations: session.workflow.automaticContinuations || 0 } : null,
    nativePlan: session.nativePlan ? { version: session.nativePlan.version,
      revision: session.nativePlan.revision, status: session.nativePlan.status, library: session.nativePlan.library,
      title: session.nativePlan.title, brief: session.nativePlan.brief, materialIds: session.nativePlan.materialIds,
      objectiveIds: session.nativePlan.objectiveIds } : null,
    nativeGeneration: nativeState ? { phase: nativeState.phase, failure: nativeFailure ? { ...nativeFailure,
      message: nativeDiagnosis || nativeFailure.message } : null } : null,
    operations: pastRuns.flatMap(r => r.operations || []).sort((a, b) => +a.startedAt - +b.startedAt).slice(-200),
    instructions: session.instructions, autoApprove: session.autoApprove, mode: session.mode || 'build', revision: session.revision,
    queuedMessages: queued.reverse().map(r => ({ id: String(r._id), text: r.input.text, createdAt: r.createdAt, status: r.status === 'waiting' ? 'running' : r.status === 'interrupted' ? 'failed' : r.status })),
    status: session.status, error: currentNativeError || session.error || '', currentVersionId: session.currentVersionId ? String(session.currentVersionId) : null,
    candidateVersionId: session.candidateVersionId ? String(session.candidateVersionId) : null,
    messages: messages.reverse().map(m => ({ id: String(m._id), role: m.role, text: m.text, clarification: m.clarification || [], createdAt: m.createdAt })),
    versions: versions.map(versionSummary), assistant, tokenUsage: tokenUsage.task,
    taskSteps: pastRuns.flatMap(entry => (entry.steps || []).map(step => ({ name: step.name, createdAt: step.createdAt })))
      .sort((a, b) => +a.createdAt - +b.createdAt).slice(-100),
    run: run ? { id: String(run._id), status: run.status, checkpoint: run.checkpoint, steps: run.steps || [], error: currentNativeError || run.error, createdAt: run.createdAt, startedAt: run.startedAt, updatedAt: run.updatedAt,
      tokenUsage: tokenUsage.runs[String(run._id)] || summarizeModelTokenReceipts([], { recordingFailed: true }) } : null,
    updatedAt: session.updatedAt };
}

export async function listAuthoringSessions(owner) {
  const courses = await Folder.find({ instructor: owner }).select('_id');
  const sessions = await Session.find({ owner, courseId: { $in: courses.map(c => c._id) } }).sort({ updatedAt: -1 }).limit(50).lean();
  return sessions.map(s => ({ id: String(s._id), title: s.title, status: s.status, updatedAt: s.updatedAt }));
}

export async function createAuthoringSession(owner, body) {
  await Promise.all([Session.init(), Run.init(), Message.init()]);
  if (!requestId(body.requestId) || (body.quizId && !objectId(body.quizId))
    || (body.mode != null && !['explore', 'build'].includes(body.mode))
    || (body.instructions != null && (typeof body.instructions !== 'string' || body.instructions.length > 12000))) fail('Write a teaching idea or attach context to begin.', 400, 'AUTHORING_INPUT');
  const resolved = await resolveAuthoringContext(owner, body);
  const materials = resolved.materials;
  if (!body.instructions?.trim() && !materials.length && !resolved.objectives.length && !resolved.course) fail('Write a teaching idea or attach context to begin.', 400, 'AUTHORING_INPUT');
  const course = resolved.course || await ensureDraftCourse(owner);
  if (body.quizId && !await Quiz.exists({ _id: body.quizId, folder: course._id, createdBy: owner })) fail('Learning object not found in this course.', 404);
  const instructions = body.instructions?.trim() || (body.mode === 'explore'
    ? 'Explore teaching approaches using the attached context. Discuss possibilities and wait for an explicit request before building an activity.'
    : 'Propose learning objectives and an editable teaching plan from the attached context. Ask about missing teaching requirements.');
  const workflow = authoringWorkflowForRequest(null, instructions, body.requestId);
  const input = { courseId: String(course._id), quizId: body.quizId || null, materialIds: materials.map(m => String(m._id)).sort(),
    objectiveIds: resolved.objectives.map(lo => String(lo._id)).sort(), contextCourse: body.contextCourse === true,
    instructions, autoApprove: workflow.autoContinue, workflow, mode: body.mode || 'build' };
  const hash = digest(input);
  let session = await Session.findOne({ owner, requestId: body.requestId });
  const { workflow: _workflow, ...legacyInput } = input;
  const legacyHash = digest({ ...legacyInput, autoApprove: false });
  if (session && ![hash, legacyHash].includes(session.requestHash)) fail('This request ID belongs to a different task.');
  if (!session) {
    const title = (body.instructions?.trim() || `Learning activity · ${materials[0]?.name || course.name}`).slice(0, 90);
    try { session = await Session.create({ _id: stableId(`${owner}:${body.requestId}`), owner, requestId: body.requestId,
      requestHash: hash, ...input, mode: authoringModeForRequest(input.mode, body.instructions),
      teachingRequirements: updateTeachingRequirements(null, instructions, body.requestId), title }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      session = await Session.findOne({ owner, requestId: body.requestId });
      if (!session || ![hash, legacyHash].includes(session.requestHash)) fail('This request ID belongs to a different task.');
    }
  }
  await say(session, 'initial', 'user', instructions);
  if (!session.activeRunId && session.status === 'waiting_for_materials') {
    await enqueue(session, 'create', { requestId: body.requestId, revision: session.revision });
  }
  return readAuthoringSession(owner, String(session._id));
}

async function enqueue(session, kind, input) {
  validateCommand(input);
  await Run.init();
  const requestHash = digest({ sessionId: String(session._id), kind, input });
  let run = await Run.findOne({ owner: session.owner, requestId: input.requestId });
  if (run) {
    if (run.requestHash !== requestHash) fail('This request ID belongs to a different command.');
    if (run.admitted || terminal.includes(run.status)) return run;
    if (String(session.activeRunId || '') === String(run._id)) {
      await Run.updateOne({ _id: run._id }, { $set: { admitted: true } });
      return run;
    }
  }
  if (session.activeRunId) {
    const active = await Run.findById(session.activeRunId);
    if (active && !terminal.includes(active.status)) fail('Wait for the current task or stop it before sending another change.');
  }
  if (session.revision !== input.revision) fail('This task changed in another tab. Reload before continuing.');
  if (!run) try {
    run = await Run.create({ owner: session.owner, sessionId: session._id, requestId: input.requestId,
      requestHash, kind, input, tokenUsageVersion: 1, baseVersionId: session.currentVersionId });
  } catch (error) {
    if (error.code !== 11000) throw error;
    run = await Run.findOne({ owner: session.owner, requestId: input.requestId });
    if (!run || run.requestHash !== requestHash) fail('This request ID belongs to a different command.');
    return run;
  }
  const claimed = await Session.findOneAndUpdate({ _id: session._id, owner: session.owner, revision: input.revision,
    activeRunId: session.activeRunId || null }, { $set: { activeRunId: run._id, error: '', status: 'working' }, $inc: { revision: 1 } });
  if (!claimed) {
    await Run.updateOne({ _id: run._id }, { $set: { status: 'failed', error: 'The task changed before this command was accepted.' } });
    fail('The task changed before this command was accepted. Reload it.');
  }
  await Run.updateOne({ _id: run._id }, { $set: { admitted: true } });
  if (['message', 'save_objectives'].includes(kind)) await say(session, `user-${run._id}`, 'user', input.text, run._id);
  void tickAuthoringWorker();
  return run;
}

export async function authoringCommand(owner, id, kind, body) {
  const session = await ownedSession(owner, id);
  if (!['message', 'approve', 'retry', 'accept', 'reject', 'restore', 'save_objectives'].includes(kind)) fail('Unknown command.', 400);
  if (kind === 'save_objectives' && (!Array.isArray(body.objectives) || !body.objectives.length || body.objectives.length > 8
    || body.objectives.some(objective => typeof objective?.id !== 'string' || typeof objective.text !== 'string'
      || !objective.text.trim() || objective.text.trim().length > 500)
    || new Set(body.objectives.map(objective => objective.id)).size !== body.objectives.length)) {
    fail('Save the complete current objective list, with each text within 500 characters.', 400, 'AUTHORING_OBJECTIVES_INPUT');
  }
  let clarification;
  if (kind === 'message' && body.clarificationAnswers != null) {
    validateCommand(body);
    const prior = await Run.findOne({ owner, requestId: body.requestId });
    if (prior && (String(prior.sessionId) !== id || prior.kind !== 'message')) fail('This request ID belongs to a different command.');
    const card = objectId(body.clarificationAnswers?.messageId)
      ? await Message.findOne({ _id: body.clarificationAnswers.messageId, owner, sessionId: session._id }).lean() : null;
    clarification = canonicalClarificationAnswers(card, body.clarificationAnswers);
    if (!prior) {
      const latest = await Message.findOne({ owner, sessionId: session._id, role: 'assistant' }).sort({ _id: -1 }).select('_id').lean();
      if (String(latest?._id || '') !== clarification.clarificationAnswers.messageId || session.revision !== body.revision) {
        fail('These clarification choices are no longer current. Reload the task before confirming.', 409, 'AUTHORING_CLARIFICATION_STALE');
      }
    }
  }
  const text = clarification?.text ?? body.text;
  if (kind === 'message' && (typeof text !== 'string' || !text.trim() || text.length > 4000)) fail('Write a message of 1–4,000 characters.', 400);
  if (kind === 'message' && ((body.delivery != null && body.delivery !== 'queue') || (body.mode != null && !['explore', 'build'].includes(body.mode)))) fail('Choose a supported message delivery and teaching phase.', 400);
  if (['accept', 'reject', 'restore'].includes(kind) && !objectId(body.versionId)) fail('Choose a saved version.', 400);
  if (kind === 'approve' && session.status !== 'awaiting_approval' && !await Run.exists({ owner, requestId: body.requestId })) fail('There is no current teaching plan to approve.');
  if (kind === 'message' && body.context) await resolveAuthoringContext(owner, body.context);
  // Only the server chooses which previous execution a retry may resume.
  const input = { requestId: body.requestId, revision: body.revision,
    ...(kind === 'message' ? { text: text.trim(), ...(clarification ? { clarificationAnswers: clarification.clarificationAnswers } : {}), ...(body.mode ? { mode: body.mode } : {}), ...(body.delivery ? { delivery: body.delivery } : {}), ...(body.context ? { context: { courseId: body.context.courseId || null, materialIds: body.context.materialIds || [], objectiveIds: body.context.objectiveIds || [], contextCourse: body.context.contextCourse === true } } : {}) } : {}),
    ...(['accept', 'reject', 'restore'].includes(kind) ? { versionId: body.versionId } : {}),
    ...(kind === 'approve' ? { planRevision: body.planRevision } : {}) };
  if (kind === 'save_objectives') {
    input.objectives = body.objectives.map(objective => ({ id: objective.id, text: objective.text.trim() })).sort((left, right) => left.id.localeCompare(right.id));
    const prior = await Run.findOne({ owner, requestId: body.requestId }).select('kind input.text').lean();
    input.text = prior?.kind === 'save_objectives' ? prior.input.text
      : `Update learning objectives as follows, keeping their material scope and exclusions.\n${input.objectives.map((objective, index) => `${index + 1}. ${objective.text}`).join('\n')}`;
    if (body.assistantRevision != null) {
      if (!Number.isInteger(body.assistantRevision) || body.assistantRevision < 0) fail('Reload the current objective proposal before editing.', 400, 'AUTHORING_OBJECTIVES_INPUT');
      input.assistantRevision = body.assistantRevision;
    }
  }
  if (kind === 'retry') {
    const priorRequest = await Run.findOne({ owner, requestId: body.requestId });
    if (priorRequest) input.resumeRunId = priorRequest.input?.resumeRunId;
    else if (session.activeRunId) {
      const previous = await Run.findOne({ _id: session.activeRunId, owner, sessionId: session._id });
      // A successful discussion can leave a batch needing attention. Resume
      // generation rather than replaying that already answered message.
      if (previous && ['failed', 'interrupted', 'cancelled'].includes(previous.status)) input.resumeRunId = String(previous._id);
    }
  }
  if (kind === 'message' && (body.delivery === 'queue' || session.pendingRunIds?.length)) {
    await queueAuthoringMessage(session, input);
    void tickAuthoringWorker();
  } else await enqueue(session, kind, input);
  return readAuthoringSession(owner, id);
}

export async function cancelAuthoringRun(owner, id, body) {
  const session = await ownedSession(owner, id);
  if (!Number.isInteger(body.revision) || session.revision !== body.revision) fail('Reload the current task before stopping it.');
  const stopped = await Session.updateOne({ _id: id, owner, revision: body.revision }, { $set: { pendingRunIds: [] }, $inc: { revision: 1 } });
  if (!stopped.modifiedCount) fail('The task changed before it could be stopped. Reload it.');
  await Run.updateMany({ _id: { $in: session.pendingRunIds || [] }, owner, sessionId: id, admitted: false, status: 'queued' },
    { $set: { status: 'cancelled', cancelRequested: true } });
  if (session.activeRunId) {
    await Run.updateOne({ _id: session.activeRunId, owner, status: { $nin: terminal } }, { $set: { cancelRequested: true } });
    activeControllers.get(String(session.activeRunId))?.abort();
    if (session.assistantId) await LegacySession.updateOne({ _id: session.assistantId, owner, status: { $in: ['planning', 'generating'] } },
      { $set: { status: 'interrupted', error: 'Stopped by the author. Saved work is preserved.' } });
  }
  return readAuthoringSession(owner, id);
}

async function contextualTeachingBrief(session, answers) {
  const context = await resolveAuthoringContext(String(session.owner), { courseId: String(session.courseId), objectiveIds: (session.objectiveIds || []).map(String) });
  return [effectiveTeachingBrief(session, answers), session.contextCourse ? `REFERENCED COURSE (context data): ${JSON.stringify({ name: context.course.name, description: String(context.course.description || '').slice(0, 1500) })}` : '',
    context.objectives.length ? `REFERENCED LEARNING OBJECTIVES (context data): ${JSON.stringify(context.objectives.map(lo => lo.text)).slice(0, 4500)}` : ''].filter(Boolean).join('\n\n').slice(0, 12000);
}

async function teachingHistory(session, owner) {
  const pending = await Run.find({ sessionId: session._id, owner, deferred: true,
    $or: [{ admitted: false }, { status: 'cancelled' }] }).select('_id').lean();
  // A queued instruction becomes model context only after its turn is claimed.
  // It remains visible in the conversation while waiting for its safe boundary.
  return Message.find({ sessionId: session._id, owner, runId: { $nin: pending.map(run => run._id) } })
    .sort({ _id: -1 }).limit(12).lean();
}

async function perform(run, session, guard, checkpoint, signal) {
  const owner = String(session.owner);
  const user = userFor(owner);
  const id = String(session._id);
  const patch = async values => { await guard(); return Session.updateOne({ _id: session._id, activeRunId: run._id }, { $set: values }); };
  const message = async (text, clarification = []) => { await guard(); return say(session, `result-${run._id}`, 'assistant', text, run._id, clarification); };
  const current = session.currentVersionId ? await Version.findOne({ _id: session.currentVersionId, owner, sessionId: session._id }) : null;
  if (run.kind === 'message') {
    const spec = updateTeachingRequirements(session.teachingRequirements, run.input.text, run.input.requestId);
    const workflow = authoringWorkflowForRequest(session.workflow, run.input.text, run.input.requestId,
      { clarification: !!run.input.clarificationAnswers });
    await patch({ teachingRequirements: spec, workflow, autoApprove: workflow.autoContinue });
    Object.assign(session, { teachingRequirements: spec, workflow, autoApprove: workflow.autoContinue });
    const mode = authoringModeForRequest(session.mode, run.input.text, run.input.mode);
    if (mode !== session.mode) { await patch({ mode }); session.mode = mode; }
  }
  if (run.kind === 'message' && run.input.context && run.checkpoint === 'start') {
    const resolved = await resolveAuthoringContext(owner, run.input.context);
    const context = { courseId: String(resolved.course?._id || session.courseId), materialIds: resolved.materials.map(m => m._id),
      objectiveIds: resolved.objectives.map(lo => lo._id), contextCourse: run.input.context.contextCourse };
    if (current && String(context.courseId) !== String(session.courseId)) fail('Start a new conversation to use a different course with a saved activity.');
    const changed = digest([context.courseId, context.materialIds.map(String).sort(), context.objectiveIds.map(String).sort(), context.contextCourse]) !== digest([String(session.courseId), session.materialIds.map(String).sort(), (session.objectiveIds || []).map(String).sort(), session.contextCourse]);
    if (changed) {
      const values = { ...context, ...(!current ? { assistantId: null, quizId: null, nativePlan: null, requirementsReady: false } : {}) };
      await patch(values); Object.assign(session, values);
      await checkpoint('context_attached');
    }
  }
  if (run.kind === 'message' && !current && session.assistantId && session.workflow?.target === 'questions') {
    const previousObjectives = await readAssistantSession(owner, String(session.assistantId));
    if (previousObjectives.status === 'objectives_ready') {
      await patch({ assistantId: null, requirementsReady: false }); session.assistantId = null; session.requirementsReady = false;
      await Run.updateOne({ _id: run._id, owner, sessionId: session._id }, { $set: { continuePlanning: true } });
      run.continuePlanning = true;
    }
  }
  let previous = null, planningReceipt = null;
  if (run.kind === 'retry' && run.input.resumeRunId) {
    previous = await Run.findOne({ _id: run.input.resumeRunId, owner, sessionId: session._id });
    let depth = 0;
    while (previous) {
      if (!planningReceipt && previous.agentState && !previous.result?.nativeActivity) planningReceipt = previous;
      if (previous.kind !== 'retry' || !previous.input?.resumeRunId || depth++ >= 10) break;
      previous = await Run.findOne({ _id: previous.input.resumeRunId, owner, sessionId: session._id });
    }
  }
  // Resume the explicitly failed planning request before considering an older
  // native generation. A successful discussion has no failed-run pointer and
  // still falls back to the exact saved native draft or packaging response.
  if (run.kind === 'retry' && !planningReceipt && !current && ['generating', 'generated'].includes(session.nativePlan?.status)) {
    run.nativeActivityState = await savedNativeActivity(session, owner);
  }
  if (run.kind === 'retry' && run.input.resumeRunId && !run.nativeActivityState) {
    if (previous?.kind === 'manual') fail('Return to the advanced editor and save again to retry that manual edit.');
    if (previous?.kind === 'message' && String(previous.baseVersionId || '') !== String(session.currentVersionId || '')) {
      fail('The accepted activity changed after that request. Send a new instruction against its current version.');
    }
    if (previous?.checkpoint === 'output_saved' && previous.result) return finishCandidate(run, session, previous.result, guard);
    const resumesRequirements = previous?.kind === 'message' && (previous.continuePlanning
      || (session.requirementsReady && (session.requirementAnswers || []).some(answer => answer.requestId === previous.input?.requestId)));
    if (resumesRequirements || (previous?.kind === 'create' && previous.continuePlanning)) run.continuePlanning = true;
    if (previous && !run.continuePlanning && ['create', 'message', 'accept', 'reject', 'restore', 'save_objectives'].includes(previous.kind)) {
      return perform({ ...run.toObject(), _id: run._id, kind: previous.kind, input: previous.input,
        agentState: canResumeAuthoringAgent(planningReceipt || previous) ? (planningReceipt || previous).agentState : undefined,
        questionRevisionState: previous.result?.questionRevision, explicitQuestionResume: !!previous.result?.questionRevision,
        nativeActivityState: previous.result?.nativeActivity, explicitNativeResume: !!previous.result?.nativeActivity,
        nativeTeachingState: previous.nativeTeachingState, partialBaseline: previous.partialBaseline,
        nativeObjectiveEdit: previous.nativeObjectiveEdit, explicitTeachingResume: true }, session, guard, checkpoint, signal);
    }
  }
  const prepareRequirements = async (materials, latestAnswer) => {
    if (session.quizId && !await Quiz.exists({ _id: session.quizId, folder: session.courseId, createdBy: owner })) fail('Learning object not found in this course.', 404);
    const answers = [...(session.requirementAnswers || [])];
    if (latestAnswer && !answers.some(answer => answer.requestId === run.input.requestId)) {
      answers.push({ requestId: run.input.requestId, text: latestAnswer });
    }
    const alreadyChecked = session.requirementsReady && (!latestAnswer || (session.requirementAnswers || []).some(answer => answer.requestId === run.input.requestId));
    if (alreadyChecked) return true;
    const brief = await contextualTeachingBrief(session, answers);
    let materialSamples = [];
    if (materials.length && (!session.teachingRequirements?.countIssue || session.workflow?.target === 'objectives')) {
      const memo = await loadAuthoringTaskContext(session, { userId: owner, latestRequest: latestAnswer || session.instructions,
        requestId: run.input?.requestId, signal, guard });
      materialSamples = await authoringOperation('prepare_requirement_evidence', 'Use selected material readings for teaching scope',
        async () => sampleRequirementMaterials(materials.filter(material => !authoringMaterialExcluded(session, material, latestAnswer || session.instructions)),
          { userId: owner, observations: memo.observations }),
        samples => `Used verified readings and bounded text samples from ${samples.filter(sample => sample.readStatus === 'sampled').length} selected materials. Full topic coverage is checked during learning-objective planning.`);
      const scopeHash = authoringScopeHash(session);
      const observations = materialSamples.flatMap(sample => sample.spans.filter(span => span.obtainedFrom === 'extracted-text-sample').map(span => ({ tool: 'read_material', scopeHash,
        arguments: { materialId: sample.material.id, offset: span.offset, length: span.text.length },
        result: { material: sample.material, offset: span.offset, text: span.text, totalCharacters: sample.totalCharacters,
          nextOffset: span.end < sample.totalCharacters ? span.end : null,
          summary: `Read a bounded text sample from ${sample.material.name}.` } })));
      const taskContext = mergeAuthoringTaskContext(memo, session, run, { observations }, latestAnswer || session.instructions,
        { observationNamespace: 'requirement-samples' });
      await patch({ taskContext }); session.taskContext = taskContext;
    }
    await checkpoint('clarify_requirements');
    const assessment = session.workflow?.target !== 'objectives' && session.teachingRequirements?.countIssue ? { ready: false, reply: session.teachingRequirements.countIssue, clarification: [{ question: 'How many questions should this activity contain?', options: ['5 questions', '10 questions', '15 questions'] }] } : await authoringOperation('clarify_requirements', 'Check teaching requirements', () => assessAuthoringRequirements({ instructions: brief, materials, materialSamples, userId: owner, signal, workflowTarget: session.workflow?.target }));
    const spec = updateTeachingRequirements(session.teachingRequirements, latestAnswer || session.instructions, run.input?.requestId || run.requestId, assessment.requirements, assessment.clarification.map(q => q.question));
    await guard();
    await patch({ teachingRequirements: spec, requirementAnswers: answers, requirementsReady: assessment.ready, error: '',
      status: assessment.ready ? 'planning' : 'awaiting_requirements' });
    session.teachingRequirements = spec;
    session.requirementAnswers = answers;
    session.requirementsReady = assessment.ready;
    if (!assessment.ready) await message(assessment.reply, assessment.clarification);
    return assessment.ready;
  };
  if (run.kind === 'save_objectives' && run.nativeObjectiveEdit && !current) {
    const receipt = run.nativeObjectiveEdit;
    const currentPlanHash = digest({ ...session.nativePlan, status: 'generating' });
    if (![receipt.sourcePlanHash, digest({ ...receipt.plan, status: 'generating' })].includes(currentPlanHash)) {
      fail('The activity plan changed after the objective edit. Review its latest goals before continuing.', 409, 'AUTHORING_CONTRACT_CHANGED');
    }
    await validateNativeSourceContract({ session, contract: { ...receipt.plan, version: 1, kind: 'initial', baseVersionId: null } });
    await patch({ nativePlan: receipt.plan, teachingBrief: receipt.teachingBrief,
      status: receipt.plan.status === 'generating' ? 'generating' : 'awaiting_approval' });
    session.nativePlan = receipt.plan; session.teachingBrief = receipt.teachingBrief;
    if (receipt.plan.status !== 'generating') { await message('Saved your activity learning objectives. Review the updated activity plan before generating.'); return true; }
  }
  if (run.kind === 'save_objectives' && !run.continuePlanning && !run.nativeObjectiveEdit) {
    if (session.candidateVersionId) fail('Accept or keep the current proposal before editing objectives.');
    if (current?.representation === 'native-fork' || (!current && session.nativePlan && !session.assistantId)) {
      const brief = current?.teachingBrief || session.teachingBrief;
      const sources = current?.nativeTeachingSources || session.nativePlan?.teachingSources || [];
      const teachingBrief = reviseNativeTeachingObjectives({ brief, objectives: run.input.objectives,
        trustedSources: sources, materialIds: session.materialIds });
      if (!teachingBrief.objectives.some((objective, index) => objective.text !== brief.objectives[index].text)) {
        fail('Change an objective before saving.', 400, 'AUTHORING_OBJECTIVES_UNCHANGED');
      }
      if (current) {
        const template = await readNative(current.contentId, owner);
        const plan = await proposeNativeActivityRevision({ session, current, template, latestRequest: run.input.text });
        plan.instructions = replaceNativeLearningGoals(plan.instructions, teachingBrief.objectives);
        plan.teachingBrief = teachingBrief;
        const output = await buildNativeActivityCandidate({ session, run, plan, guard, checkpoint, signal,
          resumeState: run.result?.nativeActivity, explicitResume: run.explicitNativeResume === true });
        Object.assign(output, { teachingBrief, nativeTeachingSources: sources });
        await checkpoint('output_saved', { ...output, ...(run.result?.nativeActivity ? { nativeActivity: run.result.nativeActivity } : {}) });
        return finishCandidate(run, session, output, guard);
      }
      await validateNativeSourceContract({ session, contract: { ...session.nativePlan, version: 1, kind: 'initial', baseVersionId: null } });
      const plan = await proposeNativeActivityPlan({ session, library: session.nativePlan.library, latestRequest: run.input.text,
        revision: session.revision + 1 });
      plan.instructions = replaceNativeLearningGoals(plan.instructions, teachingBrief.objectives);
      plan.teachingBrief = teachingBrief; plan.teachingSources = sources;
      if (session.workflow?.target === 'native' && session.workflow.autoContinue) plan.status = 'generating';
      const receipt = { teachingBrief, plan, sourcePlanHash: digest({ ...session.nativePlan, status: 'generating' }) };
      await Run.updateOne({ _id: run._id, owner, sessionId: session._id }, { $set: { nativeObjectiveEdit: receipt } });
      run.nativeObjectiveEdit = receipt;
      await patch({ teachingBrief, nativePlan: plan, status: plan.status === 'generating' ? 'generating' : 'awaiting_approval' });
      session.teachingBrief = teachingBrief; session.nativePlan = plan;
      await checkpoint('native_objectives_edited');
      if (plan.status === 'generating') return false;
      await message('Saved your activity learning objectives. Review the updated activity plan before generating.'); return true;
    }
    const assistant = session.assistantId ? await readAssistantSession(owner, String(session.assistantId)) : null;
    const objectiveCommit = assistant && (await LegacySession.exists({ _id: assistant.id, owner, 'objectiveEditReceipt.requestId': run.input.requestId })
      || await Quiz.exists({ _id: session.quizId, createdBy: owner, 'objectiveEditReceipt.requestId': run.input.requestId }));
    if (run.input.assistantRevision != null && assistant?.revision !== run.input.assistantRevision && !run.result?.objectivesSaved && !objectiveCommit) {
      fail('The objective proposal changed. Reload it before saving.');
    }
    const course = !current && session.quizId ? await readCourseSnapshot(session) : null;
    const baseline = current || run.partialBaseline || (course?.snapshot.questions.length ? {
      _id: stableId(`partial-${id}-${course.fingerprint}`), snapshot: course.snapshot, fingerprint: course.fingerprint,
      representation: 'course-linked' } : null);
    if (baseline?.representation === 'course-linked') {
      const edited = validateObjectiveEdits(run.input.objectives, baseline.snapshot.learningObjectives);
      const before = new Map(baseline.snapshot.learningObjectives.map(objective => [String(objective._id || objective.id), objective.text]));
      const updates = edited.filter(objective => objective.text !== before.get(objective.id)).map(objective => ({ objectiveId: objective.id, text: objective.text }));
      if (!updates.length) fail('Change an objective before saving.', 400, 'AUTHORING_OBJECTIVES_UNCHANGED');
      if (!current && !run.partialBaseline) {
        await Run.updateOne({ _id: run._id, owner, sessionId: session._id }, { $set: { partialBaseline: baseline } });
        run.partialBaseline = baseline;
        await checkpoint('objectives_baseline_saved');
        await patch({ publishedFingerprint: course.fingerprint }); session.publishedFingerprint = course.fingerprint;
      }
      const target = session.teachingRequirements?.fields?.questionCount?.value
        ?? assistant?.plan.reduce((total, row) => total + row.count, 0) ?? baseline.snapshot.questions.length;
      const output = await runCourseQuestionRevision({ session, run, current: baseline, latestRequest: run.input.text,
        decision: { action: 'revise_questions', questionIndices: [], targetQuestionCount: target,
          objectiveChanges: { authorizationQuote: 'Update learning objectives as follows, keeping their material scope and exclusions.', updates } },
        signal, guard, checkpoint, resumeState: run.result?.questionRevision, explicitResume: run.explicitQuestionResume === true,
        allowedQuestionTypes: getAssistantQuestionTypes().map(type => type.questionType) });
      if (output.ready === false) { await message(output.diagnostic.message, output.diagnostic.clarification); await patch({ status: current ? 'ready' : 'needs_attention' }); return true; }
      await checkpoint('output_saved', { ...output, ...(run.result?.questionRevision ? { questionRevision: run.result.questionRevision } : {}) });
      return finishCandidate(run, session, output, guard);
    }
    if (!assistant) fail('Wait for the learning-objective proposal before editing it.');
    const committed = objectiveCommit;
    const edited = committed || run.result?.objectivesSaved ? run.input.objectives : validateObjectiveEdits(run.input.objectives, assistant.objectives);
    if (!committed && !run.result?.objectivesSaved && !edited.some((objective, index) => objective.text !== assistant.objectives[index].text)) fail('Change an objective before saving.', 400, 'AUTHORING_OBJECTIVES_UNCHANGED');
    const saved = run.result?.objectivesSaved || await authoringOperation('save_objectives', 'Save the edited learning objectives', () => updateAssistantObjectives(user, assistant.id,
      { objectives: edited, revision: assistant.revision, assertActive: guard, requestId: run.input.requestId }));
    await Run.updateOne({ _id: run._id, owner, sessionId: session._id }, { $set: { result: { objectivesSaved: saved } } });
    run.result = { objectivesSaved: saved }; await checkpoint('objectives_saved', run.result);
    await patch({ teachingBrief: saved.teachingBrief, status: 'objectives_ready', error: '' }); session.teachingBrief = saved.teachingBrief;
    if (session.workflow?.target !== 'questions' || session.workflow.autoContinue !== true) {
      await message('Saved your learning objectives. Question planning and generation have not started.'); return true;
    }
    await patch({ assistantId: null, requirementsReady: true }); session.assistantId = null; session.requirementsReady = true;
    await Run.updateOne({ _id: run._id, owner, sessionId: session._id }, { $set: { continuePlanning: true } }); run.continuePlanning = true;
  }
  if (!current && session.nativePlan && (run.kind === 'approve'
    || (session.workflow?.target === 'native' && session.workflow.autoContinue === true && session.nativePlan.status === 'generating')
    || (run.kind === 'retry' && (session.nativePlan.status === 'generating' || run.nativeActivityState)))) {
    if (run.kind === 'approve' && (session.nativePlan.status !== 'awaiting_approval' || run.input.planRevision !== session.nativePlan.revision)) {
      fail('The native activity plan changed. Review and approve its latest version.');
    }
    const plan = { ...session.nativePlan, status: 'generating' };
    await patch({ nativePlan: plan, status: 'generating' }); session.nativePlan = plan;
    let resumeState = run.nativeActivityState;
    if (!resumeState && run.kind === 'retry' && run.input.resumeRunId) {
      const previous = await Run.findOne({ _id: run.input.resumeRunId, owner, sessionId: session._id });
      resumeState = previous?.result?.nativeActivity;
    }
    const output = await buildNativeActivityCandidate({ session, run, guard, checkpoint, signal,
      resumeState, explicitResume: run.kind === 'retry' || run.explicitNativeResume === true });
    output.teachingBrief = plan.teachingBrief || session.teachingBrief;
    output.nativeTeachingSources = plan.teachingSources || [];
    await checkpoint('output_saved', { ...output, ...(run.result?.nativeActivity ? { nativeActivity: run.result.nativeActivity } : {}) });
    await patch({ nativePlan: { ...plan, status: 'generated' } });
    return finishCandidate(run, session, output, guard);
  }
  if (['create', 'message', 'retry'].includes(run.kind) && !run.continuePlanning && !session.assistantId && !current) {
    const latest = run.kind === 'message' ? run.input.text : session.instructions;
    const history = await teachingHistory(session, owner);
    if (session.nativePlan) {
      const saved = await savedNativeActivity(session, owner);
      session.nativeFailure = saved?.failure || null;
    }
    const decision = await runAuthoringAgent({ session, run, latestRequest: latest, history, userId: owner, signal, guard, checkpoint,
      current: null, assistant: null, allowedQuestionTypes: getAssistantQuestionTypes().map(type => type.questionType) });
    const spec = updateTeachingRequirements(session.teachingRequirements, latest, run.input?.requestId || run.requestId,
      decision.requirements, decision.clarification?.map(item => item.question));
    await patch({ teachingRequirements: spec }); session.teachingRequirements = spec;
    const resolved = await resolveAuthoringContext(owner, { courseId: String(session.courseId),
      materialIds: decision.materialIds || session.materialIds.map(String), objectiveIds: decision.objectiveIds || (session.objectiveIds || []).map(String) });
    const context = { materialIds: resolved.materials.filter(material => !authoringMaterialExcluded(session, material, latest)).map(material => material._id),
      objectiveIds: resolved.objectives.map(objective => objective._id) };
    const taskContext = rebaseAuthoringTaskContext(session.taskContext, { ...session.toObject(), ...context }, session);
    await patch({ ...context, taskContext }); Object.assign(session, context, { taskContext });
    if (decision.action === 'build_native_plan') {
      if (resolved.materials.some(material => !isMaterialReady(material))) {
        await patch({ status: 'waiting_for_materials' }); return false;
      }
      const teachingBrief = await prepareNativeTeaching({ session, run, latestRequest: latest, guard, checkpoint, signal,
        explicitResume: run.explicitTeachingResume === true });
      await patch({ teachingBrief }); session.teachingBrief = teachingBrief;
      const nativePlan = await proposeNativeActivityPlan({ session, library: decision.library, latestRequest: latest, revision: session.revision + 1 });
      nativePlan.teachingBrief = teachingBrief;
      nativePlan.teachingSources = run.nativeTeachingState?.sources || [];
      nativePlan.instructions = replaceNativeLearningGoals(nativePlan.instructions, teachingBrief.objectives);
      const workflow = session.workflow?.activityAuthorization ? { ...session.workflow, target: 'native', autoContinue: true,
        authorization: session.workflow.activityAuthorization } : { ...session.workflow, target: 'native', autoContinue: false };
      if (workflow.autoContinue) nativePlan.status = 'generating';
      await patch({ nativePlan, workflow, status: workflow.autoContinue ? 'generating' : 'awaiting_approval', mode: 'build' });
      if (workflow.autoContinue) return false;
      await message(`${decision.reply}\n\n${nativePlan.title}: review the proposed native activity brief, then choose Accept plan & generate. This creates an independent Studio activity.`);
      return true;
    }
    if (decision.action !== 'build_plan') {
      if (decision.action !== 'reply') fail('Start by exploring your teaching idea or requesting an activity plan.', 422, 'AUTHORING_RESPONSE');
      await message(decision.reply, decision.clarification || []);
      const nativeStatus = session.nativePlan?.status === 'awaiting_approval' ? 'awaiting_approval'
        : await savedNativeActivity(session, owner) ? 'needs_attention' : null;
      await patch({ status: nativeStatus || (session.mode === 'explore' ? 'exploring' : 'awaiting_requirements') });
      return true;
    }
    await patch({ mode: 'build' }); session.mode = 'build';
    if (session.workflow?.activityAuthorization && session.workflow.questionGenerationAllowed) {
      const workflow = { ...session.workflow, target: 'questions', autoContinue: true, authorization: session.workflow.activityAuthorization };
      await patch({ workflow, autoApprove: true }); session.workflow = workflow;
    }
    if (session.nativePlan) { await patch({ nativePlan: null }); session.nativePlan = null; }
    const materials = await Material.find({ _id: { $in: session.materialIds }, folder: session.courseId, uploadedBy: owner });
    if (materials.length !== session.materialIds.length) fail('A selected material is no longer available.', 404);
    if (materials.some(m => m.processingStatus === 'failed')) fail('A material could not be processed. Retry it in Materials, then resume this task.');
    if (materials.some(m => !isMaterialReady(m))) { await patch({ status: 'waiting_for_materials' }); return false; }
    if (!await prepareRequirements(materials, run.kind === 'message' ? run.input.text : undefined)) return true;
    await guard();
    await Run.updateOne({ _id: run._id, owner, sessionId: session._id }, { $set: { continuePlanning: true } });
    run.continuePlanning = true;
  }
  if (['create', 'approve', 'retry'].includes(run.kind) || run.continuePlanning) {
    if (!session.assistantId) {
      const materials = await Material.find({ _id: { $in: session.materialIds }, folder: session.courseId, uploadedBy: owner });
      if (materials.length !== session.materialIds.length) fail('A selected material is no longer available.', 404);
      if (materials.some(m => m.processingStatus === 'failed')) fail('A material could not be processed. Retry it in Materials, then resume this task.');
      if (materials.some(m => !isMaterialReady(m))) { await patch({ status: 'waiting_for_materials' }); return false; }
      if (!await prepareRequirements(materials)) return true;
      await checkpoint('dispatch_planning');
      const instructions = await contextualTeachingBrief(session);
      const workflowTarget = session.workflow?.target === 'objectives' ? 'objectives' : 'questions';
      const assistant = await createAssistantSession(user, { requestId: `authoring-${id}-${digest({ courseId: session.courseId, materialIds: session.materialIds, objectiveIds: session.objectiveIds, instructions, workflowTarget }).slice(0, 12)}`, courseId: String(session.courseId),
        ...(session.quizId ? { quizId: String(session.quizId) } : {}), materialIds: session.materialIds.map(String), instructions,
        canonicalObjectives: session.materialIds.length > 0, promptBased: !session.materialIds.length, objectiveIds: (session.objectiveIds || []).map(String) },
        { teachingRequirements: session.teachingRequirements, workflowTarget });
      await guard();
      await patch({ assistantId: assistant.id, quizId: assistant.quizId, status: 'planning' });
      return false;
    }
    let assistant = await readAssistantSession(owner, String(session.assistantId));
    if (assistant.teachingBrief) { await patch({ teachingBrief: assistant.teachingBrief }); session.teachingBrief = assistant.teachingBrief; }
    if (run.kind === 'retry' && ['failed', 'interrupted'].includes(assistant.status) && run.checkpoint === 'start') {
      await checkpoint('dispatch_retry');
      assistant = await resumeAssistantSession(user, assistant.id, { requestId: `retry-${run._id}`, revision: assistant.revision });
    }
    if (assistant.status === 'awaiting_approval') {
      if (run.kind === 'approve' || (session.workflow?.autoContinue === true && session.workflow?.target === 'questions'
        && session.workflow.authorization?.quote && session.mode !== 'explore')) {
        if (run.kind === 'approve' && run.input.planRevision !== assistant.revision) fail('The teaching plan changed. Review and approve the latest plan.');
        const reconciled = reconcileQuestionCount(assistant.plan || [], session.teachingRequirements);
        if (reconciled.some((row, index) => row.count !== assistant.plan[index].count)) fail('The plan no longer matches your requested question count. Revise and review it before approval.');
        await checkpoint('dispatch_approval');
        assistant = await approveAssistantPlan(user, assistant.id, { revision: assistant.revision, requestId: `approve-${run._id}` });
        await patch({ status: 'generating' });
        return false;
      }
      await patch({ status: 'awaiting_approval' });
      await message(`I proposed ${assistant.plan.reduce((total, row) => total + row.count, 0)} questions across ${assistant.objectives.length} learning objectives. What audience, difficulty or question count would you like? Review Teaching plan and tell me what to change, or choose Accept plan & generate to use this proposal.`);
      return true;
    }
    if (assistant.status === 'objectives_ready') {
      await patch({ status: 'objectives_ready', error: '' });
      await message('Your learning objectives are ready to review and edit. Question planning and generation have not started. Ask for questions when you want to continue.');
      return true;
    }
    if (['failed', 'interrupted'].includes(assistant.status)) {
      const pending = session.workflow?.pendingContinuation;
      const replayPending = pending?.runId === String(run._id) && pending.revision === assistant.revision
        && pending.questionJobRequestId === assistant.currentJobId;
      const continuation = replayPending ? pending.decision : automaticContinuationDecision(session.workflow, assistant);
      if (continuation?.allowed && assistant.status === 'failed') {
        const attempt = replayPending ? pending.attempt : (session.workflow.automaticContinuations || 0) + 1;
        const receipt = replayPending ? pending : { runId: String(run._id), revision: assistant.revision,
        questionJobRequestId: assistant.currentJobId, attempt, decision: continuation };
        const workflow = { ...session.workflow, automaticContinuations: attempt, pendingContinuation: receipt };
        await patch({ workflow, status: 'generating', error: '' }); session.workflow = workflow;
        await checkpoint('dispatch_automatic_continuation', { automaticContinuation: receipt });
        if (continuation.kind === 'restore-material-search') {
          const rag = (await import('../ragService.js')).default;
          await rag.initialize();
          for (const materialId of session.materialIds.map(String)) {
            await guard();
            try { await rag.assertMaterialsIndexed([materialId], { userId: owner, assertActive: guard }); }
            catch (error) {
              if (error.code !== 'MATERIAL_INDEX_MISSING') throw error;
              await authoringOperation('restore_material_search', 'Restore material search',
                () => restoreMaterialIndex({ materialId, userId: owner, assertActive: guard }));
            }
          }
        }
        await authoringOperation('continue_question_generation', continuation.kind === 'restore-material-search'
          ? 'Continue after restoring material search' : 'Repair the remaining checked failures',
        () => resumeAssistantSession(user, assistant.id, { requestId: `auto-${run._id}-${attempt}`, revision: receipt.revision }));
        await patch({ status: 'generating' });
        return false;
      }
      await message(assistantRecoveryMessage(assistant));
      fail(assistant.error || 'Generation stopped. Review the saved progress before retrying.');
    }
    if (assistant.status === 'completed') {
      session.quizId = assistant.quizId;
      const course = await readCourseSnapshot(session);
      const expected = session.teachingRequirements?.fields?.questionCount?.value
        ?? assistant.plan.reduce((total, row) => total + row.count, 0);
      if (session.workflow?.target === 'questions' && course.snapshot.questions.length !== expected) {
        fail(`The requested set contains ${expected} questions, but only ${course.snapshot.questions.length} checked questions are saved. The task remains incomplete.`,
          422, 'AUTHORING_INCOMPLETE');
      }
      const version = await createVersion({ session, run, snapshot: course.snapshot, sourceFingerprint: course.h5pFingerprint, title: course.snapshot.name,
        summary: 'Initial activity generated from the approved teaching plan.', changes: ['Created evidence-linked questions and H5P activity'], assertActive: guard });
      await acceptVersion(session, version, run, guard);
      await message('Your activity is ready. Try it in Preview, inspect the sources, or download the H5P package. Tell me what you would like to change; revisions are proposed before they replace this version.');
      return true;
    }
    await patch({ status: assistant.status === 'generating' ? 'generating' : 'planning' });
    return false;
  }

  if (['accept', 'reject', 'restore'].includes(run.kind)) {
    const version = await Version.findOne({ _id: run.input.versionId, sessionId: session._id, owner });
    if (!version) fail('Version not found.', 404);
    if (run.kind === 'accept' && String(session.currentVersionId || '') === String(version._id)) {
      await Version.updateOne({ _id: version._id, owner }, { $set: { state: 'accepted' } });
      await patch({ status: 'ready', candidateVersionId: null });
      await message(`Version ${version.number} is accepted.`);
      return true;
    }
    if (run.kind === 'restore') {
      if (session.candidateVersionId) fail('Accept or keep the current version before restoring another version.');
      if (version.state !== 'accepted') fail('Only an accepted version can be restored.');
      await checkpoint('restoring');
      const restored = await createVersion({ session, run, snapshot: version.snapshot,
        document: await cloneDocument(version.contentId, owner), representation: version.representation,
        teachingBrief: version.teachingBrief, nativeTeachingSources: version.nativeTeachingSources,
        restoredFromId: version._id, title: version.title, summary: `Restored version ${version.number}.`,
        changes: [`Restored content from version ${version.number}`], assertActive: guard });
      await acceptVersion(session, restored, run, guard);
      await message(`Restored version ${version.number} as a new version. Your previous versions remain in Version history.`);
    } else {
      if (String(session.candidateVersionId || '') !== String(version._id)
        || (version.state !== 'candidate' && !(run.kind === 'reject' && version.state === 'rejected'))) fail('This proposal is no longer awaiting a decision.');
      if (run.kind === 'accept') {
        await checkpoint('committing');
        await acceptVersion(session, version, run, guard);
        await message(`Accepted version ${version.number}. ${version.representation === 'native-fork' ? 'This is an independent Studio version; the course questions are unchanged.' : 'The linked course questions and H5P now use this version.'}`);
      } else {
        await Version.updateOne({ _id: version._id, owner }, { $set: { state: 'rejected' } });
        await patch({ candidateVersionId: null, status: 'ready' });
        await message('Kept your current version. The proposed changes were not applied.');
      }
    }
    return true;
  }

  if (session.candidateVersionId) fail('Accept or keep the current version before requesting another change.');
  const assistant = session.assistantId ? await readAssistantSession(owner, String(session.assistantId)) : null;
  if (!current && !canReviseAssistantPlan(assistant)) fail('Wait for the teaching plan before sending changes.');
  const history = await teachingHistory(session, owner);
  const allowedQuestionTypes = getAssistantQuestionTypes().map(type => type.questionType);
  const rawDecision = await runAuthoringAgent({ session, run, latestRequest: run.input.text, history, userId: owner, signal, guard, checkpoint,
    current, assistant, allowedQuestionTypes });
  await guard();
  const decision = parseDecision(rawDecision, current?.snapshot?.questions?.length || 0, allowedQuestionTypes, run.input.text);
  const spec = updateTeachingRequirements(session.teachingRequirements, run.input.text, run.input.requestId, rawDecision.requirements, Array.isArray(rawDecision.clarification) ? rawDecision.clarification.map(q => q?.question) : undefined);
  await patch({ teachingRequirements: spec }); session.teachingRequirements = spec;
  const questionRevisionState = run.questionRevisionState || run.result?.questionRevision;
  const nativeActivityState = run.nativeActivityState || run.result?.nativeActivity;
  await checkpoint('decision_saved', questionRevisionState || nativeActivityState ? { decision,
    ...(questionRevisionState ? { questionRevision: questionRevisionState } : {}),
    ...(nativeActivityState ? { nativeActivity: nativeActivityState } : {}) } : decision);
  if (decision.action === 'reply') {
    await message(decision.reply, decision.clarification);
    await patch({ status: current ? 'ready' : assistant?.status === 'failed' ? 'needs_attention' : assistant?.status === 'objectives_ready' ? 'objectives_ready' : 'awaiting_approval',
      error: assistant?.status === 'failed' ? assistant.error || '' : '' });
    return true;
  }
  if (decision.action === 'revise_plan' || decision.action === 'revise_objectives') {
    if (current || !canReviseAssistantPlan(assistant)) fail('The plan cannot be changed in this state.');
    await checkpoint('model_call');
    const materials = await Material.find({ _id: { $in: session.materialIds }, folder: session.courseId, uploadedBy: owner });
    const context = materials.length ? await buildAssistantContext(materials, { userId: owner, signal }) : { context: 'Brainstorming from the instructor brief and selected objectives. No source evidence was supplied.' };
    const objectives = decision.action === 'revise_objectives' ? await proposeAssistantObjectives({ instructions: `${effectiveTeachingBrief(session)}\nLatest revision: ${run.input.text}`, context: context.context, sources: context.sources || [], userId: owner, signal, promptBased: !materials.length }) : assistant.objectives;
    if (session.workflow?.target === 'objectives') {
      if (decision.action !== 'revise_objectives') fail('Ask to generate questions before changing a question plan.', 422, 'AUTHORING_RESPONSE');
      const saved = await authoringOperation('save_objectives', 'Save the revised learning objectives', () => updateAssistantObjectives(user, assistant.id,
        { revision: assistant.revision, objectives, requestId: run.input.requestId, assertActive: guard }));
      await patch({ teachingBrief: saved.teachingBrief, status: 'objectives_ready', error: '' });
      await message('I revised the learning objectives. You can edit them here; question planning and generation have not started.'); return true;
    }
    const proposed = await proposeAssistantPlan({ instructions: effectiveTeachingBrief(session), currentPlan: assistant.plan, revisionRequest: run.input.text,
      objectives, context: context.context, sources: assistant.sources || context.sources || [], teachingBrief: assistant.teachingBrief,
      targetQuestionCount: session.teachingRequirements?.fields?.questionCount?.value, userId: owner, signal });
    const plan = proposed.some(row => row.questionTasks) ? proposed : reconcileQuestionCount(proposed, session.teachingRequirements);
    await guard();
    await updateAssistantPlan(user, assistant.id, { revision: assistant.revision, objectives, plan }, { teachingRequirements: session.teachingRequirements });
    if (session.workflow?.target === 'questions' && session.workflow.autoContinue) {
      await Run.updateOne({ _id: run._id, owner, sessionId: session._id }, { $set: { continuePlanning: true } });
      run.continuePlanning = true; await patch({ status: 'planning', error: '' }); return false;
    }
    await patch({ status: 'awaiting_approval', error: '' });
    await message(decision.action === 'revise_objectives' ? 'I revised the learning objectives and their question plan. Open the proposal to review or edit it before generating questions.' : 'I updated the proposed question plan. Review the quantities, types and instructions before accepting it.');
    return true;
  }
  if (!current) fail('Generate the first activity before requesting a content revision.');
  let snapshot;
  let document;
  let representation;
  let changes;
  let authoringSourceContract;
  if (['revise_question', 'revise_questions'].includes(decision.action) && current.representation === 'course-linked') {
    const batchDecision = decision.action === 'revise_question' ? { action: 'revise_questions', questionIndices: [decision.questionIndex],
      ...(decision.questionType ? { questionType: decision.questionType } : {}), ...(decision.difficulty ? { difficulty: decision.difficulty } : {}),
      ...(decision.selectionMode ? { selectionMode: decision.selectionMode } : {}) } : decision;
    const output = await runCourseQuestionRevision({ session, run, current, decision: batchDecision, latestRequest: run.input.text,
      signal, guard, checkpoint, resumeState: questionRevisionState, explicitResume: run.explicitQuestionResume === true, allowedQuestionTypes });
    if (output.ready === false) {
      await message(output.diagnostic.message, output.diagnostic.clarification);
      await patch({ status: 'ready', error: '' }); return true;
    }
    ({ snapshot, document, representation, changes, authoringSourceContract } = output);
  } else {
    if (decision.action === 'revise_questions') fail('Batch question changes require a course-linked activity. Use a native activity revision for this version.', 422, 'AUTHORING_RESPONSE');
    const template = await readNative(current.contentId, owner);
    const plan = nativeActivityState?.plan || await proposeNativeActivityRevision({ session, current, template,
      latestRequest: run.input.text });
    if (plan.latestRequest !== run.input.text) fail('The saved native revision belongs to another instructor request.', 409, 'AUTHORING_CONTRACT_CHANGED');
    const output = await buildNativeActivityCandidate({ session, run, plan, guard, checkpoint, signal,
      resumeState: nativeActivityState, explicitResume: run.explicitNativeResume === true });
    output.teachingBrief = current.teachingBrief || session.teachingBrief;
    output.nativeTeachingSources = current.nativeTeachingSources || session.nativePlan?.teachingSources || [];
    await checkpoint('output_saved', { ...output, ...(run.result?.nativeActivity ? { nativeActivity: run.result.nativeActivity } : {}) });
    return finishCandidate(run, session, output, guard);
  }
  await guard();
  // Persist generated output before packaging so a runtime failure can recover
  // without purchasing the model call again.
  await checkpoint('output_saved', { snapshot, document, representation, changes, authoringSourceContract,
    ...(run.result?.questionRevision ? { questionRevision: run.result.questionRevision } : {}) });
  return finishCandidate(run, session, { snapshot, document, representation, changes, authoringSourceContract }, guard);
}

async function finishCandidate(run, session, output, guard) {
  if (output.representation === 'course-linked') {
    await validateAuthoringSourceContract({ session, contract: output.authoringSourceContract, guard });
    const expected = session.teachingRequirements?.fields?.questionCount?.value;
    if (session.workflow?.target === 'questions' && expected != null && output.snapshot?.questions?.length !== expected) {
      fail('The proposed question set does not yet contain every requested checked question. Saved work is preserved.', 422, 'AUTHORING_INCOMPLETE');
    }
  }
  if (output.representation === 'native-fork') {
    await guard();
    if (!output.nativeSourceContract || output.reviewSummary?.policyVersion !== output.nativeSourceContract.reviewPolicyVersion) {
      fail('The saved native revision used a different review policy. Request a new proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
    }
    await validateNativeSourceContract({ session, contract: output.nativeSourceContract });
  }
  const version = await createVersion({ session, run, ...output, title: output.document?.metadata?.title || session.title,
    summary: run.input.text, assertActive: guard });
  await guard();
  await Session.updateOne({ _id: session._id, activeRunId: run._id }, { $set: { candidateVersionId: version._id, status: 'ready',
    ...(session.nativePlan && output.representation === 'native-fork' ? { nativePlan: { ...session.nativePlan, status: 'generated' } } : {}) }, $inc: { revision: 1 } });
  const instruction = session.currentVersionId ? 'Compare it with the current version, then accept the changes or keep the current version.'
    : 'Try the activity in Preview, inspect its checks and sources, then accept the proposal or ask for a different plan.';
  await say(session, `result-${run._id}`, 'assistant', `A proposed activity is ready. ${output.changes.join(' ')} ${instruction}`, run._id);
  return true;
}

async function execute(run) {
  const token = run.leaseToken;
  const filter = { _id: run._id, leaseToken: token, status: 'running' };
  const controller = new AbortController();
  activeControllers.set(String(run._id), controller);
  const guard = async () => {
    controller.signal.throwIfAborted();
    if (!await Run.exists({ ...filter, cancelRequested: false, leaseUntil: { $gt: new Date() } })
      || !await Session.exists({ _id: run.sessionId, owner: run.owner, activeRunId: run._id })) fail('This execution is no longer active.');
    await ownedSession(String(run.owner), String(run.sessionId));
  };
  const heartbeat = setInterval(() => {
    void Run.updateOne({ ...filter, cancelRequested: false, leaseUntil: { $gt: new Date() } },
      { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }).then(r => { if (!r.matchedCount) controller.abort(); }).catch(() => controller.abort());
  }, 25_000);
  heartbeat.unref?.();
  const checkpoint = async (name, result) => {
    await guard();
    const saved = await Run.updateOne(filter, { $set: { checkpoint: name, ...(result ? { result } : {}) },
      $push: { steps: { $each: [{ name, createdAt: new Date() }], $slice: -40 } } });
    if (!saved.matchedCount) fail('The execution lease was lost.');
    run.checkpoint = name;
  };
  try {
    const session = await ownedSession(String(run.owner), String(run.sessionId));
    if (run.cancelRequested) {
      await Run.updateOne(filter, { $set: { status: 'cancelled' } });
      await Session.updateOne({ _id: session._id, activeRunId: run._id }, { $set: { status: session.currentVersionId ? 'ready' : 'cancelled' }, $inc: { revision: 1 } });
      return;
    }
    await guard();
    if (['message', 'save_objectives'].includes(run.kind)) await say(session, `user-${run._id}`, 'user', run.input.text, run._id);
    const done = run.checkpoint === 'output_saved' && run.result
      ? await finishCandidate(run, session, run.result, guard) : await withAuthoringOperations(run, () => perform(run, session, guard, checkpoint, controller.signal));
    await guard();
    await Run.updateOne(filter, { $set: { status: done ? 'succeeded' : 'waiting', nextAt: new Date(Date.now() + 2000) }, $unset: { leaseToken: '', leaseUntil: '' } });
  } catch (error) {
    const cancelled = !!(await Run.findById(run._id).select('cancelRequested'))?.cancelRequested;
    const nativeDiagnosis = (run.result?.nativeActivity || run.nativeActivityState) && nativeReviewFailureMessage(error);
    const message = cancelled ? 'Stopped. Your saved versions are preserved.' : nativeDiagnosis || (error.status
      ? error.message : 'This step could not finish. Your saved work is preserved. Check the model configuration and retry explicitly; an interrupted model request may have used credits.');
    const failed = await Run.updateOne(filter, { $set: { status: cancelled ? 'cancelled' : 'failed', error: message, errorCode: error.code || '' } });
    if (failed.modifiedCount) await Session.updateOne({ _id: run.sessionId, activeRunId: run._id }, { $set: { status: cancelled ? 'cancelled' : 'needs_attention', error: message }, $inc: { revision: 1 } });
  } finally { clearInterval(heartbeat); activeControllers.delete(String(run._id)); }
}

export async function tickAuthoringWorker() {
  if (ticking || mongoose.connection.readyState !== 1) return;
  ticking = true;
  try {
    // A lost model response is not safe to replay. Deterministic packaging and
    // polling checkpoints are recoverable; model work needs explicit retry.
    // Repair the admission acknowledgement gap without running unclaimed work.
    const activeSessions = await Session.find({ activeRunId: { $ne: null } }).select('activeRunId').lean();
    const admissions = await Run.find({ _id: { $in: activeSessions.map(session => session.activeRunId) }, admitted: false, status: 'queued' }).limit(20);
    for (const run of admissions) {
      if (await Session.exists({ _id: run.sessionId, owner: run.owner, activeRunId: run._id })) {
        await Run.updateOne({ _id: run._id, status: 'queued' }, { $set: { admitted: true } });
      }
    }
    await promoteAuthoringMessages();
    const uncertain = await Run.find({ status: 'running', leaseUntil: { $lt: new Date() }, $or: [
      { checkpoint: { $in: ['clarify_requirements', 'model_call', 'decision_saved', 'manual_save'] } },
      { checkpoint: { $regex: '^question_batch_.+_model_pending$' } },
      { checkpoint: { $regex: '^native_.+_model_pending$' } },
      { checkpoint: 'agent_model_call', 'agentState.phase': 'model_pending' }
    ] }).limit(20);
    for (const run of uncertain) {
      const result = await Run.updateOne({ _id: run._id, status: 'running', leaseUntil: { $lt: new Date() } },
        { $set: { status: 'interrupted', error: 'The model request was interrupted. Review the task and retry explicitly; it may have used credits.' } });
      if (result.modifiedCount) await Session.updateOne({ _id: run.sessionId, activeRunId: run._id },
        { $set: { status: 'needs_attention', error: 'The model request was interrupted. No automatic paid retry was made.' }, $inc: { revision: 1 } });
    }
    for (let count = 0; count < 3; count++) {
      if (activeControllers.size >= 3) break;
      const run = await Run.findOneAndUpdate({ admitted: true, nextAt: { $lte: new Date() }, $or: [
        { status: { $in: ['queued', 'waiting'] } }, { status: 'running', leaseUntil: { $lt: new Date() } }
      ] }, { $set: { status: 'running', leaseToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + LEASE_MS) } }, { new: true, sort: { nextAt: 1 } });
      if (!run) break;
      if (!run.startedAt) {
        const startedAt = run.checkpoint === 'start' ? new Date() : run.createdAt;
        const started = await Run.updateOne({ _id: run._id, leaseToken: run.leaseToken, status: 'running', startedAt: null }, { $set: { startedAt } });
        if (!started.matchedCount) continue;
        run.startedAt = startedAt;
      }
      if (Date.now() - +run.startedAt > MAX_RUN_MS && run.checkpoint !== 'start') {
        await Run.updateOne({ _id: run._id, leaseToken: run.leaseToken }, { $set: { status: 'interrupted', error: 'This execution exceeded its time budget. Retry explicitly.' } });
        await Session.updateOne({ _id: run.sessionId, activeRunId: run._id }, { $set: { status: 'needs_attention', error: 'This execution exceeded its time budget. Your saved work is preserved.' } });
        continue;
      }
      void execute(run).catch(() => { /* Durable lease expiry handles a database outage. */ });
    }
  } finally { ticking = false; }
}

export function startAuthoringWorker() {
  if (timer) return;
  timer = setInterval(() => { void tickAuthoringWorker().catch(() => {}); }, 2000);
  timer.unref?.();
}
