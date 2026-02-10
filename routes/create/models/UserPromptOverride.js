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

  // 用户自定义的内层 prompt
  customInnerPrompt: {
    type: String,
    required: true
  },

  isActive: {
    type: Boolean,
    default: true
  },

  // 用户可以选择覆盖问题类型规则
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

  // 使用次数统计
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

// 复合索引
userPromptOverrideSchema.index({ user: 1, approach: 1, isActive: 1 });

export default mongoose.model('UserPromptOverride', userPromptOverrideSchema);
