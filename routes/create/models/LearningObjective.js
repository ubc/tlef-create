import mongoose from 'mongoose';

const learningObjectiveSchema = new mongoose.Schema({
  // The actual learning objective text
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  
  // Relationships
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
    index: true
  },
  
  // Order within the quiz
  order: {
    type: Number,
    required: true,
    default: 0
  },
  
  // Which materials were used to generate this objective (for AI-generated objectives)
  generatedFrom: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material'
  }],
  
  // AI Generation Metadata
  generationMetadata: {
    isAIGenerated: { type: Boolean, default: false },
    llmModel: { type: String }, // e.g., "llama3.1:8b"
    generationPrompt: { type: String }, // The prompt used to generate this objective
    confidence: { 
      type: Number, 
      min: 0, 
      max: 1 
    }, // AI confidence score
    processingTime: { type: Number } // milliseconds to generate
  },
  
  // Edit History (track manual edits from frontend)
  editHistory: [{
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    editedAt: { type: Date, default: Date.now },
    changes: { type: String }, // Description of what was changed
    previousText: { type: String } // Previous version of the text
  }],
  
  // Access Control
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  collection: 'learningObjectives'
});

// Database Indexes for Performance
learningObjectiveSchema.index({ quiz: 1, order: 1 });
learningObjectiveSchema.index({ 'generationMetadata.isAIGenerated': 1 });

// Virtual Properties
learningObjectiveSchema.virtual('isGenerated').get(function() {
  return this.generationMetadata.isAIGenerated || false;
});

learningObjectiveSchema.virtual('wordCount').get(function() {
  return this.text ? this.text.split(' ').length : 0;
});

learningObjectiveSchema.virtual('hasEdits').get(function() {
  return this.editHistory && this.editHistory.length > 0;
});

// Instance Methods
learningObjectiveSchema.methods.updateText = function(newText, userId) {
  // Store previous version
  const previousText = this.text;
  
  // Update text
  this.text = newText;
  
  // Track the edit
  this.editHistory.push({
    editedBy: userId,
    changes: 'Text updated',
    previousText: previousText,
    editedAt: new Date()
  });
  
  return this.save();
};

learningObjectiveSchema.methods.reorder = function(newOrder) {
  this.order = newOrder;
  return this.save();
};

learningObjectiveSchema.methods.markAsAIGenerated = function(metadata) {
  this.generationMetadata = {
    isAIGenerated: true,
    llmModel: metadata.llmModel,
    generationPrompt: metadata.generationPrompt,
    confidence: metadata.confidence,
    processingTime: metadata.processingTime
  };
  return this.save();
};

learningObjectiveSchema.methods.addEdit = function(userId, changes, previousText) {
  this.editHistory.push({
    editedBy: userId,
    changes,
    previousText,
    editedAt: new Date()
  });
  return this.save();
};

// Static method to get ordered objectives for a quiz
learningObjectiveSchema.statics.getOrderedByQuiz = function(quizId) {
  return this.find({ quiz: quizId }).sort({ order: 1 });
};

// Static method to reorder all objectives in a quiz
learningObjectiveSchema.statics.reorderObjectives = async function(quizId, orderedIds) {
  const promises = orderedIds.map((id, index) => 
    this.findByIdAndUpdate(id, { order: index })
  );
  return Promise.all(promises);
};

// Ensure virtual fields are serialized
learningObjectiveSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('LearningObjective', learningObjectiveSchema);