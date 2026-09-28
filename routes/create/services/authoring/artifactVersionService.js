import mongoose from 'mongoose';
import Quiz from '../../models/Quiz.js';
import Question from '../../models/Question.js';
import LearningObjective from '../../models/LearningObjective.js';
import H5PContent from '../../models/H5PContent.js';
import { AuthoringSession, AuthoringVersion, AuthoringRun, AuthoringMessage } from '../../models/StudioAuthoring.js';
import { getEditor, getSystemUser, toLumiUser, finalizeContentOwnership } from '../lumiService.js';
import { buildNativeH5PDocument } from '../h5pExportService.js';
import { buildH5PSourceFingerprint, saveNativeH5PDocumentAndRecord } from '../h5pEditorService.js';
import { collectTemplateMedia, studioMediaPaths } from '../h5pStudioSemantics.js';
import { getStudioCatalog } from '../h5pStudioCatalog.js';
import { withQuestionMutation } from '../questionPublication.js';
import { digest, fail, stableId } from './authoringContracts.js';

const plain = value => JSON.parse(JSON.stringify(value));
// Compare every field this workflow may replace, not merely the H5P-rendered
// text. JSON normalization keeps Mongoose subdocuments and stored snapshots
// equivalent, including schema toJSON transforms.
export function courseFingerprint(value) {
  const quiz = plain(value);
  const canonical = input => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])])) : input;
  return digest(canonical({ name: quiz.name, materials: quiz.materials, settings: quiz.settings,
    chapters: quiz.chapters, questions: (quiz.questions || []).map(cleanRecord),
    learningObjectives: (quiz.learningObjectives || []).map(cleanRecord) }));
}

export async function readCourseSnapshot(session) {
  const quiz = await Quiz.findOne({ _id: session.quizId, createdBy: session.owner, folder: session.courseId })
    .populate('learningObjectives').populate('questions');
  if (!quiz) fail('The linked Learning Object is no longer available.', 404);
  return { snapshot: plain(quiz), fingerprint: courseFingerprint(quiz), h5pFingerprint: buildH5PSourceFingerprint(quiz) };
}

export async function readNative(contentId, owner) {
  const record = await H5PContent.findOne({ lumiContentId: contentId, owner });
  if (!record) fail('This activity is no longer available.', 404);
  const editor = getEditor();
  if (!editor) fail('The H5P runtime is starting. Try again shortly.', 503);
  return editor.getContent(contentId, toLumiUser({ id: String(owner) }));
}

// Preserve all native fields and subContentIds while redirecting only verified
// media references to Lumi's copy-from-content mechanism.
export function copyMediaReferences(parameters, media) {
  if (Array.isArray(parameters)) return parameters.map(value => copyMediaReferences(value, media));
  if (!parameters || typeof parameters !== 'object') return parameters;
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key,
    key === 'path' && media.has(value) ? media.get(value).path : copyMediaReferences(value, media)]));
}

export async function cloneDocument(contentId, owner, parameters, metadata) {
  const native = await readNative(contentId, owner);
  const params = parameters ?? native.params.params;
  const media = collectTemplateMedia(native.library, params, getStudioCatalog().libraries, contentId);
  return { library: native.library, parameters: copyMediaReferences(params, media),
    metadata: metadata || native.params.metadata };
}

export async function createVersion({ session, run, snapshot, document, title, summary, changes = [],
  representation = 'course-linked', restoredFromId, sourceFingerprint, assertActive = async () => {} }) {
  await Promise.all([AuthoringVersion.init(), H5PContent.init()]);
  const previous = await AuthoringVersion.findOne({ owner: session.owner, runId: run._id });
  if (previous) return previous;
  const operation = `authoring-${run._id}`;
  let content = await H5PContent.findOne({ owner: session.owner, authoringOperation: operation });
  if (!content) {
    const parent = session.currentVersionId ? await AuthoringVersion.findOne({ _id: session.currentVersionId, owner: session.owner }) : null;
    const parentContent = parent ? await H5PContent.findOne({ lumiContentId: parent.contentId, owner: session.owner }).select('sourceFingerprint') : null;
    // Preserve the source revision supplied by the course reader. Native forks
    // inherit provenance; publishing a linked version refreshes it afterward.
    const sourceRevision = sourceFingerprint || parentContent?.sourceFingerprint;
    const native = document || await buildNativeH5PDocument(snapshot, { containerMode: 'column' });
    const editor = getEditor();
    if (!editor) fail('The H5P runtime is starting. Retry to prepare the saved content.', 503);
    await assertActive();
    const expectedMedia = studioMediaPaths(native.parameters).length;
    const saved = await saveNativeH5PDocumentAndRecord({ editor, document: native,
      user: toLumiUser({ id: String(session.owner) }), cleanupUser: getSystemUser(),
      createRecord: async result => {
        await assertActive();
        // Check copied files before the unique receipt becomes discoverable.
        const persisted = await editor.getContent(result.id, getSystemUser());
        const paths = studioMediaPaths(persisted.params.params);
        if (paths.length !== expectedMedia) fail('The activity media could not be copied. The previous version is preserved.', 422);
        for (const path of paths) {
          if (/^https:\/\//.test(path)) continue;
          if (!path || path.split('/').includes('..') || !await editor.contentManager.contentFileExists(result.id, path)) {
            fail('An activity media file is missing. The previous version is preserved.', 422);
          }
        }
        return H5PContent.create({ owner: session.owner, folder: session.courseId, quiz: session.quizId,
          lumiContentId: result.id, title: title || native.metadata.title, mainLibrary: native.library.split(' ')[0],
          source: 'generated', status: 'draft', authoringSessionId: session._id, authoringOperation: operation,
          sourceFingerprint: sourceRevision });
      }
    });
    content = saved.record;
    finalizeContentOwnership(saved.result.id);
  }
  await assertActive();
  const reserved = await AuthoringSession.findOneAndUpdate({ _id: session._id, owner: session.owner },
    { $inc: { versionCounter: 1 } }, { new: true });
  if (!reserved) fail('Task no longer available.', 404);
  try {
    return await AuthoringVersion.create({ owner: session.owner, sessionId: session._id, runId: run._id,
      number: reserved.versionCounter, parentId: session.currentVersionId, restoredFromId,
      title: title || content.title, summary, changes, representation, snapshot,
      fingerprint: snapshot ? courseFingerprint(snapshot) : digest(document), contentId: content.lumiContentId });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const recovered = await AuthoringVersion.findOne({ owner: session.owner, runId: run._id });
    if (!recovered) throw error;
    return recovered;
  }
}

const cleanRecord = value => {
  const copy = plain(value);
  for (const key of ['_id', 'id', '__v', 'createdAt', 'updatedAt']) delete copy[key];
  return copy;
};

// Stage immutable records, then publish all IDs/settings in one Quiz manifest
// update. Old records remain available to snapshots and in-flight readers.
export async function publishCourseVersion(session, version, assertActive) {
  const marker = String(version._id);
  let current = await Quiz.findOne({ _id: session.quizId, createdBy: session.owner }).populate('questions').populate('learningObjectives');
  if (!current) fail('The linked Learning Object is no longer available.', 404);
  if (current.authoringCommitId === marker) return { fingerprint: courseFingerprint(current), h5pFingerprint: buildH5PSourceFingerprint(current) };
  if (courseFingerprint(current) !== session.publishedFingerprint) {
    fail('The course was edited elsewhere. Your proposed version is kept; review the course before applying it.');
  }
  const snapshot = version.snapshot;
  if (!snapshot) fail('This version has no course snapshot.');
  const objectiveIds = new Map((snapshot.learningObjectives || []).map((item, index) =>
    [String(item._id), new mongoose.Types.ObjectId(stableId(`${marker}:lo:${index}`))]));
  const questionIds = new Map((snapshot.questions || []).map((item, index) =>
    [String(item._id), new mongoose.Types.ObjectId(stableId(`${marker}:question:${index}`))]));
  for (const objective of snapshot.learningObjectives || []) {
    await assertActive();
    const data = { ...cleanRecord(objective), quiz: session.quizId, createdBy: session.owner };
    await new LearningObjective({ ...data, _id: objectiveIds.get(String(objective._id)) }).validate();
    await LearningObjective.updateOne({ _id: objectiveIds.get(String(objective._id)) }, { $setOnInsert: data }, { upsert: true, runValidators: true });
  }
  for (const question of snapshot.questions || []) {
    await assertActive();
    const data = { ...cleanRecord(question), quiz: session.quizId, createdBy: session.owner,
      learningObjective: objectiveIds.get(String(question.learningObjective?._id || question.learningObjective)) || null };
    delete data.generationJob;
    await new Question({ ...data, _id: questionIds.get(String(question._id)) }).validate();
    await Question.updateOne({ _id: questionIds.get(String(question._id)) }, { $setOnInsert: data }, { upsert: true, runValidators: true });
  }
  await withQuestionMutation(Quiz, session.quizId, session.owner, async mutation => {
    await assertActive();
    current = await Quiz.findOne({ _id: session.quizId, createdBy: session.owner }).populate('questions').populate('learningObjectives');
    if (current.authoringCommitId === marker) return;
    if (courseFingerprint(current) !== session.publishedFingerprint) fail('The course changed before this version could be applied.');
    const settings = plain(snapshot.settings || {});
    settings.planItems = (settings.planItems || []).map(row => ({ ...row,
      learningObjective: objectiveIds.get(String(row.learningObjective?._id || row.learningObjective)) || null }));
    await mutation.writeQuiz({ $set: { name: snapshot.name, learningObjectives: [...objectiveIds.values()],
      questions: [...questionIds.values()], settings,
      chapters: (snapshot.chapters || []).map(chapter => ({ ...chapter,
        questionIds: (chapter.questionIds || []).map(id => questionIds.get(String(id))).filter(Boolean) })),
      authoringCommitId: marker, 'progress.reviewCompleted': false } });
  });
  return readCourseSnapshot(session);
}

export async function acceptVersion(session, version, run, assertActive) {
  if (String(session.currentVersionId || '') === String(version._id)) return;
  if (String(version.parentId || '') !== String(session.currentVersionId || '')) fail('This proposal is based on an older version. Your current version was kept.');
  let fingerprint = session.publishedFingerprint;
  if (version.representation === 'course-linked' && session.currentVersionId) {
    const published = await publishCourseVersion(session, version, assertActive);
    fingerprint = published.fingerprint;
    await H5PContent.updateOne({ lumiContentId: version.contentId, owner: session.owner },
      { $set: { sourceFingerprint: published.h5pFingerprint } });
  }
  await assertActive();
  const updated = await AuthoringSession.findOneAndUpdate({ _id: session._id, owner: session.owner,
    activeRunId: run._id, currentVersionId: session.currentVersionId || null }, {
    $set: { currentVersionId: version._id, candidateVersionId: null, status: 'ready',
      publishedFingerprint: fingerprint || version.fingerprint }, $inc: { revision: 1 }
  });
  if (!updated) fail('The workspace changed before this version could be accepted.');
  await AuthoringVersion.updateOne({ _id: version._id, owner: session.owner }, { $set: { state: 'accepted' } });
}

export async function saveManualVersion(record, normalized, user) {
  const owner = String(user.id);
  const session = await AuthoringSession.findOne({ _id: record.authoringSessionId, owner });
  if (!session) fail('The activity workspace is no longer available.', 404);
  const base = await AuthoringVersion.findOne({ owner, sessionId: session._id, contentId: record.lumiContentId }).sort({ number: -1 });
  if (!base) fail('The saved activity version is not available.', 404);
  const operation = `manual-${digest({ base: String(base._id), normalized }).slice(0, 48)}`;
  let run = await AuthoringRun.findOne({ owner, requestId: operation });
  const recovered = run ? await AuthoringVersion.findOne({ owner, runId: run._id, state: 'accepted' }) : null;
  if (recovered) {
    const content = await H5PContent.findOne({ owner, lumiContentId: recovered.contentId });
    const native = await readNative(recovered.contentId, owner);
    return { result: { id: recovered.contentId, metadata: native.params.metadata }, record: content };
  }
  if (String(session.currentVersionId) !== String(base._id) || session.candidateVersionId) {
    fail('This editor is showing an older version or an unresolved proposal. Return to the AI workspace and open the current version before saving.');
  }
  const active = session.activeRunId ? await AuthoringRun.findById(session.activeRunId) : null;
  if (active && ['queued', 'running', 'waiting'].includes(active.status)) fail('Another task is running. Return to the AI workspace before saving.');
  if (!run) run = await AuthoringRun.create({ owner, sessionId: session._id, requestId: operation,
    kind: 'manual', status: 'running', checkpoint: 'manual_save', baseVersionId: base._id,
    leaseToken: operation, leaseUntil: new Date(Date.now() + 90_000) });
  else await AuthoringRun.updateOne({ _id: run._id, owner }, { $set: { status: 'running', leaseToken: operation, leaseUntil: new Date(Date.now() + 90_000) } });
  const claimed = await AuthoringSession.findOneAndUpdate({ _id: session._id, owner, revision: session.revision,
    currentVersionId: base._id, activeRunId: session.activeRunId || null },
  { $set: { activeRunId: run._id, status: 'working' }, $inc: { revision: 1 } });
  if (!claimed) {
    await AuthoringRun.updateOne({ _id: run._id }, { $set: { status: 'failed' } });
    fail('Another edit changed this workspace. Reload before saving.');
  }
  const guard = async () => {
    if (!await AuthoringRun.exists({ _id: run._id, status: 'running', cancelRequested: false,
      leaseUntil: { $gt: new Date() } }) || !await AuthoringSession.exists({ _id: session._id, owner, activeRunId: run._id })) {
      fail('The save was interrupted. Return to the workspace to check its status.');
    }
  };
  try {
    const original = await readNative(record.lumiContentId, owner);
    if (normalized.library !== original.library) fail('Keep the current activity type when editing this version.', 400);
    // Only existing saved media gets a copy-from-content prefix. New temporary
    // uploads stay unchanged and are checked by Lumi for this authenticated user.
    const media = collectTemplateMedia(original.library, original.params.params, getStudioCatalog().libraries, record.lumiContentId);
    const document = { library: normalized.library, metadata: normalized.metadata,
      parameters: copyMediaReferences(normalized.parameters, media) };
    const version = await createVersion({ session, run, document, representation: 'native-fork', title: normalized.title,
      summary: 'Saved changes in the advanced editor.', changes: ['Manual native H5P edit; course questions are unchanged.'], assertActive: guard });
    await acceptVersion(session, version, run, guard);
    await AuthoringMessage.updateOne({ sessionId: session._id, key: operation }, { $setOnInsert: { owner,
      sessionId: session._id, key: operation, role: 'assistant', text: `Saved your advanced editor changes as version ${version.number}. The previous version is preserved; course questions are unchanged.`, runId: run._id } }, { upsert: true });
    await AuthoringRun.updateOne({ _id: run._id }, { $set: { status: 'succeeded' } });
    const content = await H5PContent.findOne({ owner, lumiContentId: version.contentId });
    const native = await readNative(version.contentId, owner);
    return { result: { id: version.contentId, metadata: native.params.metadata }, record: content };
  } catch (error) {
    await AuthoringRun.updateOne({ _id: run._id }, { $set: { status: 'failed' } });
    await AuthoringSession.updateOne({ _id: session._id, activeRunId: run._id }, { $set: { status: 'ready' } });
    throw error;
  }
}
