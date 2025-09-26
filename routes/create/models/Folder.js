import mongoose from 'mongoose';

const folderSchema = new mongoose.Schema({
  // Basic Folder Information
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  }, // e.g., "EOSC 533"
  
  // Link to the instructor who created this folder
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Folder Materials (uploaded files, URLs, text)
  materials: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material'
  }],
  
  // Quizzes in this folder
  quizzes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz'
  }],
  
  // Folder Statistics (for dashboard)
  stats: {
    totalQuizzes: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    totalMaterials: { type: Number, default: 0 },
    lastActivity: { type: Date, default: Date.now }
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  collection: 'folders'
});

// Database Indexes for Performance
folderSchema.index({ instructor: 1, createdAt: -1 });
folderSchema.index({ 'stats.lastActivity': -1 });

// Virtual Properties (computed fields)
folderSchema.virtual('quizCount').get(function() {
  return this.quizzes ? this.quizzes.length : 0;
});

folderSchema.virtual('materialCount').get(function() {
  return this.materials ? this.materials.length : 0;
});

// Instance Methods
folderSchema.methods.updateStats = async function() {
  const Question = mongoose.model('Question');
  
  this.stats.lastActivity = new Date();
  this.stats.totalQuizzes = this.quizzes.length;
  this.stats.totalMaterials = this.materials.length;
  
  // Calculate total questions across all quizzes in this folder
  this.stats.totalQuestions = await Question.countDocuments({
    quiz: { $in: this.quizzes }
  });
  
  console.log(`📊 Updated folder stats: quizzes=${this.stats.totalQuizzes}, questions=${this.stats.totalQuestions}, materials=${this.stats.totalMaterials}`);
  
  return this.save();
};

folderSchema.methods.addQuiz = async function(quizId) {
  if (!this.quizzes.includes(quizId)) {
    this.quizzes.push(quizId);
    return await this.updateStats();
  }
  return this;
};

folderSchema.methods.removeQuiz = async function(quizId) {
  this.quizzes = this.quizzes.filter(id => !id.equals(quizId));
  return await this.updateStats();
};

folderSchema.methods.addMaterial = async function(materialId) {
  if (!this.materials.includes(materialId)) {
    this.materials.push(materialId);
    return await this.updateStats();
  }
  return this;
};

folderSchema.methods.removeMaterial = async function(materialId) {
  this.materials = this.materials.filter(id => !id.equals(materialId));
  return await this.updateStats();
};

// Ensure virtual fields are serialized
folderSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('Folder', folderSchema);