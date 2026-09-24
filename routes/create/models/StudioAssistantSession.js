import mongoose from 'mongoose';

// This is instructor-owned authoring data, not an audit log. It preserves the
// approved brief and plan across browser disconnects without replaying AI calls.
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestId: { type: String, required: true, maxlength: 80 },
  requestHash: { type: String, required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', required: true },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  quizName: { type: String, required: true, maxlength: 200 },
  createdQuiz: { type: Boolean, default: false },
  materialIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Material' }],
  instructions: { type: String, required: true, maxlength: 12000 },
  revision: { type: Number, default: 0 },
  status: { type: String, required: true, enum: ['planning', 'awaiting_approval', 'generating', 'completed', 'failed', 'interrupted'] },
  phase: { type: String, enum: ['planning', 'generating'], default: 'planning' },
  objectives: { type: [mongoose.Schema.Types.Mixed], default: [] },
  plan: { type: [mongoose.Schema.Types.Mixed], default: [] },
  sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
  materialSignature: String,
  materialFingerprint: String,
  quizFingerprint: String,
  currentJobId: String,
  questionJobRequestId: String,
  approvedRevision: Number,
  approvedAt: Date,
  approvedPlanHash: String,
  outputs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  events: { type: [{ _id: false, stage: String, message: String, createdAt: { type: Date, default: Date.now } }], default: [] },
  error: { type: String, default: '' },
  errorCode: String,
  attempt: { type: Number, default: 0 }
}, { timestamps: true, collection: 'studioAssistantSessions' });

schema.index({ owner: 1, requestId: 1 }, { unique: true });
schema.index({ owner: 1, updatedAt: -1 });
export default mongoose.model('StudioAssistantSession', schema);
