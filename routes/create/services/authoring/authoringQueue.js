import { AuthoringSession as Session, AuthoringRun as Run, AuthoringMessage as Message } from '../../models/StudioAuthoring.js';
import Folder from '../../models/Folder.js';
import { digest, fail, validateCommand } from './authoringContracts.js';

const terminal = ['succeeded', 'failed', 'interrupted', 'cancelled'];

// Pending commands have their own durable identity. A Session reservation is
// the acceptance record, so a crash between its write and the response is safe.
export async function queueAuthoringMessage(session, input) {
  validateCommand(input);
  const hash = digest({ sessionId: String(session._id), kind: 'message', input });
  let run = await Run.findOne({ owner: session.owner, requestId: input.requestId });
  if (run && run.requestHash !== hash) fail('This request ID belongs to a different command.');
  if (run && (run.admitted || terminal.includes(run.status)
    || await Session.exists({ _id: session._id, owner: session.owner, pendingRunIds: run._id }))) return run;
  if (!run) {
    try {
      run = await Run.create({ owner: session.owner, sessionId: session._id, requestId: input.requestId,
        requestHash: hash, kind: 'message', input, deferred: true, tokenUsageVersion: 1, baseVersionId: session.currentVersionId });
    } catch (error) {
      if (error.code !== 11000) throw error;
      run = await Run.findOne({ owner: session.owner, requestId: input.requestId });
      if (!run || run.requestHash !== hash) fail('This request ID belongs to a different command.');
    }
  }
  const reserved = await Session.updateOne({ _id: session._id, owner: session.owner,
    revision: input.revision, activeRunId: session.activeRunId || null,
    'pendingRunIds.7': { $exists: false }, pendingRunIds: { $ne: run._id } }, {
    $push: { pendingRunIds: run._id }, $inc: { revision: 1 }
  });
  if (!reserved.modifiedCount) {
    if (await Session.exists({ _id: session._id, owner: session.owner, pendingRunIds: run._id })) return run;
    await Run.updateOne({ _id: run._id, admitted: false, status: 'queued' },
      { $set: { status: 'failed', error: 'The task changed or its message queue is full. Reload before sending again.' } });
    fail('The task changed or already has eight queued messages. Reload before sending again.');
  }
  await Message.updateOne({ sessionId: session._id, key: `user-${run._id}` }, { $setOnInsert: {
    owner: session.owner, sessionId: session._id, key: `user-${run._id}`, role: 'user', text: input.text, runId: run._id
  } }, { upsert: true });
  return run;
}

export async function promoteAuthoringMessages() {
  const sessions = await Session.find({ 'pendingRunIds.0': { $exists: true }, candidateVersionId: null }).limit(30);
  for (const session of sessions) {
    if (!await Folder.exists({ _id: session.courseId, instructor: session.owner })) continue;
    const active = session.activeRunId ? await Run.findById(session.activeRunId).select('status') : null;
    if (active && !terminal.includes(active.status)) continue;
    const next = await Run.findOne({ _id: session.pendingRunIds[0], owner: session.owner,
      sessionId: session._id, deferred: true, admitted: false, status: 'queued' });
    if (!next) {
      await Session.updateOne({ _id: session._id, 'pendingRunIds.0': session.pendingRunIds[0] }, { $pop: { pendingRunIds: -1 } });
      continue;
    }
    const claimed = await Session.updateOne({ _id: session._id, owner: session.owner,
      activeRunId: session.activeRunId || null, candidateVersionId: null, 'pendingRunIds.0': next._id }, {
      $set: { activeRunId: next._id, status: 'working', error: '' }, $pop: { pendingRunIds: -1 }, $inc: { revision: 1 }
    });
    if (claimed.modifiedCount) await Run.updateOne({ _id: next._id, status: 'queued' }, { $set: { admitted: true } });
  }
}
