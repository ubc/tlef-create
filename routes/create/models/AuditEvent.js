import mongoose from 'mongoose';

const auditEventSchema = new mongoose.Schema({
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: { type: String, required: true, trim: true, maxlength: 160, index: true },
  resourceType: { type: String, maxlength: 80, index: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId },
  folder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', index: true },
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', index: true },
  status: {
    type: String,
    enum: ['success', 'failed'],
    required: true,
    index: true
  },
  requestId: { type: String, maxlength: 120 },
  route: { type: String, maxlength: 500 },
  method: { type: String, maxlength: 12 },
  statusCode: { type: Number },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, {
  timestamps: true,
  collection: 'auditEvents'
});

auditEventSchema.index({ createdAt: -1 });
auditEventSchema.index({ actor: 1, createdAt: -1 });
auditEventSchema.index({ action: 1, createdAt: -1 });
auditEventSchema.index({ folder: 1, createdAt: -1 });

export default mongoose.model('AuditEvent', auditEventSchema);

