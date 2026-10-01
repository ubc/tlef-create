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
