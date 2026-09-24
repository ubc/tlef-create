import mongoose from 'mongoose';
import { beginQuestionMutation, withQuestionMutation } from '../services/questionPublication.js';

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
    aiEnriched: { type: Boolean, default: false },
    llmModel: { type: String }, // e.g., "llama3.1:8b"
    generationPrompt: { type: String }, // The prompt used to generate this objective
    sourceReferences: [{
      materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
      materialName: { type: String },
      sourceFile: { type: String },
      chunkIndex: { type: Number },
      pageNumber: { type: Number },
      pageStart: { type: Number },
      pageEnd: { type: Number },
      excerpt: { type: String },
      relevanceScore: { type: Number },
      section: { type: String },
      sectionId: { type: String }
    }],
    title: { type: String },
    topic: { type: String },
    subtopic: { type: String },
    sourceOutlineSection: { type: String },
    sourceSectionIds: [{ type: String }],
    subpoints: [{ type: String }],
    bloomLevel: { type: String },
    instructorAuthoredFields: [{
      type: String,
      enum: ['bloomLevel', 'subpoints']
    }],
    rationale: { type: String },
    promptSource: { type: String },
    promptVersion: { type: Number },
    coverageDiagnostics: {
      requiredSectionCount: { type: Number },
      coveredSectionCount: { type: Number },
      missingSectionIds: [{ type: String }],
      repairApplied: { type: Boolean }
    },
    inventoryDiagnostics: { type: mongoose.Schema.Types.Mixed },
    enrichmentDiagnostics: { type: mongoose.Schema.Types.Mixed },
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
learningObjectiveSchema.statics.getOrderedByQuiz = async function(quizId) {
  const quiz = await mongoose.model('Quiz').findById(quizId).select('learningObjectives');
  return this.find({ quiz: quizId, _id: { $in: quiz?.learningObjectives || [] } }).sort({ order: 1 });
};

// Static method to reorder all objectives in a quiz
learningObjectiveSchema.statics.reorderObjectives = async function(quizId, orderedIds) {
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findById(quizId).select('createdBy');
  if (!quiz) throw Object.assign(new Error('Learning object not found.'), { status: 404, code: 'NOT_FOUND' });
  return withQuestionMutation(Quiz, quizId, quiz.createdBy, async ({ quiz: current, writeQuiz }) => {
    if (orderedIds.length !== current.learningObjectives.length || new Set(orderedIds.map(String)).size !== orderedIds.length
      || current.learningObjectives.some(id => !orderedIds.map(String).includes(String(id)))) {
      throw Object.assign(new Error('The learning objective list changed. Refresh before reordering.'), { status: 409, code: 'OBJECTIVE_LIST_CHANGED' });
    }
    await writeQuiz({ $set: { learningObjectives: orderedIds } });
    return Promise.all(orderedIds.map(async (id, index) => {
      const objective = await this.findOneAndUpdate({ _id: id, quiz: quizId,
        $expr: { $lte: ['$$NOW', current.questionMutation.leaseUntil] } }, { order: index });
      if (!objective) throw Object.assign(new Error('The objective reorder lease expired. Refresh before reordering again.'), { status: 409, code: 'QUESTION_EDIT_EXPIRED' });
      return objective;
    }));
  });
};

// Changes to an existing objective invalidate the Quiz snapshot used for
// question generation, including AI enrichment and single-objective rewrites.
learningObjectiveSchema.pre('save', async function() {
  if (this.isNew || !this.isModified()) return;
  const Quiz = mongoose.model('Quiz');
  const mutation = await beginQuestionMutation(Quiz, this.quiz, this.createdBy);
  this.$locals.objectiveMutation = mutation;
  if (!mutation.quiz.learningObjectives.some(id => String(id) === String(this._id))) {
    throw Object.assign(new Error('The learning objective list changed. Refresh before editing.'), { status: 409, code: 'OBJECTIVE_LIST_CHANGED' });
  }
  this.$locals.previousSaveFilter = this.$where;
  // Fence the actual cross-document write as well as the surrounding checks.
  this.$where = { ...this.$where, $expr: { $lte: ['$$NOW', mutation.quiz.questionMutation.leaseUntil] } };
  await mutation.assertActive();
});
learningObjectiveSchema.post('save', async function(doc) {
  const mutation = doc.$locals.objectiveMutation;
  if (!mutation) return;
  delete doc.$locals.objectiveMutation;
  doc.$where = doc.$locals.previousSaveFilter;
  delete doc.$locals.previousSaveFilter;
  try { await mutation.assertActive(); }
  finally { await mutation.finish(); }
});
learningObjectiveSchema.post('save', function(error, doc, next) {
  const mutation = doc?.$locals?.objectiveMutation;
  if (!mutation) return next(error);
  delete doc.$locals.objectiveMutation;
  doc.$where = doc.$locals.previousSaveFilter;
  delete doc.$locals.previousSaveFilter;
  mutation.assertActive().then(() => error, leaseError => leaseError)
    .then(finalError => mutation.finish().then(() => next(finalError), () => next(finalError)));
});

// Ensure virtual fields are serialized
learningObjectiveSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('LearningObjective', learningObjectiveSchema);
