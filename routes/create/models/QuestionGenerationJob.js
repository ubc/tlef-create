import mongoose from 'mongoose';

// Durable receipts contain no credentials, prompts, source text or model output.
// Do not TTL-delete idempotency keys: an old POST must never purchase a new run.
const itemSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  questionId: { type: String, required: true },
  savedQuestionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ['queued', 'generating', 'ready', 'failed'], default: 'queued' },
  code: String,
  message: String
}, { _id: false });

const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  quiz: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestId: { type: String, required: true, maxlength: 80 },
  requestHash: { type: String, required: true },
  sessionId: { type: String, required: true },
  mode: { type: String, enum: ['append', 'replace'], required: true },
  status: { type: String, enum: ['running', 'committing', 'succeeded', 'failed', 'interrupted', 'conflict'], required: true },
  active: { type: Boolean, required: true },
  abandoned: { type: Boolean, default: false },
  leaseToken: { type: String, required: true },
  leaseUntil: Date,
  baseQuestionIds: [{ type: mongoose.Schema.Types.ObjectId }],
  baseRevision: { type: Number, default: 0 },
  baseQuizVersion: { type: Number, default: 0 },
  items: [itemSchema],
  questionIds: [{ type: mongoose.Schema.Types.ObjectId }],
  message: String
}, { timestamps: true });

schema.index({ owner: 1, requestId: 1 }, { unique: true });
// Keep the legacy ordinary quiz_1 lookup index when upgrading existing databases.
// A distinct name allows this stricter index to be added without dropping it.
schema.index({ quiz: 1 }, { name: 'question_generation_active_quiz', unique: true, partialFilterExpression: { active: true } });
schema.index({ sessionId: 1 }, { unique: true });
schema.index({ owner: 1, quiz: 1, createdAt: -1 });
export default mongoose.model('QuestionGenerationJob', schema);
