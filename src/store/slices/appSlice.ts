import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Course {
  id: string;
  name: string;
  quizzes: Quiz[];
}

interface Quiz {
  id: string;
  name: string;
  questionCount: number;
}

interface AppState {
  currentUser: string | null;
  courses: Course[];
  activeCourse: string | null;
  activeQuiz: string | null;
}

const initialState: AppState = {
  currentUser: null,
  courses: [],
  activeCourse: null,
  activeQuiz: null,
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setCurrentUser: (state, action: PayloadAction<string>) => {
      state.currentUser = action.payload;
    },
    addCourse: (state, action: PayloadAction<{ name: string; quizCount: number }>) => {
      const courseId = Date.now().toString();
      const quizzes = Array.from({ length: action.payload.quizCount }, (_, index) => ({
        id: `${courseId}-quiz-${index + 1}`,
        name: `Quiz ${index + 1}`,
        questionCount: 0,
      }));
      
      const newCourse: Course = {
        id: courseId,
        name: action.payload.name,
        quizzes,
      };
      
      state.courses.push(newCourse);
    },
    setActiveCourse: (state, action: PayloadAction<string>) => {
      state.activeCourse = action.payload;
    },
    setActiveQuiz: (state, action: PayloadAction<string>) => {
      state.activeQuiz = action.payload;
    },
  },
});

export const { setCurrentUser, addCourse, setActiveCourse, setActiveQuiz } = appSlice.actions;
export default appSlice.reducer;