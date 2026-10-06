import mongoose from 'mongoose';

const count = { type: Number, min: 0, default: null };
// Usage receipts contain provider counters and identities only. Never store
// prompts, source material, response text, credentials or raw provider errors.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  runId: { type: mongoose.Schema.Types.ObjectId, required: true },
  operationId: String,
  stage: { type: String, maxlength: 100 },
  provider: { type: String, maxlength: 80 },
  model: { type: String, maxlength: 180 },
  responseId: { type: String, maxlength: 180 },
  status: { type: String, enum: ['pending', 'reported', 'unavailable'], required: true },
  outcome: { type: String, enum: ['succeeded', 'failed'], default: undefined },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  inputTokens: count,
  outputTokens: count,
  totalTokens: count,
  reasoningTokens: count,
  cachedInputTokens: count,
  cacheWriteTokens: count
}, { timestamps: true, bufferCommands: false });

schema.index({ owner: 1, sessionId: 1, runId: 1 });
export default mongoose.model('ModelTokenReceipt', schema);
