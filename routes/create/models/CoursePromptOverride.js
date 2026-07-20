import mongoose from 'mongoose';

const coursePromptOverrideSchema = new mongoose.Schema({
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    required: true,
    index: true
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  promptType: {
    type: String,
    enum: [
      'quiz-blueprint',
      'learning-objectives',
      'question-generation',
      'coverage-map',
      'history-summary',
      'question-validation'
    ],
    required: true,
    default: 'quiz-blueprint'
  },

  approach: {
    type: String,
    enum: ['support', 'assess', 'gamify', 'general'],
    required: true,
    default: 'general'
  },

  name: {
    type: String,
    trim: true,
    maxlength: 120,
    default: 'Course prompt'
  },

  customInnerPrompt: {
    type: String,
    required: true,
    maxlength: 12000
  },

  version: {
    type: Number,
    required: true,
    default: 1
  },

  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  validation: {
    status: {
      type: String,
      enum: ['valid', 'warning', 'invalid'],
      default: 'valid'
    },
    errors: [{ type: String }],
    warnings: [{ type: String }],
    suggestions: [{ type: String }],
    validatedAt: { type: Date },
    isSystemDefault: { type: Boolean, default: false },
    aiReview: {
      attempted: { type: Boolean, default: false },
      available: { type: Boolean, default: false },
      provider: { type: String },
      model: { type: String },
      error: { type: String }
    }
  },

  parentVersion: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CoursePromptOverride'
  },

  sourceOverride: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CoursePromptOverride'
  },

  sourceFolder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder'
  }
}, {
  timestamps: true,
  collection: 'course_prompt_overrides'
});

coursePromptOverrideSchema.index({
  folder: 1,
  promptType: 1,
  approach: 1,
  isActive: 1
});

coursePromptOverrideSchema.index({
  folder: 1,
  promptType: 1,
  approach: 1,
  version: -1
});

export default mongoose.model('CoursePromptOverride', coursePromptOverrideSchema);
