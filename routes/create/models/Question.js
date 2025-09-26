import mongoose from 'mongoose';
import { QUESTION_TYPES, DIFFICULTY_LEVELS, REVIEW_STATUS } from '../config/constants.js';

const questionSchema = new mongoose.Schema({
  // Relationships
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
    index: true
  },
  
  learningObjective: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningObjective',
    required: true,
    index: true
  },
  
  // Reference to the generation plan that created this question
  generationPlan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GenerationPlan',
    index: true
  },
  
  // Question Properties
  type: {
    type: String,
    enum: Object.values(QUESTION_TYPES),
    required: true,
    index: true
  },
  
  difficulty: {
    type: String,
    enum: Object.values(DIFFICULTY_LEVELS),
    required: true,
    index: true
  },
  
  // Question Content
  questionText: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  
  // Flexible content structure for different question types
  content: {
    // For Multiple Choice & True/False
    options: [{
      text: { type: String, required: true },
      isCorrect: { type: Boolean, default: false },
      order: { type: Number }
    }],
    
    // For Flashcard
    front: { type: String }, // Question side
    back: { type: String },  // Answer side
    
    // For Matching
    leftItems: [{ type: String }],  // [A, B, C, D]
    rightItems: [{ type: String }], // [E, F, G, H]
    matchingPairs: [[{ type: String }]], // [[A,F], [B,E], [C,H], [D,G]]
    
    // For Ordering
    items: [{ type: String }], // [A, B, C, D, E, F]
    correctOrder: [{ type: String }], // [E, B, D, C, A, F]
    
    // For Cloze (fill in the blanks)
    textWithBlanks: { type: String }, // "Text $ more text $ end"
    blankOptions: [[{ type: String }]], // [[A,B,C,D], [A,E,F]] for each blank
    correctAnswers: [{ type: String }], // [A, E] for each blank
    
    // For Summary questions
    title: { type: String }, // Study guide title
    additionalNotes: { type: String }, // Additional notes for the study guide
    keyPoints: [{
      title: { type: String, required: true },
      explanation: { type: String, required: true }
    }]
  },
  
  // Simple correct answer for basic question types
  correctAnswer: {
    type: mongoose.Schema.Types.Mixed // Can be string, array, or object
  },
  
  // Additional Content
  explanation: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  
  // Question Order (for sequencing questions in quiz)
  order: { 
    type: Number, 
    default: 0 
  },
  
  // AI Generation Metadata
  generationMetadata: {
    generatedFrom: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Material' 
    }], // Which materials were used to generate this question
    llmModel: { type: String }, // e.g., "llama3.1:8b"
    generationPrompt: { type: String }, // The prompt used
    confidence: { 
      type: Number, 
      min: 0, 
      max: 1 
    }, // AI confidence score
    processingTime: { type: Number } // milliseconds to generate
  },
  
  // Review Status (from frontend Tab 4)
  reviewStatus: { 
    type: String, 
    enum: Object.values(REVIEW_STATUS), 
    default: REVIEW_STATUS.PENDING,
    index: true
  },
  
  // Edit History (track manual edits)
  editHistory: [{
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    editedAt: { type: Date, default: Date.now },
    changes: { type: String }, // Description of what was changed
    previousVersion: {
      questionText: { type: String },
      content: { type: mongoose.Schema.Types.Mixed },
      correctAnswer: { type: mongoose.Schema.Types.Mixed }
    }
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
  collection: 'questions'
});

// Database Indexes for Performance
questionSchema.index({ quiz: 1, order: 1 });
questionSchema.index({ learningObjective: 1 });
questionSchema.index({ type: 1, difficulty: 1 });
questionSchema.index({ reviewStatus: 1 });

// Virtual Properties
questionSchema.virtual('isMultipleChoice').get(function() {
  return this.type === QUESTION_TYPES.MULTIPLE_CHOICE;
});

questionSchema.virtual('isTrueFalse').get(function() {
  return this.type === QUESTION_TYPES.TRUE_FALSE;
});

questionSchema.virtual('optionCount').get(function() {
  return this.content?.options ? this.content.options.length : 0;
});

questionSchema.virtual('isApproved').get(function() {
  return this.reviewStatus === REVIEW_STATUS.APPROVED;
});

questionSchema.virtual('needsReview').get(function() {
  return this.reviewStatus === REVIEW_STATUS.NEEDS_REVIEW;
});

questionSchema.virtual('hasEdits').get(function() {
  return this.editHistory && this.editHistory.length > 0;
});

// Instance Methods
questionSchema.methods.markAsReviewed = function(status = REVIEW_STATUS.APPROVED) {
  this.reviewStatus = status;
  return this.save();
};

questionSchema.methods.addEdit = function(userId, changes, previousData) {
  this.editHistory.push({
    editedBy: userId,
    changes,
    previousVersion: previousData,
    editedAt: new Date()
  });
  return this.save();
};

questionSchema.methods.updateContent = function(updates, userId) {
  // Store previous version
  const previousData = {
    questionText: this.questionText,
    content: this.content,
    correctAnswer: this.correctAnswer
  };
  
  // Apply updates
  Object.assign(this, updates);
  
  // Track the edit
  return this.addEdit(userId, 'Manual content update', previousData);
};

questionSchema.methods.reorder = function(newOrder) {
  this.order = newOrder;
  return this.save();
};

questionSchema.methods.approve = function() {
  this.reviewStatus = REVIEW_STATUS.APPROVED;
  return this.save();
};

questionSchema.methods.reject = function() {
  this.reviewStatus = REVIEW_STATUS.REJECTED;
  return this.save();
};

questionSchema.methods.markForReview = function() {
  this.reviewStatus = REVIEW_STATUS.NEEDS_REVIEW;
  return this.save();
};

// Static methods
questionSchema.statics.getByQuizOrdered = function(quizId) {
  return this.find({ quiz: quizId }).sort({ order: 1 });
};

questionSchema.statics.getByLearningObjective = function(learningObjectiveId) {
  return this.find({ learningObjective: learningObjectiveId }).sort({ order: 1 });
};

questionSchema.statics.reorderQuestions = async function(quizId, orderedIds) {
  const promises = orderedIds.map((id, index) => 
    this.findByIdAndUpdate(id, { order: index })
  );
  return Promise.all(promises);
};

questionSchema.statics.getByReviewStatus = function(quizId, status) {
  return this.find({ quiz: quizId, reviewStatus: status });
};

// Ensure virtual fields are serialized
questionSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('Question', questionSchema);