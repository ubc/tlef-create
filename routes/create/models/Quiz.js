import mongoose from 'mongoose';
import { PEDAGOGICAL_APPROACHES, DIFFICULTY_LEVELS, QUIZ_STATUS, QUESTION_TYPES } from '../config/constants.js';

const quizSchema = new mongoose.Schema({
  // Basic Quiz Information
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  }, // e.g., "Quiz 1", "Midterm Quiz"
  
  // Relationships
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    required: true,
    index: true
  },
  
  materials: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material'
  }], // Assigned materials for this quiz
  
  learningObjectives: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningObjective'
  }],
  
  questions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question'
  }],
  
  // Generation Plans (can have multiple plans - drafts, approved, etc.)
  generationPlans: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GenerationPlan'
  }],
  
  // Current active plan being used for generation
  activePlan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GenerationPlan'
  },
  
  // Quiz Generation Settings (from frontend)
  settings: {
    pedagogicalApproach: {
      type: String,
      enum: Object.values(PEDAGOGICAL_APPROACHES),
      default: PEDAGOGICAL_APPROACHES.SUPPORT,
      index: true
    },

    questionsPerObjective: {
      type: Number,
      default: 3,
      min: 1,
      max: 10
    },

    questionTypes: [{
      type: {
        type: String,
        enum: Object.values(QUESTION_TYPES),
        required: true
      },
      count: {
        type: Number,
        required: true,
        min: 0
      },
      scope: {
        type: String,
        enum: ['per-lo', 'whole-quiz'],
        default: 'per-lo'
      },
      percentage: {
        type: Number,
        default: 0
      }
    }],

    // Custom formula totals
    totalPerLO: {
      type: Number,
      default: 0
    },
    totalWholeQuiz: {
      type: Number,
      default: 0
    },

    difficulty: {
      type: String,
      enum: Object.values(DIFFICULTY_LEVELS),
      default: DIFFICULTY_LEVELS.MODERATE
    },

    // New plan-based system
    planMode: {
      type: String,
      enum: ['manual', 'ai-auto'],
      default: 'manual'
    },

    planItems: [{
      type: {
        type: String,
        enum: Object.values(QUESTION_TYPES),
        required: true
      },
      learningObjective: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LearningObjective',
        required: true
      },
      count: {
        type: Number,
        required: true,
        min: 1
      }
    }],

    aiConfig: {
      totalQuestions: {
        type: Number,
        default: 30,
        min: 5,
        max: 100
      },
      approach: {
        type: String,
        enum: [...Object.values(PEDAGOGICAL_APPROACHES).filter(a => a !== 'custom'), null]
      },
      additionalInstructions: {
        type: String,
        maxlength: 1000
      }
    }
  },
  
  // Generation History (track AI generation attempts)
  generationHistory: [{
    timestamp: { type: Date, default: Date.now },
    approach: { type: String },
    questionsGenerated: { type: Number },
    processingTime: { type: Number }, // milliseconds
    llmModel: { type: String }, // e.g., "llama3.1:8b"
    success: { type: Boolean, default: true },
    errorMessage: { type: String }
  }],
  
  // Quiz Status and Progress (updated for planning workflow)
  status: {
    type: String,
    enum: Object.values(QUIZ_STATUS),
    default: QUIZ_STATUS.DRAFT,
    index: true
  },
  
  progress: {
    materialsAssigned: { type: Boolean, default: false },
    objectivesSet: { type: Boolean, default: false },
    planGenerated: { type: Boolean, default: false },
    planApproved: { type: Boolean, default: false },
    questionsGenerated: { type: Boolean, default: false },
    reviewCompleted: { type: Boolean, default: false }
  },
  
  // H5P Export Information
  exports: [{
    format: { type: String, default: 'h5p' },
    exportedAt: { type: Date, default: Date.now },
    filePath: { type: String },
    downloadCount: { type: Number, default: 0 }
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
  collection: 'quizzes'
});

// Database Indexes for Performance
quizSchema.index({ folder: 1, status: 1 });
quizSchema.index({ createdBy: 1, createdAt: -1 });
quizSchema.index({ 'settings.pedagogicalApproach': 1 });

// Virtual Properties (computed fields)
quizSchema.virtual('questionCount').get(function() {
  return this.questions ? this.questions.length : 0;
});

quizSchema.virtual('objectiveCount').get(function() {
  return this.learningObjectives ? this.learningObjectives.length : 0;
});

quizSchema.virtual('materialCount').get(function() {
  return this.materials ? this.materials.length : 0;
});

quizSchema.virtual('planCount').get(function() {
  return this.generationPlans ? this.generationPlans.length : 0;
});

quizSchema.virtual('isCompleted').get(function() {
  return this.status === QUIZ_STATUS.COMPLETED;
});

quizSchema.virtual('isDraft').get(function() {
  return this.status === QUIZ_STATUS.DRAFT;
});

quizSchema.virtual('hasActivePlan').get(function() {
  return this.activePlan !== null && this.activePlan !== undefined;
});

// Instance Methods
quizSchema.methods.updateProgress = function() {
  this.progress.materialsAssigned = this.materials.length > 0;
  this.progress.objectivesSet = this.learningObjectives.length > 0;
  this.progress.planGenerated = this.generationPlans.length > 0;
  this.progress.planApproved = this.activePlan !== null;
  this.progress.questionsGenerated = this.questions.length > 0;
  
  // Update status based on progress
  if (this.progress.questionsGenerated) {
    this.status = QUIZ_STATUS.COMPLETED;
  } else if (this.progress.planApproved) {
    this.status = QUIZ_STATUS.PLAN_APPROVED;
  } else if (this.progress.planGenerated) {
    this.status = QUIZ_STATUS.PLAN_GENERATED;
  } else if (this.progress.objectivesSet) {
    this.status = QUIZ_STATUS.OBJECTIVES_SET;
  } else if (this.progress.materialsAssigned) {
    this.status = QUIZ_STATUS.MATERIALS_ASSIGNED;
  }
  
  return this.save();
};

quizSchema.methods.addGenerationRecord = function(data) {
  this.generationHistory.push({
    ...data,
    timestamp: new Date()
  });
  return this.save();
};

quizSchema.methods.addGenerationPlan = function(planId) {
  if (!this.generationPlans.includes(planId)) {
    this.generationPlans.push(planId);
    return this.updateProgress();
  }
  return Promise.resolve(this);
};

quizSchema.methods.setActivePlan = function(planId) {
  this.activePlan = planId;
  return this.updateProgress();
};

quizSchema.methods.addExport = function(filePath) {
  this.exports.push({
    format: 'h5p',
    filePath,
    exportedAt: new Date()
  });
  return this.save();
};

quizSchema.methods.addMaterial = function(materialId) {
  if (!this.materials.includes(materialId)) {
    this.materials.push(materialId);
    return this.updateProgress();
  }
  return Promise.resolve(this);
};

quizSchema.methods.removeMaterial = function(materialId) {
  this.materials = this.materials.filter(id => !id.equals(materialId));
  return this.updateProgress();
};

quizSchema.methods.addLearningObjective = function(objectiveId) {
  if (!this.learningObjectives.includes(objectiveId)) {
    this.learningObjectives.push(objectiveId);
    return this.updateProgress();
  }
  return Promise.resolve(this);
};

quizSchema.methods.removeLearningObjective = function(objectiveId) {
  this.learningObjectives = this.learningObjectives.filter(id => !id.equals(objectiveId));
  return this.updateProgress();
};

quizSchema.methods.addQuestion = function(questionId) {
  if (!this.questions.includes(questionId)) {
    this.questions.push(questionId);
    return this.updateProgress();
  }
  return Promise.resolve(this);
};

quizSchema.methods.removeQuestion = function(questionId) {
  this.questions = this.questions.filter(id => !id.equals(questionId));
  return this.updateProgress();
};

quizSchema.methods.setStatus = function(status) {
  this.status = status;
  return this.save();
};

// Static methods
quizSchema.statics.getByFolder = function(folderId) {
  return this.find({ folder: folderId }).sort({ createdAt: -1 });
};

quizSchema.statics.getByStatus = function(status) {
  return this.find({ status }).sort({ updatedAt: -1 });
};

quizSchema.statics.getByUser = function(userId) {
  return this.find({ createdBy: userId }).sort({ createdAt: -1 });
};

// Pre-save middleware to update progress before saving
quizSchema.pre('save', function(next) {
  if (this.isModified('materials') || this.isModified('learningObjectives') || 
      this.isModified('generationPlans') || this.isModified('activePlan') || 
      this.isModified('questions')) {
    
    this.progress.materialsAssigned = this.materials.length > 0;
    this.progress.objectivesSet = this.learningObjectives.length > 0;
    this.progress.planGenerated = this.generationPlans.length > 0;
    this.progress.planApproved = this.activePlan !== null;
    this.progress.questionsGenerated = this.questions.length > 0;
  }
  next();
});

// Ensure virtual fields are serialized
quizSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('Quiz', quizSchema);