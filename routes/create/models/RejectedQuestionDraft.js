import mongoose from 'mongoose';
import { questionReviewSummarySchema } from './questionReviewSummarySchema.js';

const similarity = { type: Number, min: 0, max: 1, validate: Number.isFinite };
const noveltyCheckSchema = new mongoose.Schema({
  similarity, threshold: similarity,
  questionId: { type: String, maxlength: 120 },
  questionText: { type: String, maxlength: 240 }
}, { _id: false });

// Instructor-owned rejected content, separate from privacy-limited job receipts.
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true },
  quiz: { type: mongoose.Schema.Types.ObjectId, required: true },
  job: { type: mongoose.Schema.Types.ObjectId, required: true },
  index: { type: Number, required: true },
  questionText: { type: String, maxlength: 16000 },
  correctAnswer: { type: String, maxlength: 16000 },
  options: [{ _id: false, text: { type: String, maxlength: 12000 }, isCorrect: Boolean }],
  contentSummary: { type: String, maxlength: 8000 },
  reviewSummary: { type: questionReviewSummarySchema, default: undefined },
  novelty: { type: new mongoose.Schema({
    method: { type: String, enum: ['lexical', 'lexical-and-semantic'] },
    similarity, noveltyScore: similarity,
    lexical: { type: noveltyCheckSchema, default: undefined },
    semantic: { type: noveltyCheckSchema, default: undefined }
  }, { _id: false }), default: undefined },
  issues: [{ type: String, maxlength: 2000 }],
  calculationCheck: { type: new mongoose.Schema({
    location: { type: String, required: true, maxlength: 40 },
    expression: { type: String, required: true, maxlength: 160 },
    computed: { type: Number, required: true, validate: Number.isFinite },
    claimed: { type: Number, required: true, validate: Number.isFinite }
  }, { _id: false }), default: undefined },
  reason: String
}, { timestamps: true });
schema.index({ owner: 1, job: 1, index: 1 }, { unique: true });
export default mongoose.model('RejectedQuestionDraft', schema);
