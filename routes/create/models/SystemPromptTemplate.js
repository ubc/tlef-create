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

  // Outer prompt controls output format and cannot be edited by users.
  outerPrompt: {
    type: String,
    required: true
  },

  // Inner prompt contains the user-editable strategy.
  innerPrompt: {
    type: String,
    required: true
  },

  // Question type rules
  questionTypeRules: {
    allowedTypes: [{
      type: String,
      enum: ['multiple-choice', 'true-false', 'flashcard', 'guess-the-answer', 'summary', 'discussion', 'matching', 'ordering', 'cloze', 'mark-the-words', 'single-choice-set', 'essay', 'question-set', 'free-text', 'open-ended', 'simple-multi-choice', 'sort-paragraphs', 'crossword', 'dictation', 'arithmetic-quiz', 'branching-scenario', 'documentation-tool']
    }],

    // Recommended distribution
    distribution: {
      type: Map,
      of: Number
    },

    // Maximum count per learning objective
    maxPerLO: {
      type: Map,
      of: Number
    }
  },

  // Description and help text
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

// Index
systemPromptTemplateSchema.index({ approach: 1, isActive: 1 });

export default mongoose.model('SystemPromptTemplate', systemPromptTemplateSchema);
