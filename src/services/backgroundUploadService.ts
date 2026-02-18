import { store } from '../store';
import {
  updateMaterialStatus,
  retryMaterialUpload,
  UploadMaterial
} from '../store/slices/uploadSlice';
import { materialsApi } from './api';
import { fetchMaterials } from '../store/slices/materialSlice';

/**
 * Background Upload Service
 * Handles asynchronous material uploads and updates upload queue status
 */
class BackgroundUploadService {
  private activeUploads: Map<string, AbortController> = new Map();

  /**
   * Start uploading materials in the background
   */
  async startUpload(courseId: string, materials: UploadMaterial[]) {
    console.log(`📤 Starting background upload for ${materials.length} materials in course ${courseId}`);

    for (const material of materials) {
      // Process materials sequentially to avoid overwhelming the server
      await this.uploadSingleMaterial(courseId, material);
    }

    console.log(`✅ All materials uploaded for course ${courseId}`);

    // Refresh materials list after all uploads complete
    store.dispatch(fetchMaterials(courseId) as any);
  }

  /**
   * Upload a single material
   */
  private async uploadSingleMaterial(courseId: string, material: UploadMaterial) {
    const { id: materialId, type, file, content, name } = material;

    try {
      // Update status to uploading
      store.dispatch(updateMaterialStatus({
        courseId,
        materialId,
        status: 'uploading',
        progress: 0
      }));

      let response;

      // Handle different material types
      if (type === 'pdf' || type === 'docx') {
        if (!file) {
          throw new Error('File is required for PDF/DOCX upload');
        }

        // Create FileList from File
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Upload with progress callback
        response = await materialsApi.uploadFiles(
          courseId,
          dataTransfer.files,
          (progress) => {
            // Update progress in real-time
            store.dispatch(updateMaterialStatus({
              courseId,
              materialId,
              status: 'uploading',
              progress
            }));
          }
        );

        // File uploaded, now processing chunks
        store.dispatch(updateMaterialStatus({
          courseId,
          materialId,
          status: 'processing',
          progress: 100
        }));

        // Wait for processing to complete (polling)
        await this.waitForProcessing(courseId, response.materials[0]._id);

      } else if (type === 'url') {
        if (!content) {
          throw new Error('URL is required for URL material');
        }

        response = await materialsApi.addUrl(courseId, content, name);

        // URLs don't need chunking, mark as processing
        store.dispatch(updateMaterialStatus({
          courseId,
          materialId,
          status: 'processing',
          progress: 100
        }));

        // Wait for processing
        await this.waitForProcessing(courseId, response.material._id);

      } else if (type === 'text') {
        if (!content) {
          throw new Error('Content is required for text material');
        }

        response = await materialsApi.addText(courseId, content, name);

        // Text materials don't need chunking
        store.dispatch(updateMaterialStatus({
          courseId,
          materialId,
          status: 'processing',
          progress: 100
        }));

        await this.waitForProcessing(courseId, response.material._id);
      }

      // Mark as completed
      store.dispatch(updateMaterialStatus({
        courseId,
        materialId,
        status: 'completed',
        progress: 100
      }));

      console.log(`✅ Material uploaded successfully: ${name}`);

    } catch (error) {
      console.error(`❌ Failed to upload material: ${name}`, error);

      // Mark as failed
      store.dispatch(updateMaterialStatus({
        courseId,
        materialId,
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : 'Upload failed'
      }));
    }
  }

  /**
   * Wait for material processing to complete (polling)
   */
  private async waitForProcessing(courseId: string, materialId: string): Promise<void> {
    const MAX_ATTEMPTS = 60; // 2 minutes (2s * 60)
    const POLL_INTERVAL = 2000; // 2 seconds

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Wait before polling
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

      try {
        const response = await materialsApi.getMaterials(courseId);
        const material = response.materials.find(m => m._id === materialId);

        if (!material) {
          console.warn(`Material ${materialId} not found in polling`);
          continue;
        }

        if (material.processingStatus === 'completed') {
          console.log(`✅ Processing complete for material: ${material.name}`);
          return;
        }

        if (material.processingStatus === 'failed') {
          throw new Error('Material processing failed');
        }

        // Still processing, continue polling
        console.log(`⏳ Processing material: ${material.name} (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);

      } catch (error) {
        console.error('Error polling material status:', error);
        throw error;
      }
    }

    throw new Error('Processing timeout - material took too long to process');
  }

  /**
   * Retry a failed upload
   */
  async retryUpload(courseId: string, materialId: string, material: UploadMaterial) {
    console.log(`🔄 Retrying upload for material: ${material.name}`);

    // Reset material status
    store.dispatch(retryMaterialUpload({ courseId, materialId }));

    // Retry upload
    await this.uploadSingleMaterial(courseId, material);
  }

  /**
   * Cancel an ongoing upload
   */
  cancelUpload(materialId: string) {
    const controller = this.activeUploads.get(materialId);
    if (controller) {
      controller.abort();
      this.activeUploads.delete(materialId);
      console.log(`🚫 Upload cancelled for material: ${materialId}`);
    }
  }

  /**
   * Cancel all ongoing uploads
   */
  cancelAllUploads() {
    this.activeUploads.forEach((controller, materialId) => {
      controller.abort();
      console.log(`🚫 Upload cancelled for material: ${materialId}`);
    });
    this.activeUploads.clear();
  }
}

// Export singleton instance
export const backgroundUploadService = new BackgroundUploadService();
