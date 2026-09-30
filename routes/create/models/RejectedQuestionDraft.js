import mongoose from 'mongoose';

// Instructor-owned rejected content, separate from privacy-limited job receipts.
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true },
  quiz: { type: mongoose.Schema.Types.ObjectId, required: true },
  job: { type: mongoose.Schema.Types.ObjectId, required: true },
  index: { type: Number, required: true },
  questionText: { type: String, maxlength: 16000 },
  correctAnswer: { type: String, maxlength: 16000 },
  options: [{ _id: false, text: { type: String, maxlength: 12000 }, isCorrect: Boolean }],
  issues: [{ type: String, maxlength: 2000 }],
  reason: String
}, { timestamps: true });
schema.index({ owner: 1, job: 1, index: 1 }, { unique: true });
export default mongoose.model('RejectedQuestionDraft', schema);
