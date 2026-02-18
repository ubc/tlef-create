import { createSlice, PayloadAction } from '@reduxjs/toolkit';

// Upload material type
export interface UploadMaterial {
  id: string; // Unique ID for tracking
  name: string;
  type: 'pdf' | 'docx' | 'url' | 'text';
  file?: File;
  content?: string; // For URL or text materials
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  error?: string;
}

// Upload queue by course ID
interface UploadState {
  uploadQueues: {
    [courseId: string]: UploadMaterial[];
  };
}

const initialState: UploadState = {
  uploadQueues: {},
};

const uploadSlice = createSlice({
  name: 'upload',
  initialState,
  reducers: {
    // Add materials to upload queue for a course
    addMaterialsToQueue: (
      state,
      action: PayloadAction<{ courseId: string; materials: Omit<UploadMaterial, 'status' | 'progress'>[] }>
    ) => {
      const { courseId, materials } = action.payload;

      // Initialize queue if doesn't exist
      if (!state.uploadQueues[courseId]) {
        state.uploadQueues[courseId] = [];
      }

      // Add materials with initial status
      const newMaterials = materials.map(m => ({
        ...m,
        status: 'pending' as const,
        progress: 0,
      }));

      state.uploadQueues[courseId].push(...newMaterials);
    },

    // Update material upload status and progress
    updateMaterialStatus: (
      state,
      action: PayloadAction<{
        courseId: string;
        materialId: string;
        status: UploadMaterial['status'];
        progress?: number;
        error?: string;
      }>
    ) => {
      const { courseId, materialId, status, progress, error } = action.payload;
      const queue = state.uploadQueues[courseId];

      if (queue) {
        const material = queue.find(m => m.id === materialId);
        if (material) {
          material.status = status;
          if (progress !== undefined) {
            material.progress = progress;
          }
          if (error !== undefined) {
            material.error = error;
          }
        }
      }
    },

    // Remove material from queue (after completion or cancellation)
    removeMaterialFromQueue: (
      state,
      action: PayloadAction<{ courseId: string; materialId: string }>
    ) => {
      const { courseId, materialId } = action.payload;
      const queue = state.uploadQueues[courseId];

      if (queue) {
        state.uploadQueues[courseId] = queue.filter(m => m.id !== materialId);

        // Clean up empty queues
        if (state.uploadQueues[courseId].length === 0) {
          delete state.uploadQueues[courseId];
        }
      }
    },

    // Clear all completed uploads for a course
    clearCompletedUploads: (state, action: PayloadAction<string>) => {
      const courseId = action.payload;
      const queue = state.uploadQueues[courseId];

      if (queue) {
        state.uploadQueues[courseId] = queue.filter(m => m.status !== 'completed');

        // Clean up empty queues
        if (state.uploadQueues[courseId].length === 0) {
          delete state.uploadQueues[courseId];
        }
      }
    },

    // Clear entire upload queue for a course
    clearUploadQueue: (state, action: PayloadAction<string>) => {
      const courseId = action.payload;
      delete state.uploadQueues[courseId];
    },

    // Reset material to retry upload
    retryMaterialUpload: (
      state,
      action: PayloadAction<{ courseId: string; materialId: string }>
    ) => {
      const { courseId, materialId } = action.payload;
      const queue = state.uploadQueues[courseId];

      if (queue) {
        const material = queue.find(m => m.id === materialId);
        if (material && material.status === 'failed') {
          material.status = 'pending';
          material.progress = 0;
          material.error = undefined;
        }
      }
    },
  },
});

export const {
  addMaterialsToQueue,
  updateMaterialStatus,
  removeMaterialFromQueue,
  clearCompletedUploads,
  clearUploadQueue,
  retryMaterialUpload,
} = uploadSlice.actions;

// Selectors
export const selectUploadQueueByCourse = (state: { upload: UploadState }, courseId: string) =>
  state.upload.uploadQueues[courseId] || [];

export const selectActiveUploadsByCourse = (state: { upload: UploadState }, courseId: string) => {
  const queue = state.upload.uploadQueues[courseId] || [];
  return queue.filter(m => m.status !== 'completed');
};

export const selectHasActiveUploads = (state: { upload: UploadState }, courseId: string) => {
  const activeUploads = selectActiveUploadsByCourse(state, courseId);
  return activeUploads.length > 0;
};

export default uploadSlice.reducer;
