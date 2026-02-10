import mongoose from 'mongoose';

const systemPromptTemplateSchema = new mongoose.Schema({
  approach: {
    type: String,
    enum: ['support', 'assess', 'gamify'],
    required: true,
    unique: true
  },

  version: {
    type: Number,
    default: 1
  },

  isActive: {
    type: Boolean,
    default: true
  },

  // 外层 prompt - 控制输出格式，不可由用户编辑
  outerPrompt: {
    type: String,
    required: true
  },

  // 内层 prompt - 用户可编辑的策略部分
  innerPrompt: {
    type: String,
    required: true
  },

  // 问题类型规则
  questionTypeRules: {
    allowedTypes: [{
      type: String,
      enum: ['multiple-choice', 'true-false', 'flashcard', 'summary', 'discussion', 'matching', 'ordering', 'cloze']
    }],

    // 建议的分布比例
    distribution: {
      type: Map,
      of: Number
    },

    // 每个 LO 的最大数量限制
    maxPerLO: {
      type: Map,
      of: Number
    }
  },

  // 描述和帮助文本
  description: {
    type: String
  },

  exampleOutput: {
    type: String
  }
}, {
  timestamps: true,
  collection: 'system_prompt_templates'
});

// 索引
systemPromptTemplateSchema.index({ approach: 1, isActive: 1 });

export default mongoose.model('SystemPromptTemplate', systemPromptTemplateSchema);
