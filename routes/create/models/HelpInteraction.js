import mongoose from 'mongoose';

const helpSourceSchema = new mongoose.Schema({
  title: { type: String, maxlength: 300 },
  section: { type: String, maxlength: 300 },
  sourcePath: { type: String, maxlength: 500 },
  navigationPath: { type: String, maxlength: 500 }
}, { _id: false });

const helpInteractionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  question: { type: String, required: true, trim: true, maxlength: 2000 },
  answer: { type: String, default: '', maxlength: 20000 },
  context: {
    route: { type: String, maxlength: 500 },
    pageTitle: { type: String, maxlength: 160 },
    activeTab: { type: String, maxlength: 100 }
  },
  sources: [helpSourceSchema],
  model: { type: String, maxlength: 160 },
  fallback: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing',
    index: true
  },
  errorCode: { type: String, maxlength: 120 },
  durationMs: { type: Number, min: 0 },
  rating: {
    value: { type: String, enum: ['helpful', 'not-helpful'] },
    reasons: [{
      type: String,
      enum: ['incorrect', 'outdated', 'unclear', 'incomplete', 'other']
    }],
    comment: { type: String, trim: true, maxlength: 1000 },
    ratedAt: { type: Date }
  }
}, {
  timestamps: true,
  collection: 'helpInteractions'
});

helpInteractionSchema.index({ createdAt: -1 });
helpInteractionSchema.index({ 'rating.value': 1, createdAt: -1 });
helpInteractionSchema.index({ fallback: 1, createdAt: -1 });

export default mongoose.model('HelpInteraction', helpInteractionSchema);

