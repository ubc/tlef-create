import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { quizApi, Quiz } from '../../services/api';

// Async thunks for quiz operations
export const fetchQuizzes = createAsyncThunk(
  'quiz/fetchQuizzes',
  async (folderId: string) => {
    const response = await quizApi.getQuizzes(folderId);
    return response.quizzes;
  }
);

export const createQuiz = createAsyncThunk(
  'quiz/createQuiz',
  async ({ name, folderId }: { name: string; folderId: string }) => {
    const response = await quizApi.createQuiz(name, folderId);
    return response.quiz;
  }
);

export const updateQuiz = createAsyncThunk(
  'quiz/updateQuiz',
  async ({ id, updates }: { id: string; updates: { name?: string; settings?: Partial<Quiz['settings']> } }) => {
    const response = await quizApi.updateQuiz(id, updates);
    return response.quiz;
  }
);

export const deleteQuiz = createAsyncThunk(
  'quiz/deleteQuiz',
  async (id: string) => {
    await quizApi.deleteQuiz(id);
    return id;
  }
);

export const assignMaterials = createAsyncThunk(
  'quiz/assignMaterials',
  async ({ id, materialIds }: { id: string; materialIds: string[] }) => {
    const response = await quizApi.assignMaterials(id, materialIds);
    return response.quiz;
  }
);

export const duplicateQuiz = createAsyncThunk(
  'quiz/duplicateQuiz',
  async ({ id, name }: { id: string; name?: string }) => {
    const response = await quizApi.duplicateQuiz(id, name);
    return response.quiz;
  }
);

export const fetchQuizById = createAsyncThunk(
  'quiz/fetchQuizById',
  async (id: string) => {
    const response = await quizApi.getQuiz(id);
    return response.quiz;
  }
);

interface QuizState {
  quizzes: Quiz[];
  currentQuiz: Quiz | null;
  loading: boolean;
  error: string | null;
  selectedFolderId: string | null;
}

const initialState: QuizState = {
  quizzes: [],
  currentQuiz: null,
  loading: false,
  error: null,
  selectedFolderId: null,
};

const quizSlice = createSlice({
  name: 'quiz',
  initialState,
  reducers: {
    clearQuizzes: (state) => {
      state.quizzes = [];
      state.currentQuiz = null;
      state.selectedFolderId = null;
    },
    setCurrentQuiz: (state, action: PayloadAction<Quiz | null>) => {
      state.currentQuiz = action.payload;
    },
    setSelectedFolder: (state, action: PayloadAction<string | null>) => {
      state.selectedFolderId = action.payload;
      if (!action.payload) {
        state.quizzes = [];
        state.currentQuiz = null;
      }
    },
    clearError: (state) => {
      state.error = null;
    },
    // Local state updates for real-time UI updates
    addQuizLocally: (state, action: PayloadAction<Quiz>) => {
      state.quizzes.unshift(action.payload);
    },
    updateQuizLocally: (state, action: PayloadAction<Quiz>) => {
      const index = state.quizzes.findIndex(quiz => quiz._id === action.payload._id);
      if (index !== -1) {
        state.quizzes[index] = action.payload;
      }
      if (state.currentQuiz && state.currentQuiz._id === action.payload._id) {
        state.currentQuiz = action.payload;
      }
    },
    removeQuizLocally: (state, action: PayloadAction<string>) => {
      state.quizzes = state.quizzes.filter(quiz => quiz._id !== action.payload);
      if (state.currentQuiz && state.currentQuiz._id === action.payload) {
        state.currentQuiz = null;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch quizzes
      .addCase(fetchQuizzes.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchQuizzes.fulfilled, (state, action) => {
        state.loading = false;
        state.quizzes = action.payload;
        state.error = null;
      })
      .addCase(fetchQuizzes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch quizzes';
      })
      
      // Create quiz
      .addCase(createQuiz.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createQuiz.fulfilled, (state, action) => {
        state.loading = false;
        state.quizzes.unshift(action.payload);
        state.error = null;
      })
      .addCase(createQuiz.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to create quiz';
      })
      
      // Update quiz
      .addCase(updateQuiz.fulfilled, (state, action) => {
        const index = state.quizzes.findIndex(quiz => quiz._id === action.payload._id);
        if (index !== -1) {
          state.quizzes[index] = action.payload;
        }
        if (state.currentQuiz && state.currentQuiz._id === action.payload._id) {
          state.currentQuiz = action.payload;
        }
      })
      .addCase(updateQuiz.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to update quiz';
      })
      
      // Delete quiz
      .addCase(deleteQuiz.fulfilled, (state, action) => {
        state.quizzes = state.quizzes.filter(quiz => quiz._id !== action.payload);
        if (state.currentQuiz && state.currentQuiz._id === action.payload) {
          state.currentQuiz = null;
        }
      })
      .addCase(deleteQuiz.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to delete quiz';
      })
      
      // Assign materials
      .addCase(assignMaterials.fulfilled, (state, action) => {
        const index = state.quizzes.findIndex(quiz => quiz._id === action.payload._id);
        if (index !== -1) {
          state.quizzes[index] = action.payload;
        }
        if (state.currentQuiz && state.currentQuiz._id === action.payload._id) {
          state.currentQuiz = action.payload;
        }
      })
      .addCase(assignMaterials.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to assign materials';
      })
      
      // Duplicate quiz
      .addCase(duplicateQuiz.fulfilled, (state, action) => {
        state.quizzes.unshift(action.payload);
      })
      .addCase(duplicateQuiz.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to duplicate quiz';
      })
      
      // Fetch quiz by ID
      .addCase(fetchQuizById.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchQuizById.fulfilled, (state, action) => {
        state.loading = false;
        state.currentQuiz = action.payload;
        state.error = null;
      })
      .addCase(fetchQuizById.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch quiz';
      });
  },
});

export const {
  clearQuizzes,
  setCurrentQuiz,
  setSelectedFolder,
  clearError,
  addQuizLocally,
  updateQuizLocally,
  removeQuizLocally,
} = quizSlice.actions;

export default quizSlice.reducer;