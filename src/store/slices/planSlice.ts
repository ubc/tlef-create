import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { plansApi, GenerationPlan } from '../../services/api';

// Async thunks for plan operations
export const generatePlan = createAsyncThunk(
  'plan/generatePlan',
  async (data: { quizId: string; approach: 'support' | 'assess' | 'gamify' | 'custom'; questionsPerLO: number; customFormula?: any }) => {
    const response = await plansApi.generatePlan(data.quizId, data.approach, data.questionsPerLO, data.customFormula);
    return response.plan;
  }
);

export const fetchPlans = createAsyncThunk(
  'plan/fetchPlans',
  async (quizId: string) => {
    const response = await plansApi.getPlans(quizId);
    return response.plans;
  }
);

export const fetchPlan = createAsyncThunk(
  'plan/fetchPlan',
  async (planId: string) => {
    const response = await plansApi.getPlan(planId);
    return response.plan;
  }
);

export const updatePlan = createAsyncThunk(
  'plan/updatePlan',
  async (data: { id: string; breakdown: GenerationPlan['breakdown'] }) => {
    const response = await plansApi.updatePlan(data.id, data.breakdown);
    return response.plan;
  }
);

export const approvePlan = createAsyncThunk(
  'plan/approvePlan',
  async (planId: string) => {
    const response = await plansApi.approvePlan(planId);
    return response.plan;
  }
);

export const deletePlan = createAsyncThunk(
  'plan/deletePlan',
  async (planId: string) => {
    await plansApi.deletePlan(planId);
    return planId;
  }
);

interface PlanState {
  plans: GenerationPlan[];
  currentPlan: GenerationPlan | null;
  activePlan: GenerationPlan | null;
  loading: boolean;
  generating: boolean;
  error: string | null;
}

const initialState: PlanState = {
  plans: [],
  currentPlan: null,
  activePlan: null,
  loading: false,
  generating: false,
  error: null,
};

const planSlice = createSlice({
  name: 'plan',
  initialState,
  reducers: {
    clearPlans: (state) => {
      state.plans = [];
      state.currentPlan = null;
      state.activePlan = null;
    },
    setCurrentPlan: (state, action: PayloadAction<GenerationPlan | null>) => {
      state.currentPlan = action.payload;
    },
    setActivePlan: (state, action: PayloadAction<GenerationPlan | null>) => {
      state.activePlan = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // Generate plan
      .addCase(generatePlan.pending, (state) => {
        state.generating = true;
        state.error = null;
      })
      .addCase(generatePlan.fulfilled, (state, action) => {
        state.generating = false;
        state.currentPlan = action.payload;
        // Add to plans array if not already present
        const existingIndex = state.plans.findIndex(p => p._id === action.payload._id);
        if (existingIndex !== -1) {
          state.plans[existingIndex] = action.payload;
        } else {
          state.plans.push(action.payload);
        }
        state.error = null;
      })
      .addCase(generatePlan.rejected, (state, action) => {
        state.generating = false;
        state.error = action.error.message || 'Failed to generate plan';
      })
      
      // Fetch plans
      .addCase(fetchPlans.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchPlans.fulfilled, (state, action) => {
        state.loading = false;
        state.plans = action.payload;
        // Set active plan if there's an approved one
        const approved = action.payload.find(p => p.status === 'approved');
        if (approved) {
          state.activePlan = approved;
        }
        state.error = null;
      })
      .addCase(fetchPlans.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch plans';
      })
      
      // Fetch single plan
      .addCase(fetchPlan.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchPlan.fulfilled, (state, action) => {
        state.loading = false;
        state.currentPlan = action.payload;
        // Update in plans array if exists
        const existingIndex = state.plans.findIndex(p => p._id === action.payload._id);
        if (existingIndex !== -1) {
          state.plans[existingIndex] = action.payload;
        }
        state.error = null;
      })
      .addCase(fetchPlan.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch plan';
      })
      
      // Update plan
      .addCase(updatePlan.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updatePlan.fulfilled, (state, action) => {
        state.loading = false;
        state.currentPlan = action.payload;
        // Update in plans array
        const existingIndex = state.plans.findIndex(p => p._id === action.payload._id);
        if (existingIndex !== -1) {
          state.plans[existingIndex] = action.payload;
        }
        state.error = null;
      })
      .addCase(updatePlan.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to update plan';
      })
      
      // Approve plan
      .addCase(approvePlan.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(approvePlan.fulfilled, (state, action) => {
        state.loading = false;
        state.activePlan = action.payload;
        state.currentPlan = action.payload;
        
        // Reset all other plans to draft status and set this one as approved
        state.plans = state.plans.map(plan => ({
          ...plan,
          status: plan._id === action.payload._id ? 'approved' : 'draft'
        }));
        
        // Update the specific plan
        const existingIndex = state.plans.findIndex(p => p._id === action.payload._id);
        if (existingIndex !== -1) {
          state.plans[existingIndex] = action.payload;
        }
        state.error = null;
      })
      .addCase(approvePlan.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to approve plan';
      })
      
      // Delete plan
      .addCase(deletePlan.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deletePlan.fulfilled, (state, action) => {
        state.loading = false;
        state.plans = state.plans.filter(p => p._id !== action.payload);
        // Clear current plan if it was deleted
        if (state.currentPlan?._id === action.payload) {
          state.currentPlan = null;
        }
        // Clear active plan if it was deleted
        if (state.activePlan?._id === action.payload) {
          state.activePlan = null;
        }
        state.error = null;
      })
      .addCase(deletePlan.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to delete plan';
      });
  },
});

export const { clearPlans, setCurrentPlan, setActivePlan, setError } = planSlice.actions;
export default planSlice.reducer;