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
    enum: ['editor', 'import', 'generated'],
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

export default mongoose.model('H5PContent', h5pContentSchema);
