import mongoose from 'mongoose';
import { PEDAGOGICAL_APPROACHES, PLAN_STATUS, QUESTION_TYPES } from '../config/constants.js';

const generationPlanSchema = new mongoose.Schema({
  // Relationships
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
    index: true
  },
  
  // Plan Configuration
  approach: {
    type: String,
    enum: Object.values(PEDAGOGICAL_APPROACHES),
    required: true
  },
  
  questionsPerLO: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  
  totalQuestions: {
    type: Number,
    required: true
  },

  // Custom Formula (for advanced settings)
  customFormula: {
    questionTypes: [{
      type: { type: String },
      count: { type: Number },
      percentage: { type: Number },
      scope: { 
        type: String, 
        enum: ['per-lo', 'whole-quiz'],
        default: 'per-lo' 
      },
      editMode: { 
        type: String, 
        enum: ['count', 'percentage'],
        default: 'count' 
      }
    }],
    totalPerLO: { type: Number },
    totalWholeQuiz: { type: Number },
    totalQuestions: { type: Number }
  },
  
  // Detailed Breakdown per Learning Objective
  breakdown: [{
    learningObjective: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LearningObjective',
      required: true
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
      reasoning: {
        type: String // AI's reasoning for why this question type
      }
    }]
  }],
  
  // Overall Distribution Summary
  distribution: [{
    type: {
      type: String,
      enum: Object.values(QUESTION_TYPES),
      required: true
    },
    totalCount: {
      type: Number,
      required: true
    },
    percentage: {
      type: Number,
      min: 0,
      max: 100
    }
  }],
  
  // AI Generation Metadata
  generationMetadata: {
    llmModel: { type: String }, // e.g., "llama3.1:8b"
    generationPrompt: { type: String },
    processingTime: { type: Number }, // milliseconds
    confidence: { 
      type: Number, 
      min: 0, 
      max: 1 
    },
    reasoning: { type: String } // AI's overall reasoning for the plan
  },
  
  // Plan Status
  status: {
    type: String,
    enum: Object.values(PLAN_STATUS),
    default: PLAN_STATUS.DRAFT,
    index: true
  },
  
  // Modification History
  modifications: [{
    modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    modifiedAt: { type: Date, default: Date.now },
    changes: { type: String }, // Description of changes
    previousBreakdown: [{ type: mongoose.Schema.Types.Mixed }] // Store previous version
  }],
  
  // Access Control
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'generationPlans'
});

// Database Indexes
generationPlanSchema.index({ quiz: 1, createdAt: -1 });
generationPlanSchema.index({ approach: 1 });
generationPlanSchema.index({ status: 1 });

// Virtual Properties
generationPlanSchema.virtual('questionTypeCount').get(function() {
  return this.distribution ? this.distribution.length : 0;
});

generationPlanSchema.virtual('isModified').get(function() {
  return this.modifications && this.modifications.length > 0;
});

generationPlanSchema.virtual('isApproved').get(function() {
  return this.status === PLAN_STATUS.APPROVED;
});

generationPlanSchema.virtual('isDraft').get(function() {
  return this.status === PLAN_STATUS.DRAFT;
});

// Instance Methods
generationPlanSchema.methods.approve = function() {
  console.log('📋 Approving plan, updating status to APPROVED');
  this.status = PLAN_STATUS.APPROVED;
  
  // Manually update distribution since pre-save middleware is disabled
  try {
    if (typeof this.updateDistribution === 'function') {
      console.log('📋 Manually updating distribution before save');
      this.updateDistribution();
    }
  } catch (error) {
    console.error('❌ Error updating distribution in approve method:', error);
    // Continue with save even if distribution update fails
  }
  
  return this.save();
};

generationPlanSchema.methods.markAsUsed = function() {
  this.status = PLAN_STATUS.USED;
  return this.save();
};

generationPlanSchema.methods.addModification = function(userId, changes, previousData) {
  this.modifications.push({
    modifiedBy: userId,
    changes,
    previousBreakdown: previousData,
    modifiedAt: new Date()
  });
  this.status = PLAN_STATUS.MODIFIED;
  return this.save();
};

generationPlanSchema.methods.updateBreakdown = function(newBreakdown, userId) {
  // Store previous version
  const previousData = this.breakdown;
  
  // Update breakdown
  this.breakdown = newBreakdown;
  
  // Recalculate totals
  this.totalQuestions = newBreakdown.reduce((total, lo) => {
    return total + lo.questionTypes.reduce((loTotal, qt) => loTotal + qt.count, 0);
  }, 0);
  
  // Manually update distribution since pre-save middleware is disabled
  try {
    if (typeof this.updateDistribution === 'function') {
      console.log('📋 Manually updating distribution in updateBreakdown');
      this.updateDistribution();
    }
  } catch (error) {
    console.error('❌ Error updating distribution in updateBreakdown:', error);
  }
  
  // Track modification
  return this.addModification(userId, 'Breakdown updated', previousData);
};

generationPlanSchema.methods.updateDistribution = function() {
  const typeCount = {};
  
  // Count all question types across all LOs
  this.breakdown.forEach(lo => {
    lo.questionTypes.forEach(qt => {
      typeCount[qt.type] = (typeCount[qt.type] || 0) + qt.count;
    });
  });
  
  // Update distribution array
  this.distribution = Object.entries(typeCount).map(([type, count]) => ({
    type,
    totalCount: count,
    percentage: Math.round((count / this.totalQuestions) * 100)
  }));
  
  // Don't save here - let the calling method handle saving
  return this;
};

// Static method to get the active plan for a quiz
generationPlanSchema.statics.getActivePlan = function(quizId) {
  return this.findOne({ 
    quiz: quizId, 
    status: { $in: [PLAN_STATUS.APPROVED, PLAN_STATUS.USED] }
  }).sort({ updatedAt: -1 });
};

// Static method to get all plans for a quiz
generationPlanSchema.statics.getPlansForQuiz = function(quizId) {
  return this.find({ quiz: quizId }).sort({ createdAt: -1 });
};

// Pre-save middleware to update distribution before saving
// Temporarily disabled due to context issues - handle distribution updates manually
/*
generationPlanSchema.pre('save', function(next) {
  try {
    console.log('🔄 Pre-save middleware called, this:', this.constructor?.name, 'isNew:', this.isNew);
    
    // Check if this is a proper Mongoose document
    if (typeof this.isModified !== 'function') {
      console.error('❌ this.isModified is not a function, skipping distribution update');
      console.error('❌ this type:', typeof this, 'constructor:', this.constructor?.name);
      return next(); // Skip the distribution update but continue with save
    }
    
    // Only update distribution if breakdown changed or it's a new document
    if (this.isNew || this.isModified('breakdown')) {
      console.log('🔄 Updating distribution before save');
      if (typeof this.updateDistribution === 'function') {
        this.updateDistribution();
      } else {
        console.error('❌ updateDistribution method not found, skipping');
      }
    } else {
      console.log('⏭️ No need to update distribution');
    }
    next();
  } catch (error) {
    console.error('❌ Error in pre-save middleware:', error);
    next(); // Continue save even if distribution update fails
  }
});
*/

// Ensure virtual fields are serialized
generationPlanSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('GenerationPlan', generationPlanSchema);