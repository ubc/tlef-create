import mongoose from 'mongoose';

const id = mongoose.Schema.Types.ObjectId;
// Author-owned content. These collections are deliberately separate from audit
// and job telemetry: messages and snapshots may contain private course content.
const session = new mongoose.Schema({
  owner: { type: id, required: true }, requestId: { type: String, required: true }, requestHash: String,
  courseId: { type: id, required: true }, quizId: id, assistantId: id,
  objectiveIds: [id], contextCourse: { type: Boolean, default: false },
  materialIds: [id], title: { type: String, maxlength: 200 }, instructions: { type: String, maxlength: 12000 },
  autoApprove: { type: Boolean, default: false },
  workflow: { type: mongoose.Schema.Types.Mixed, default: () => ({ version: 1, target: 'plan', autoContinue: false, automaticContinuations: 0 }) },
  teachingBrief: mongoose.Schema.Types.Mixed,
  mode: { type: String, enum: ['explore', 'build'], default: 'build' },
  teachingRequirements: { type: mongoose.Schema.Types.Mixed, default: () => ({ version: 1, fields: {}, openQuestions: [] }) },
  taskContext: { type: mongoose.Schema.Types.Mixed, default: () => ({ version: 1, observations: [], pending: [], selectedObjectiveIds: [], selectedMaterialIds: [] }) },
  nativePlan: mongoose.Schema.Types.Mixed,
  requirementsReady: { type: Boolean, default: false },
  requirementAnswers: { type: [{ _id: false, requestId: String, text: { type: String, maxlength: 4000 } }], default: [] },
  status: { type: String, default: 'waiting_for_materials', enum: ['exploring', 'waiting_for_materials', 'awaiting_requirements', 'planning', 'objectives_ready', 'awaiting_approval', 'generating', 'ready', 'working', 'needs_attention', 'cancelled'] },
  revision: { type: Number, default: 0 }, versionCounter: { type: Number, default: 0 },
  currentVersionId: id, candidateVersionId: id, activeRunId: id, publishedFingerprint: String,
  pendingRunIds: { type: [id], default: [] },
  error: String, createdAt: { type: Date, default: Date.now }
}, { timestamps: true });
session.index({ owner: 1, requestId: 1 }, { unique: true });
session.index({ owner: 1, updatedAt: -1 });

const message = new mongoose.Schema({
  owner: { type: id, required: true }, sessionId: { type: id, required: true },
  key: { type: String, required: true }, role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true, maxlength: 12000 }, runId: id,
  clarification: { type: [{ _id: false, question: { type: String, maxlength: 300 }, options: [{ type: String, maxlength: 180 }],
    selectionMode: { type: String, enum: ['single', 'multiple'] }, allowCustomInput: Boolean }], default: [] },
  createdAt: { type: Date, default: Date.now }
});
message.index({ sessionId: 1, key: 1 }, { unique: true });
message.index({ owner: 1, sessionId: 1, _id: 1 });

const run = new mongoose.Schema({
  owner: { type: id, required: true }, sessionId: { type: id, required: true },
  requestId: { type: String, required: true }, requestHash: String,
  kind: { type: String, enum: ['create', 'message', 'approve', 'retry', 'accept', 'reject', 'restore', 'manual', 'save_objectives'], required: true },
  nativeTeachingState: mongoose.Schema.Types.Mixed,
  partialBaseline: mongoose.Schema.Types.Mixed,
  nativeObjectiveEdit: mongoose.Schema.Types.Mixed,
  input: mongoose.Schema.Types.Mixed, baseVersionId: id,
  admitted: { type: Boolean, default: false },
  deferred: { type: Boolean, default: false },
  tokenUsageVersion: { type: Number, enum: [1] },
  tokenUsageRecordingFailed: Boolean,
  agentState: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ['queued', 'running', 'waiting', 'succeeded', 'failed', 'interrupted', 'cancelled'], default: 'queued' },
  steps: { type: [{ _id: false, name: String, createdAt: Date }], default: [] },
  operations: { type: [{ _id: false, id: String, runId: String, parentId: String, name: String, label: String, summary: { type: String, maxlength: 600 }, status: { type: String, enum: ['running', 'completed', 'failed'] }, startedAt: Date, completedAt: Date, durationMs: Number }], default: [] },
  checkpoint: { type: String, default: 'start' }, result: mongoose.Schema.Types.Mixed,
  startedAt: Date, leaseToken: String, leaseUntil: Date, nextAt: { type: Date, default: Date.now },
  cancelRequested: { type: Boolean, default: false }, error: String, errorCode: String,
  continuePlanning: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });
run.index({ owner: 1, requestId: 1 }, { unique: true });
run.index({ status: 1, nextAt: 1, leaseUntil: 1 });

const version = new mongoose.Schema({
  owner: { type: id, required: true }, sessionId: { type: id, required: true }, runId: { type: id, required: true },
  number: Number, parentId: id, restoredFromId: id,
  title: String, summary: String, changes: [String], contentId: { type: String, required: true },
  representation: { type: String, enum: ['course-linked', 'native-fork'], required: true },
  snapshot: mongoose.Schema.Types.Mixed, fingerprint: String,
  reviewSummary: mongoose.Schema.Types.Mixed, sourceReferences: mongoose.Schema.Types.Mixed, nativeSourceContract: mongoose.Schema.Types.Mixed,
  authoringSourceContract: mongoose.Schema.Types.Mixed,
  teachingBrief: mongoose.Schema.Types.Mixed,
  nativeTeachingSources: mongoose.Schema.Types.Mixed,
  publicationObjectiveMapping: mongoose.Schema.Types.Mixed,
  state: { type: String, enum: ['candidate', 'accepted', 'rejected'], default: 'candidate' },
  createdAt: { type: Date, default: Date.now }
});
version.index({ owner: 1, runId: 1 }, { unique: true });
version.index({ sessionId: 1, number: 1 }, { unique: true });

export const AuthoringSession = mongoose.model('StudioAuthoringSession', session);
export const AuthoringMessage = mongoose.model('StudioAuthoringMessage', message);
export const AuthoringRun = mongoose.model('StudioAuthoringRun', run);
export const AuthoringVersion = mongoose.model('StudioAuthoringVersion', version);
