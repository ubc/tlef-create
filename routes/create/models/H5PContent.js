import mongoose from 'mongoose';

const h5pContentSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null,
    index: true
  },
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    default: null,
    index: true
  },
  lumiContentId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 200
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  mainLibrary: {
    type: String,
    default: null,
    trim: true,
    maxlength: 200
  },
  source: {
    type: String,
    enum: ['editor', 'import', 'generated', 'ai-studio'],
    default: 'editor'
  },
  status: {
    type: String,
    enum: ['draft', 'ready'],
    default: 'draft'
  },
  sourceQuizUpdatedAt: {
    type: Date,
    default: null
  },
  sourceFingerprint: {
    type: String,
    default: null,
    maxlength: 80
  },
  assistantSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudioAssistantSession' },
  aiGeneration: {
    model: { type: String, maxlength: 200 },
    library: { type: String, maxlength: 200 },
    contractVersion: Number,
    validation: { type: String, enum: ['structural'] },
    attempts: Number,
    templateContentId: { type: String, maxlength: 200 }
  },
  lastEditedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'h5pcontents'
});

h5pContentSchema.index({ owner: 1, updatedAt: -1 });
h5pContentSchema.index({ owner: 1, quiz: 1, source: 1 });
h5pContentSchema.index({ owner: 1, assistantSessionId: 1 }, {
  unique: true, partialFilterExpression: { assistantSessionId: { $type: 'objectId' } }
});

export default mongoose.model('H5PContent', h5pContentSchema);
