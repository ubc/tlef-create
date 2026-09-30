import mongoose from 'mongoose';

const id = mongoose.Schema.Types.ObjectId;
// Author-owned content. These collections are deliberately separate from audit
// and job telemetry: messages and snapshots may contain private course content.
const session = new mongoose.Schema({
  owner: { type: id, required: true }, requestId: { type: String, required: true }, requestHash: String,
  courseId: { type: id, required: true }, quizId: id, assistantId: id,
  materialIds: [id], title: { type: String, maxlength: 200 }, instructions: { type: String, maxlength: 12000 },
  autoApprove: { type: Boolean, default: false },
  status: { type: String, default: 'waiting_for_materials', enum: ['waiting_for_materials', 'planning', 'awaiting_approval', 'generating', 'ready', 'working', 'needs_attention', 'cancelled'] },
  revision: { type: Number, default: 0 }, versionCounter: { type: Number, default: 0 },
  currentVersionId: id, candidateVersionId: id, activeRunId: id, publishedFingerprint: String,
  error: String, createdAt: { type: Date, default: Date.now }
}, { timestamps: true });
session.index({ owner: 1, requestId: 1 }, { unique: true });
session.index({ owner: 1, updatedAt: -1 });

const message = new mongoose.Schema({
  owner: { type: id, required: true }, sessionId: { type: id, required: true },
  key: { type: String, required: true }, role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true, maxlength: 12000 }, runId: id,
  createdAt: { type: Date, default: Date.now }
});
message.index({ sessionId: 1, key: 1 }, { unique: true });
message.index({ owner: 1, sessionId: 1, _id: 1 });

const run = new mongoose.Schema({
  owner: { type: id, required: true }, sessionId: { type: id, required: true },
  requestId: { type: String, required: true }, requestHash: String,
  kind: { type: String, enum: ['create', 'message', 'approve', 'retry', 'accept', 'reject', 'restore', 'manual'], required: true },
  input: mongoose.Schema.Types.Mixed, baseVersionId: id,
  admitted: { type: Boolean, default: false },
  status: { type: String, enum: ['queued', 'running', 'waiting', 'succeeded', 'failed', 'interrupted', 'cancelled'], default: 'queued' },
  steps: { type: [{ _id: false, name: String, createdAt: Date }], default: [] },
  checkpoint: { type: String, default: 'start' }, result: mongoose.Schema.Types.Mixed,
  leaseToken: String, leaseUntil: Date, nextAt: { type: Date, default: Date.now },
  cancelRequested: { type: Boolean, default: false }, error: String,
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
  state: { type: String, enum: ['candidate', 'accepted', 'rejected'], default: 'candidate' },
  createdAt: { type: Date, default: Date.now }
});
version.index({ owner: 1, runId: 1 }, { unique: true });
version.index({ sessionId: 1, number: 1 }, { unique: true });

export const AuthoringSession = mongoose.model('StudioAuthoringSession', session);
export const AuthoringMessage = mongoose.model('StudioAuthoringMessage', message);
export const AuthoringRun = mongoose.model('StudioAuthoringRun', run);
export const AuthoringVersion = mongoose.model('StudioAuthoringVersion', version);
