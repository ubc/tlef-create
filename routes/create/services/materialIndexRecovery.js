import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import Material from '../models/Material.js';
import Folder from '../models/Folder.js';

const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const sourceSignature = material => createHash('sha256').update(JSON.stringify({
  id: String(material._id), owner: String(material.uploadedBy), folder: String(material.folder),
  content: material.content, updatedAt: material.updatedAt, checksum: material.checksum,
  status: material.processingStatus, metadata: material.processingMetadata
})).digest('hex');

// Infrastructure restoration preserves the approved source version. It is not
// a material edit, plan approval, question retry, or collection migration.
export function createMaterialIndexRecovery({ MaterialModel = Material, FolderModel = Folder,
  loadRag = async () => (await import('./ragService.js')).default } = {}) {
  return async function restoreMaterialIndex({ materialId, userId, assertActive = async () => {} }) {
    if (!mongoose.isValidObjectId(materialId) || !mongoose.isValidObjectId(userId)) fail('VALIDATION_ERROR', 'A valid material and author are required.', 400);
    const filter = { _id: materialId, uploadedBy: userId };
    const load = () => MaterialModel.findOne(filter).select('name type folder uploadedBy content checksum processingStatus processingMetadata updatedAt originalFileName').lean();
    const source = await load();
    if (!source || !await FolderModel.exists({ _id: source.folder, instructor: userId })) fail('NOT_FOUND', 'Material not found.', 404);
    if (source.processingStatus !== 'completed' || typeof source.content !== 'string' || !source.content.trim()) {
      fail('MATERIALS_NOT_READY', 'The material must have completed processing with saved parsed content before its index can be restored.');
    }
    const signature = sourceSignature(source);
    const guard = async () => {
      await assertActive();
      if (!await FolderModel.exists({ _id: source.folder, instructor: userId })) fail('NOT_FOUND', 'Material not found.', 404);
      const current = await load();
      if (!current || sourceSignature(current) !== signature) fail('MATERIAL_SOURCE_CHANGED', 'The material changed while its index was being restored. Review the current material before retrying.');
    };
    const rag = await loadRag();
    await guard();
    try { await rag.initialize(); }
    catch { fail('MATERIAL_RETRIEVAL_UNAVAILABLE', 'The material retrieval service could not initialize. Restore the configured services before retrying.'); }
    await guard();
    const result = await rag.processAndEmbedMaterial(source, { indexOnly: true, assertActive: guard });
    await guard();
    if (!result.success) fail('MATERIAL_INDEX_RESTORE_FAILED', 'The selected material index could not be fully restored. Check the embedding and retrieval services before retrying.');
    await rag.assertMaterialsIndexed([String(source._id)], { userId, assertActive: guard });
    return { materialId: String(source._id), chunksCount: result.chunksCount, restored: true,
      embeddingProvider: rag.embeddingConfig?.provider, embeddingModel: rag.embeddingConfig?.model,
      embeddingDimensions: rag.embeddingConfig?.dimensions };
  };
}

export default createMaterialIndexRecovery();
