import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  // CWL Authentication (UBC Campus-Wide Login)
  cwlId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  
  // CWL Password (hashed)
  password: {
    type: String,
    required: true
  },
  
  // Authentication & Session Management  
  lastLogin: { type: Date, default: Date.now },
  
  // Usage Statistics (for dashboard)
  stats: {
    coursesCreated: { type: Number, default: 0 },
    quizzesGenerated: { type: Number, default: 0 },
    questionsCreated: { type: Number, default: 0 },
    totalUsageTime: { type: Number, default: 0 }, // minutes
    lastActivity: { type: Date, default: Date.now }
  },

  // AI Model Preferences
  preferences: {
    llmProvider: {
      type: String,
      enum: ['ollama', 'openai'],
      default: 'ollama'
    },
    llmModel: {
      type: String,
      default: function() {
        return this.preferences?.llmProvider === 'openai' ? 'gpt-4o-mini' : 'llama3.1:8b';
      }
    },
    // Store custom model parameters
    llmSettings: {
      temperature: { type: Number, default: 0.7, min: 0, max: 2 },
      maxTokens: { type: Number, default: 2000, min: 100, max: 4000 }
    }
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  collection: 'users'
});

// Database Indexes for Performance
userSchema.index({ lastLogin: -1 });
userSchema.index({ 'stats.lastActivity': -1 });

// Virtual Properties (computed fields)
userSchema.virtual('displayName').get(function() {
  return this.cwlId; // Just show their CWL ID
});

// Instance Methods (functions you can call on a user)
userSchema.methods.updateLastActivity = function() {
  this.stats.lastActivity = new Date();
  return this.save();
};


userSchema.methods.incrementStats = function(field) {
  if (this.stats[field] !== undefined) {
    this.stats[field] += 1;
    return this.save();
  }
};

userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  this.stats.lastActivity = new Date();
  return this.save();
};

// Ensure virtual fields are serialized
userSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.password; // Never return password in JSON
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('User', userSchema);