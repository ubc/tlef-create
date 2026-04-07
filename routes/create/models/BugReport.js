import mongoose from 'mongoose';

const bugReportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['bug', 'incorrect', 'unclear', 'other'],
    default: 'bug'
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  email: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open',
    index: true
  },
  adminNotes: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  collection: 'bugreports'
});

bugReportSchema.index({ createdAt: -1 });

export default mongoose.model('BugReport', bugReportSchema);
