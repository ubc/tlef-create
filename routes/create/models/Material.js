import mongoose from 'mongoose';
import { MATERIAL_TYPES, PROCESSING_STATUS } from '../config/constants.js';

const materialSchema = new mongoose.Schema({
  // Basic Material Information
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  
  type: {
    type: String,
    enum: Object.values(MATERIAL_TYPES),
    required: true,
    index: true
  },
  
  // File Information (for uploaded files)
  originalFileName: {
    type: String,
    trim: true
  },
  
  filePath: {
    type: String,
    trim: true
  }, // Local storage path: "/uploads/abc123.pdf"
  
  url: {
    type: String,
    trim: true
  }, // For URL materials
  
  // Raw content (for text materials or parsed content)
  content: {
    type: String
  },
  
  // File Metadata
  fileSize: { type: Number }, // in bytes
  mimeType: { type: String },
  checksum: { 
    type: String,
    index: true
  }, // For deduplication (same file uploaded twice)
  
  // Relationships
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    required: true,
    index: true
  },
  
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Processing Status
  processingStatus: {
    type: String,
    enum: Object.values(PROCESSING_STATUS),
    default: PROCESSING_STATUS.PENDING,
    index: true
  },
  
  processingError: {
    message: { type: String },
    timestamp: { type: Date }
  },
  
  // Qdrant Integration
  qdrantDocumentId: { 
    type: String,
    index: true
  }, // Reference to document in Qdrant vector database
  
  // Usage Tracking
  timesUsedInQuiz: { type: Number, default: 0 },
  lastUsed: { type: Date }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  collection: 'materials'
});

// Database Indexes for Performance
materialSchema.index({ folder: 1, processingStatus: 1 });
materialSchema.index({ uploadedBy: 1, createdAt: -1 });
materialSchema.index({ type: 1 });

// Virtual for file size in human readable format
materialSchema.virtual('fileSizeFormatted').get(function() {
  if (!this.fileSize) return null;
  const bytes = this.fileSize;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

// Virtual for processing status display
materialSchema.virtual('isProcessed').get(function() {
  return this.processingStatus === PROCESSING_STATUS.COMPLETED;
});

materialSchema.virtual('hasError').get(function() {
  return this.processingStatus === PROCESSING_STATUS.FAILED;
});

// Instance Methods
materialSchema.methods.updateProcessingStatus = function(status, error = null) {
  this.processingStatus = status;
  if (error) {
    this.processingError = {
      message: error.message || error,
      timestamp: new Date()
    };
  } else {
    this.processingError = undefined;
  }
  return this.save();
};

materialSchema.methods.setQdrantId = function(qdrantDocumentId) {
  this.qdrantDocumentId = qdrantDocumentId;
  this.processingStatus = PROCESSING_STATUS.COMPLETED;
  return this.save();
};

materialSchema.methods.updateUsage = function() {
  this.timesUsedInQuiz += 1;
  this.lastUsed = new Date();
  return this.save();
};

materialSchema.methods.markAsProcessing = function() {
  this.processingStatus = PROCESSING_STATUS.PROCESSING;
  this.processingError = undefined;
  return this.save();
};

materialSchema.methods.markAsCompleted = function() {
  this.processingStatus = PROCESSING_STATUS.COMPLETED;
  this.processingError = undefined;
  return this.save();
};

materialSchema.methods.markAsFailed = function(error) {
  this.processingStatus = PROCESSING_STATUS.FAILED;
  this.processingError = {
    message: error.message || error,
    timestamp: new Date()
  };
  return this.save();
};

// Ensure virtual fields are serialized
materialSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('Material', materialSchema);