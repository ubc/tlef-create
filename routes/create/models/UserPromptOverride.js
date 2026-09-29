import mongoose from 'mongoose';

const userPromptOverrideSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  approach: {
    type: String,
    enum: ['support', 'assess', 'gamify'],
    required: true
  },

  // User-defined inner prompt
  customInnerPrompt: {
    type: String,
    required: true
  },

  isActive: {
    type: Boolean,
    default: true
  },

  // Users may override question type rules.
  customQuestionTypeRules: {
    allowedTypes: [{
      type: String
    }],
    distribution: {
      type: Map,
      of: Number
    },
    maxPerLO: {
      type: Map,
      of: Number
    }
  },

  // Usage count
  usageCount: {
    type: Number,
    default: 0
  },

  lastUsed: {
    type: Date
  }
}, {
  timestamps: true,
  collection: 'user_prompt_overrides'
});

// Compound index
userPromptOverrideSchema.index({ user: 1, approach: 1, isActive: 1 });

export default mongoose.model('UserPromptOverride', userPromptOverrideSchema);
