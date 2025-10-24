import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { objectivesApi, LearningObjective } from '../../services/api';

// Async thunks for learning objective operations
export const fetchObjectives = createAsyncThunk(
  'learningObjective/fetchObjectives',
  async (quizId: string) => {
    const response = await objectivesApi.getObjectives(quizId);
    return response.objectives;
  }
);

export const generateObjectives = createAsyncThunk(
  'learningObjective/generateObjectives',
  async (data: { quizId: string; materialIds: string[]; targetCount?: number }) => {
    const response = await objectivesApi.generateObjectives(data.quizId, data.materialIds, data.targetCount);
    return response.objectives;
  }
);

export const classifyObjectives = createAsyncThunk(
  'learningObjective/classifyObjectives',
  async (data: { quizId: string; text: string }) => {
    const response = await objectivesApi.classifyObjectives(data.quizId, data.text);
    return response.objectives;
  }
);

export const saveObjectives = createAsyncThunk(
  'learningObjective/saveObjectives',
  async (data: { quizId: string; objectives: { text: string; order: number }[] }) => {
    const response = await objectivesApi.saveObjectives(data.quizId, data.objectives);
    return response.objectives;
  }
);

export const updateObjective = createAsyncThunk(
  'learningObjective/updateObjective',
  async (data: { id: string; text: string }) => {
    const response = await objectivesApi.updateObjective(data.id, { text: data.text });
    return response.objective;
  }
);

export const deleteObjective = createAsyncThunk(
  'learningObjective/deleteObjective',
  async (id: string) => {
    await objectivesApi.deleteObjective(id);
    return id;
  }
);

export const regenerateSingleObjective = createAsyncThunk(
  'learningObjective/regenerateSingleObjective',
  async (data: { id: string; customPrompt?: string }) => {
    const response = await objectivesApi.regenerateSingleObjective(data.id, data.customPrompt);
    return response.objective;
  }
);

export const deleteAllObjectives = createAsyncThunk(
  'learningObjective/deleteAllObjectives',
  async (quizId: string) => {
    console.log('🔴 Redux deleteAllObjectives action - quizId:', quizId);
    try {
      const response = await objectivesApi.deleteAllObjectives(quizId);
      console.log('🔴 Redux deleteAllObjectives response:', response);
      return response;
    } catch (error) {
      console.error('🔴 Redux deleteAllObjectives error:', error);
      throw error;
    }
  }
);

interface LearningObjectiveState {
  objectives: LearningObjective[];
  loading: boolean;
  error: string | null;
  generating: boolean;
  classifying: boolean;
}

const initialState: LearningObjectiveState = {
  objectives: [],
  loading: false,
  error: null,
  generating: false,
  classifying: false,
};

const learningObjectiveSlice = createSlice({
  name: 'learningObjective',
  initialState,
  reducers: {
    clearObjectives: (state) => {
      state.objectives = [];
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch objectives
      .addCase(fetchObjectives.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchObjectives.fulfilled, (state, action) => {
        state.loading = false;
        state.objectives = action.payload;
        state.error = null;
      })
      .addCase(fetchObjectives.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch objectives';
      })
      
      // Generate objectives
      .addCase(generateObjectives.pending, (state) => {
        state.generating = true;
        state.error = null;
      })
      .addCase(generateObjectives.fulfilled, (state, action) => {
        state.generating = false;
        state.objectives = action.payload;
        state.error = null;
      })
      .addCase(generateObjectives.rejected, (state, action) => {
        state.generating = false;
        state.error = action.error.message || 'Failed to generate objectives';
      })
      
      // Classify objectives
      .addCase(classifyObjectives.pending, (state) => {
        state.classifying = true;
        state.error = null;
      })
      .addCase(classifyObjectives.fulfilled, (state, action) => {
        state.classifying = false;
        state.objectives = action.payload;
        state.error = null;
      })
      .addCase(classifyObjectives.rejected, (state, action) => {
        state.classifying = false;
        state.error = action.error.message || 'Failed to classify objectives';
      })
      
      // Save objectives
      .addCase(saveObjectives.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveObjectives.fulfilled, (state, action) => {
        state.loading = false;
        state.objectives = action.payload;
        state.error = null;
      })
      .addCase(saveObjectives.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to save objectives';
      })
      
      // Update objective
      .addCase(updateObjective.fulfilled, (state, action) => {
        const index = state.objectives.findIndex(obj => obj._id === action.payload._id);
        if (index !== -1) {
          state.objectives[index] = action.payload;
        }
      })
      .addCase(updateObjective.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to update objective';
      })
      
      // Delete objective
      .addCase(deleteObjective.fulfilled, (state, action) => {
        state.objectives = state.objectives.filter(obj => obj._id !== action.payload);
      })
      .addCase(deleteObjective.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to delete objective';
      })
      
      // Regenerate single objective
      .addCase(regenerateSingleObjective.pending, (state) => {
        state.generating = true;
        state.error = null;
      })
      .addCase(regenerateSingleObjective.fulfilled, (state, action) => {
        state.generating = false;
        const index = state.objectives.findIndex(obj => obj._id === action.payload._id);
        if (index !== -1) {
          state.objectives[index] = action.payload;
        }
        state.error = null;
      })
      .addCase(regenerateSingleObjective.rejected, (state, action) => {
        state.generating = false;
        state.error = action.error.message || 'Failed to regenerate objective';
      })
      
      // Delete all objectives
      .addCase(deleteAllObjectives.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteAllObjectives.fulfilled, (state) => {
        state.loading = false;
        state.objectives = [];
        state.error = null;
      })
      .addCase(deleteAllObjectives.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to delete all objectives';
      });
  },
});

export const { clearObjectives, setError } = learningObjectiveSlice.actions;
export default learningObjectiveSlice.reducer;