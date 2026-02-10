import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AppState {
  activeCourse: string | null;
  activeQuiz: string | null;
}

const initialState: AppState = {
  activeCourse: null,
  activeQuiz: null,
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setActiveCourse: (state, action: PayloadAction<string>) => {
      state.activeCourse = action.payload;
    },
    setActiveQuiz: (state, action: PayloadAction<string>) => {
      state.activeQuiz = action.payload;
    },
  },
});

export const { setActiveCourse, setActiveQuiz } = appSlice.actions;
export default appSlice.reducer;
