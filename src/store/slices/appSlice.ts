import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserInfo {
  id: string;
  cwlId: string;
  isAdmin: boolean;
  stats: {
    coursesCreated: number;
    quizzesGenerated: number;
    questionsCreated: number;
    totalUsageTime: number;
  };
}

interface AppState {
  activeCourse: string | null;
  activeQuiz: string | null;
  user: UserInfo | null;
}

const initialState: AppState = {
  activeCourse: null,
  activeQuiz: null,
  user: null,
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
    setUser: (state, action: PayloadAction<UserInfo | null>) => {
      state.user = action.payload;
    },
  },
});

export const { setActiveCourse, setActiveQuiz, setUser } = appSlice.actions;
export default appSlice.reducer;
