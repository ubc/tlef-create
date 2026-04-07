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
  
  // Display name (extracted from email, e.g., "haocheng.fan")
  displayName: { type: String, default: null },

  // Email from SAML profile
  email: { type: String, default: null },

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

}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  collection: 'users'
});

// Database Indexes for Performance
userSchema.index({ lastLogin: -1 });
userSchema.index({ 'stats.lastActivity': -1 });

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