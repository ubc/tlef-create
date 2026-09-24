import mongoose from 'mongoose';

// Stores recovery metadata only: never prompts, source text, keys or model output.
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestId: { type: String, required: true, maxlength: 80 },
  status: { type: String, enum: ['running', 'succeeded', 'failed', 'interrupted'], required: true },
  leaseUntil: Date,
  contentId: String,
  message: String,
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
schema.index({ owner: 1, requestId: 1 }, { unique: true });
schema.index({ owner: 1 }, { unique: true, partialFilterExpression: { status: 'running' } });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model('StudioGenerationJob', schema);
