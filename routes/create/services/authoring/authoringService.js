import { updateTeachingRequirements, reconcileQuestionCount } from './teachingRequirements.js';
import { authoringOperation, withAuthoringOperations } from './authoringOperations.js';
import { resolveAuthoringContext, ensureDraftCourse } from './authoringContext.js';
import { buildAuthoringDecisionPrompt } from './authoringDecisionPrompt.js';
import { assessAuthoringRequirements, effectiveTeachingBrief } from './authoringRequirements.js';
import crypto from 'node:crypto';
import { assistantRecoveryMessage, canReviseAssistantPlan } from './assistantRecovery.js';
import mongoose from 'mongoose';
import { AuthoringSession as Session, AuthoringMessage as Message, AuthoringRun as Run, AuthoringVersion as Version } from '../../models/StudioAuthoring.js';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import LegacySession from '../../models/StudioAssistantSession.js';
import { createAssistantSession, readAssistantSession, approveAssistantPlan, resumeAssistantSession, updateAssistantPlan } from '../studioAssistantService.js';
import { proposeAssistantPlan, proposeAssistantObjectives, buildAssistantContext, getAssistantQuestionTypes } from '../studioAssistantPlanning.js';
import llmService from '../llmService.js';
import ragService from '../ragService.js';
import questionStreamingService from '../questionStreamingService.js';
import { formatContentForDatabase } from '../questionContentService.js';
import { generateStudioActivity } from '../h5pStudioAIService.js';
import { extractBalancedJson } from '../../utils/openAIRequestUtils.js';
import { isMaterialReady } from '../../utils/generationReadiness.js';
import Question from '../../models/Question.js';
import Quiz from '../../models/Quiz.js';
import { acceptVersion, createVersion, readCourseSnapshot, readNative, cloneDocument } from './artifactVersionService.js';
import { digest, stableId, fail, objectId, requestId, validateCommand, parseDecision, versionSummary } from './authoringContracts.js';

const LEASE_MS = 90_000;
const MAX_RUN_MS = 20 * 60_000;
const terminal = ['succeeded', 'failed', 'interrupted', 'cancelled'];
const userFor = owner => ({ id: String(owner) });
const activeControllers = new Map();
let timer;
let ticking = false;

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
  const [messages, versions, run, assistant, pastRuns] = await Promise.all([
    Message.find({ owner, sessionId: id }).sort({ _id: -1 }).limit(100).lean(),
    Version.find({ owner, sessionId: id }).sort({ number: -1 }).limit(100).lean(),
    session.activeRunId ? Run.findOne({ _id: session.activeRunId, owner }).lean() : null,
    session.assistantId ? readAssistantSession(owner, String(session.assistantId)).catch(error => {
      if (error.status === 404) return null;
      throw error;
    }) : null,
    Run.find({ owner, sessionId: id }).sort({ _id: -1 }).limit(20).select('steps operations').lean()
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
  return { id: String(session._id), title: session.title, courseId: String(session.courseId),
    quizId: session.quizId ? String(session.quizId) : null, materialIds: session.materialIds.map(String), objectiveIds: (session.objectiveIds || []).map(String), contextCourse: session.contextCourse === true,
    teachingRequirements: session.teachingRequirements, operations: pastRuns.flatMap(r => r.operations || []).sort((a, b) => +a.startedAt - +b.startedAt).slice(-200),
    instructions: session.instructions, autoApprove: session.autoApprove, revision: session.revision,
    status: session.status, error: session.error || '', currentVersionId: session.currentVersionId ? String(session.currentVersionId) : null,
    candidateVersionId: session.candidateVersionId ? String(session.candidateVersionId) : null,
    messages: messages.reverse().map(m => ({ id: String(m._id), role: m.role, text: m.text, clarification: m.clarification || [], createdAt: m.createdAt })),
    versions: versions.map(versionSummary), assistant,
    taskSteps: pastRuns.flatMap(entry => (entry.steps || []).map(step => ({ name: step.name, createdAt: step.createdAt })))
      .sort((a, b) => +a.createdAt - +b.createdAt).slice(-100),
    run: run ? { id: String(run._id), status: run.status, checkpoint: run.checkpoint, steps: run.steps || [], error: run.error, createdAt: run.createdAt, updatedAt: run.updatedAt } : null,
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
    || (body.instructions != null && (typeof body.instructions !== 'string' || body.instructions.length > 12000))) fail('Write a teaching idea or attach context to begin.', 400, 'AUTHORING_INPUT');
  const resolved = await resolveAuthoringContext(owner, body);
  const materials = resolved.materials;
  if (!body.instructions?.trim() && !materials.length && !resolved.objectives.length && !resolved.course) fail('Write a teaching idea or attach context to begin.', 400, 'AUTHORING_INPUT');
  const course = resolved.course || await ensureDraftCourse(owner);
  if (body.quizId && !await Quiz.exists({ _id: body.quizId, folder: course._id, createdBy: owner })) fail('Learning object not found in this course.', 404);
  const instructions = body.instructions?.trim() || 'Propose learning objectives and an editable teaching plan from the attached context. Ask about missing teaching requirements.';
  const input = { courseId: String(course._id), quizId: body.quizId || null, materialIds: materials.map(m => String(m._id)).sort(),
    objectiveIds: resolved.objectives.map(lo => String(lo._id)).sort(), contextCourse: body.contextCourse === true,
    instructions, autoApprove: false };
  const hash = digest(input);
  let session = await Session.findOne({ owner, requestId: body.requestId });
  if (session && session.requestHash !== hash) fail('This request ID belongs to a different task.');
  if (!session) {
    const title = (body.instructions?.trim() || `Learning activity · ${materials[0]?.name || course.name}`).slice(0, 90);
    try { session = await Session.create({ _id: stableId(`${owner}:${body.requestId}`), owner, requestId: body.requestId,
      requestHash: hash, ...input, teachingRequirements: updateTeachingRequirements(null, instructions, body.requestId), title }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      session = await Session.findOne({ owner, requestId: body.requestId });
      if (!session || session.requestHash !== hash) fail('This request ID belongs to a different task.');
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
      requestHash, kind, input, baseVersionId: session.currentVersionId });
  } catch (error) {
    if (error.code !== 11000) throw error;
    run = await Run.findOne({ owner: session.owner, requestId: input.requestId });
    if (!run || run.requestHash !== requestHash) fail('This request ID belongs to a different command.');
    return run;
  }
  const claimed = await Session.findOneAndUpdate({ _id: session._id, owner: session.owner, revision: input.revision,
    activeRunId: session.activeRunId || null }, { $set: { activeRunId: run._id, error: '',
    ...(kind === 'create' ? {} : { status: 'working' }) }, $inc: { revision: 1 } });
  if (!claimed) {
    await Run.updateOne({ _id: run._id }, { $set: { status: 'failed', error: 'The task changed before this command was accepted.' } });
    fail('The task changed before this command was accepted. Reload it.');
  }
  await Run.updateOne({ _id: run._id }, { $set: { admitted: true } });
  if (kind === 'message') await say(session, `user-${run._id}`, 'user', input.text, run._id);
  void tickAuthoringWorker();
  return run;
}

export async function authoringCommand(owner, id, kind, body) {
  const session = await ownedSession(owner, id);
  if (!['message', 'approve', 'retry', 'accept', 'reject', 'restore'].includes(kind)) fail('Unknown command.', 400);
  if (kind === 'message' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000)) fail('Write a message of 1–4,000 characters.', 400);
  if (['accept', 'reject', 'restore'].includes(kind) && !objectId(body.versionId)) fail('Choose a saved version.', 400);
  if (kind === 'approve' && session.status !== 'awaiting_approval' && !await Run.exists({ owner, requestId: body.requestId })) fail('There is no current teaching plan to approve.');
  if (kind === 'message' && body.context) await resolveAuthoringContext(owner, body.context);
  // Only the server chooses which previous execution a retry may resume.
  const input = { requestId: body.requestId, revision: body.revision,
    ...(kind === 'message' ? { text: body.text.trim(), ...(body.context ? { context: { courseId: body.context.courseId || null, materialIds: body.context.materialIds || [], objectiveIds: body.context.objectiveIds || [], contextCourse: body.context.contextCourse === true } } : {}) } : {}),
    ...(['accept', 'reject', 'restore'].includes(kind) ? { versionId: body.versionId } : {}),
    ...(kind === 'approve' ? { planRevision: body.planRevision } : {}) };
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
  await enqueue(session, kind, input);
  return readAuthoringSession(owner, id);
}

export async function cancelAuthoringRun(owner, id, body) {
  const session = await ownedSession(owner, id);
  if (!Number.isInteger(body.revision) || session.revision !== body.revision) fail('Reload the current task before stopping it.');
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

async function perform(run, session, guard, checkpoint, signal) {
  const owner = String(session.owner);
  const user = userFor(owner);
  const id = String(session._id);
  const patch = async values => { await guard(); return Session.updateOne({ _id: session._id, activeRunId: run._id }, { $set: values }); };
  const message = async (text, clarification = []) => { await guard(); return say(session, `result-${run._id}`, 'assistant', text, run._id, clarification); };
  const current = session.currentVersionId ? await Version.findOne({ _id: session.currentVersionId, owner, sessionId: session._id }) : null;
  if (run.kind === 'message') {
    const spec = updateTeachingRequirements(session.teachingRequirements, run.input.text, run.input.requestId);
    await patch({ teachingRequirements: spec }); session.teachingRequirements = spec;
  }
  if (run.kind === 'message' && run.input.context && run.checkpoint === 'start') {
    const resolved = await resolveAuthoringContext(owner, run.input.context);
    const context = { courseId: String(resolved.course?._id || session.courseId), materialIds: resolved.materials.map(m => m._id),
      objectiveIds: resolved.objectives.map(lo => lo._id), contextCourse: run.input.context.contextCourse };
    if (current && String(context.courseId) !== String(session.courseId)) fail('Start a new conversation to use a different course with a saved activity.');
    const changed = digest([context.courseId, context.materialIds.map(String).sort(), context.objectiveIds.map(String).sort(), context.contextCourse]) !== digest([String(session.courseId), session.materialIds.map(String).sort(), (session.objectiveIds || []).map(String).sort(), session.contextCourse]);
    if (changed) {
      const values = { ...context, ...(!current ? { assistantId: null, quizId: null, requirementsReady: false } : {}) };
      await patch(values); Object.assign(session, values);
      await checkpoint('context_attached');
    }
  }
  if (run.kind === 'retry' && run.input.resumeRunId) {
    let previous = await Run.findOne({ _id: run.input.resumeRunId, owner, sessionId: session._id });
    let depth = 0;
    while (previous?.kind === 'retry' && previous.input?.resumeRunId && depth++ < 10) {
      previous = await Run.findOne({ _id: previous.input.resumeRunId, owner, sessionId: session._id });
    }
    if (previous?.kind === 'manual') fail('Return to the advanced editor and save again to retry that manual edit.');
    if (previous?.checkpoint === 'output_saved' && previous.result) return finishCandidate(run, session, previous.result, guard);
    const resumesRequirements = previous?.kind === 'message' && (previous.continuePlanning
      || (session.requirementsReady && (session.requirementAnswers || []).some(answer => answer.requestId === previous.input?.requestId)));
    if (previous && !resumesRequirements && ['message', 'accept', 'reject', 'restore'].includes(previous.kind)) {
      return perform({ ...run.toObject(), _id: run._id, kind: previous.kind, input: previous.input }, session, guard, checkpoint, signal);
    }
  }
  const prepareRequirements = async (materials, latestAnswer) => {
    if (session.quizId && !await Quiz.exists({ _id: session.quizId, folder: session.courseId, createdBy: owner })) fail('Learning object not found in this course.', 404);
    const answers = [...(session.requirementAnswers || [])];
    if (latestAnswer && !answers.some(answer => answer.requestId === run.input.requestId)) {
      answers.push({ requestId: run.input.requestId, text: latestAnswer });
    }
    const alreadyChecked = session.requirementsReady && (!latestAnswer || (session.requirementAnswers || []).some(answer => answer.requestId === run.input.requestId));
    if (alreadyChecked || (session.autoApprove && !latestAnswer)) return true;
    const brief = await contextualTeachingBrief(session, answers);
    await checkpoint('clarify_requirements');
    const assessment = session.teachingRequirements?.countIssue ? { ready: false, reply: session.teachingRequirements.countIssue, clarification: [{ question: 'How many questions should this activity contain?', options: ['5 questions', '10 questions', '15 questions'] }] } : await authoringOperation('clarify_requirements', 'Check teaching requirements', () => assessAuthoringRequirements({ instructions: brief, materials, userId: owner, signal }));
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
  if (run.kind === 'message' && !session.assistantId && !current) {
    const materials = await Material.find({ _id: { $in: session.materialIds }, folder: session.courseId, uploadedBy: owner });
    if (materials.length !== session.materialIds.length) fail('A selected material is no longer available.', 404);
    if (materials.some(m => m.processingStatus === 'failed')) fail('A material could not be processed. Retry it in Materials, then resume this task.');
    if (materials.some(m => !isMaterialReady(m))) { await patch({ status: 'waiting_for_materials' }); return false; }
    if (!await prepareRequirements(materials, run.input.text)) return true;
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
      const assistant = await createAssistantSession(user, { requestId: `authoring-${id}-${digest({ courseId: session.courseId, materialIds: session.materialIds, objectiveIds: session.objectiveIds, instructions }).slice(0, 12)}`, courseId: String(session.courseId),
        ...(session.quizId ? { quizId: String(session.quizId) } : {}), materialIds: session.materialIds.map(String), instructions,
        canonicalObjectives: session.materialIds.length > 0, promptBased: !session.materialIds.length, objectiveIds: (session.objectiveIds || []).map(String) }, { teachingRequirements: session.teachingRequirements });
      await guard();
      await patch({ assistantId: assistant.id, quizId: assistant.quizId, status: 'planning' });
      return false;
    }
    let assistant = await readAssistantSession(owner, String(session.assistantId));
    if (run.kind === 'retry' && ['failed', 'interrupted'].includes(assistant.status) && run.checkpoint === 'start') {
      await checkpoint('dispatch_retry');
      assistant = await resumeAssistantSession(user, assistant.id, { requestId: `retry-${run._id}`, revision: assistant.revision });
    }
    if (assistant.status === 'awaiting_approval') {
      if (run.kind === 'approve' || (session.autoApprove && run.kind === 'create')) {
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
    if (['failed', 'interrupted'].includes(assistant.status)) {
      await message(assistantRecoveryMessage(assistant));
      fail(assistant.error || 'Generation stopped. Review the saved progress before retrying.');
    }
    if (assistant.status === 'completed') {
      session.quizId = assistant.quizId;
      const course = await readCourseSnapshot(session);
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
        restoredFromId: version._id, title: version.title, summary: `Restored version ${version.number}.`,
        changes: [`Restored content from version ${version.number}`], assertActive: guard });
      await acceptVersion(session, restored, run, guard);
      await message(`Restored version ${version.number} as a new version. Your previous versions remain in Version history.`);
    } else {
      if (String(session.candidateVersionId || '') !== String(version._id) || version.state !== 'candidate') fail('This proposal is no longer awaiting a decision.');
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
  const history = await Message.find({ sessionId: session._id, owner }).sort({ _id: -1 }).limit(12).lean();
  const allowedQuestionTypes = getAssistantQuestionTypes().map(type => type.questionType);
  await checkpoint('model_call');
  const referencedContext = await contextualTeachingBrief(session);
  const response = await authoringOperation('choose_action', 'Interpret the next teaching request', () => llmService.streamCompletion({ userId: owner, signal, jsonMode: true, maxTokens: 2400, temperature: 0.1,
    prompt: buildAuthoringDecisionPrompt({ latestRequest: run.input.text, assistant, current, history, allowedQuestionTypes, referencedContext }) }));
  await guard();
  const rawDecision = JSON.parse(extractBalancedJson(response.content) || '{}');
  const decision = parseDecision(rawDecision, current?.snapshot?.questions?.length || 0, allowedQuestionTypes);
  const spec = updateTeachingRequirements(session.teachingRequirements, run.input.text, run.input.requestId, rawDecision.requirements, Array.isArray(rawDecision.clarification) ? rawDecision.clarification.map(q => q?.question) : undefined);
  await patch({ teachingRequirements: spec }); session.teachingRequirements = spec;
  await checkpoint('decision_saved', decision);
  if (decision.action === 'reply') {
    await message(decision.reply, decision.clarification);
    await patch({ status: current ? 'ready' : assistant?.status === 'failed' ? 'needs_attention' : 'awaiting_approval',
      error: assistant?.status === 'failed' ? assistant.error || '' : '' });
    return true;
  }
  if (decision.action === 'revise_plan' || decision.action === 'revise_objectives') {
    if (current || !canReviseAssistantPlan(assistant)) fail('The plan cannot be changed in this state.');
    await checkpoint('model_call');
    const materials = await Material.find({ _id: { $in: session.materialIds }, folder: session.courseId, uploadedBy: owner });
    const context = materials.length ? await buildAssistantContext(materials, { userId: owner, signal }) : { context: 'Brainstorming from the instructor brief and selected objectives. No source evidence was supplied.' };
    const objectives = decision.action === 'revise_objectives' ? await proposeAssistantObjectives({ instructions: `${effectiveTeachingBrief(session)}\nLatest revision: ${run.input.text}`, context: context.context, sources: context.sources || [], userId: owner, signal, promptBased: !materials.length }) : assistant.objectives;
    const plan = reconcileQuestionCount(await proposeAssistantPlan({ instructions: effectiveTeachingBrief(session), currentPlan: assistant.plan, revisionRequest: run.input.text,
      objectives, context: context.context, userId: owner, signal }), session.teachingRequirements);
    await guard();
    await updateAssistantPlan(user, assistant.id, { revision: assistant.revision, objectives, plan }, { teachingRequirements: session.teachingRequirements });
    await patch({ status: 'awaiting_approval', error: '' });
    await message(decision.action === 'revise_objectives' ? 'I revised the learning objectives and their question plan. Open the proposal to review or edit it before generating questions.' : 'I updated the proposed question plan. Review the quantities, types and instructions before accepting it.');
    return true;
  }
  if (!current) fail('Generate the first activity before requesting a content revision.');
  let snapshot;
  let document;
  let representation;
  let changes;
  await checkpoint('model_call');
  if (decision.action === 'revise_question' && current.representation === 'course-linked') {
    snapshot = structuredClone(current.snapshot);
    const index = decision.questionIndex - 1;
    const original = snapshot.questions[index];
    const questionType = decision.questionType || original.type;
    const difficulty = decision.difficulty || original.difficulty || 'moderate';
    const selectionMode = questionType === 'multiple-choice'
      ? decision.selectionMode || (original.type === 'multiple-choice' ? original.content?.selectionMode : null) || 'single' : 'single';
    if (decision.selectionMode && questionType !== 'multiple-choice') fail('Answer selection mode applies only to multiple-choice questions.', 422, 'AUTHORING_RESPONSE');
    const objective = snapshot.learningObjectives.find(lo => String(lo._id) === String(original.learningObjective?._id || original.learningObjective));
    const materials = await Material.find({ _id: { $in: session.materialIds }, uploadedBy: owner, folder: session.courseId });
    if (materials.length !== session.materialIds.length || materials.some(m => !isMaterialReady(m))) fail('The source materials are no longer ready.');
    const retrieval = materials.length ? await ragService.retrieveRelevantContent(`${objective?.text || original.questionText}\n${run.input.text}`.slice(0, 5000), questionType,
      { materialIds: session.materialIds.map(String), topK: 5, minScore: 0.3 }) : { chunks: [] };
    if (materials.length && !retrieval?.chunks?.length) fail('No supporting evidence was found. The original question is preserved.');
    const result = await llmService.generateQuestion({ learningObjective: objective?.text || null, questionType,
      relevantContent: retrieval.chunks, difficulty, selectionMode, userId: owner, signal,
      customPrompt: `${run.input.text}\nRevise only this question: ${original.questionText}`,
      previousQuestions: snapshot.questions.filter((_, i) => i !== index).map(q => ({ questionText: q.questionText })) });
    if (!result.success || !result.questionData) fail('The revised question did not pass generation checks.', 422);
    const data = result.questionData;
    snapshot.questions[index] = { ...original, type: questionType, difficulty, questionText: data.questionText, content: formatContentForDatabase(data, questionType),
      correctAnswer: data.correctAnswer, explanation: data.explanation,
      generationMetadata: { ...original.generationMetadata, ...data.generationMetadata,
        sourceReferences: questionStreamingService.buildSourceReferences(retrieval.chunks), instructorPrompt: run.input.text } };
    await new Question(snapshot.questions[index]).validate();
    representation = 'course-linked';
    changes = [`Revised question ${decision.questionIndex}; all other questions are preserved.`];
  } else {
    const template = await readNative(current.contentId, owner);
    const generated = await generateStudioActivity({ library: template.library, template, templateContentId: current.contentId,
      instructions: `${run.input.text}\nPreserve existing content and media except where the instructor explicitly requests a change.`,
      context: JSON.stringify({ objectives: assistant?.objectives || [], sources: (current.snapshot?.questions || []).flatMap(q => q.generationMetadata?.sourceReferences || []) }),
      userId: owner, complete: options => llmService.streamCompletion({ ...options, signal }) });
    document = generated.document;
    representation = 'native-fork';
    changes = ['Proposed an independent native H5P revision. Review the full preview; course questions are unchanged.'];
  }
  await guard();
  // Persist generated output before packaging so a runtime failure can recover
  // without purchasing the model call again.
  await checkpoint('output_saved', { snapshot, document, representation, changes });
  return finishCandidate(run, session, { snapshot, document, representation, changes }, guard);
}

async function finishCandidate(run, session, output, guard) {
  const version = await createVersion({ session, run, ...output, title: output.document?.metadata?.title || session.title,
    summary: run.input.text, assertActive: guard });
  await guard();
  await Session.updateOne({ _id: session._id, activeRunId: run._id }, { $set: { candidateVersionId: version._id, status: 'ready' }, $inc: { revision: 1 } });
  await say(session, `result-${run._id}`, 'assistant', `A proposed revision is ready. ${output.changes.join(' ')} Compare it with the current version, then accept the changes or keep the current version.`, run._id);
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
    if (run.kind === 'message') await say(session, `user-${run._id}`, 'user', run.input.text, run._id);
    const done = run.checkpoint === 'output_saved' && run.result
      ? await finishCandidate(run, session, run.result, guard) : await withAuthoringOperations(run, () => perform(run, session, guard, checkpoint, controller.signal));
    await guard();
    await Run.updateOne(filter, { $set: { status: done ? 'succeeded' : 'waiting', nextAt: new Date(Date.now() + 2000) }, $unset: { leaseToken: '', leaseUntil: '' } });
  } catch (error) {
    const cancelled = !!(await Run.findById(run._id).select('cancelRequested'))?.cancelRequested;
    const message = cancelled ? 'Stopped. Your saved versions are preserved.' : error.status
      ? error.message : 'This step could not finish. Your saved work is preserved. Check the model configuration and retry explicitly; an interrupted model request may have used credits.';
    const failed = await Run.updateOne(filter, { $set: { status: cancelled ? 'cancelled' : 'failed', error: message } });
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
    const admissions = await Run.find({ admitted: false, status: 'queued' }).limit(20);
    for (const run of admissions) {
      if (await Session.exists({ _id: run.sessionId, owner: run.owner, activeRunId: run._id })) {
        await Run.updateOne({ _id: run._id, status: 'queued' }, { $set: { admitted: true } });
      }
    }
    const uncertain = await Run.find({ status: 'running', leaseUntil: { $lt: new Date() }, checkpoint: { $in: ['clarify_requirements', 'model_call', 'decision_saved', 'manual_save'] } }).limit(20);
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
      if (Date.now() - +run.createdAt > MAX_RUN_MS && run.checkpoint !== 'start') {
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
