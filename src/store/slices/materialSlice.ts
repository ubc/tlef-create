import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { materialsApi, Material } from '../../services/api';

// Async thunks for material operations
export const fetchMaterials = createAsyncThunk(
  'material/fetchMaterials',
  async (folderId: string) => {
    const response = await materialsApi.getMaterials(folderId);
    return response.materials;
  }
);

interface MaterialState {
  materials: Material[];
  loading: boolean;
  error: string | null;
}

const initialState: MaterialState = {
  materials: [],
  loading: false,
  error: null,
};

const materialSlice = createSlice({
  name: 'material',
  initialState,
  reducers: {
    clearMaterials: (state) => {
      state.materials = [];
      state.error = null;
    },
    addMaterialLocally: (state, action: PayloadAction<Material>) => {
      state.materials.push(action.payload);
    },
    removeMaterialLocally: (state, action: PayloadAction<string>) => {
      state.materials = state.materials.filter(m => m._id !== action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch materials
      .addCase(fetchMaterials.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMaterials.fulfilled, (state, action) => {
        state.loading = false;
        state.materials = action.payload;
        state.error = null;
      })
      .addCase(fetchMaterials.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch materials';
      });
  },
});

export const {
  clearMaterials,
  addMaterialLocally,
  removeMaterialLocally,
} = materialSlice.actions;

export default materialSlice.reducer;