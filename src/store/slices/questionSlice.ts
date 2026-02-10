import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { questionsApi, Question } from '../../services/api';

// Async thunks for question operations
export const fetchQuestions = createAsyncThunk(
  'question/fetchQuestions',
  async (quizId: string) => {
    const result = await questionsApi.getQuestions(quizId);
    if (!result || !result.questions || !Array.isArray(result.questions)) {
      return { quizId, questions: [] };
    }
    return { quizId, questions: result.questions };
  }
);

export const deleteQuestion = createAsyncThunk(
  'question/deleteQuestion',
  async ({ quizId, questionId }: { quizId: string; questionId: string }) => {
    await questionsApi.deleteQuestion(questionId);
    return { quizId, questionId };
  }
);

export const updateQuestion = createAsyncThunk(
  'question/updateQuestion',
  async ({ quizId, questionId, updates }: { quizId: string; questionId: string; updates: Partial<Question> }) => {
    const result = await questionsApi.updateQuestion(questionId, updates);
    return { quizId, question: result.question };
  }
);

export const deleteAllQuestions = createAsyncThunk(
  'question/deleteAllQuestions',
  async (quizId: string) => {
    await questionsApi.deleteAllQuestions(quizId);
    return quizId;
  }
);

interface QuestionState {
  // Per-quiz question data keyed by quizId
  questionsByQuiz: Record<string, Question[]>;
  loadingByQuiz: Record<string, boolean>;
  errorByQuiz: Record<string, string | null>;
  generatingByQuiz: Record<string, boolean>;
}

const initialState: QuestionState = {
  questionsByQuiz: {},
  loadingByQuiz: {},
  errorByQuiz: {},
  generatingByQuiz: {},
};

const questionSlice = createSlice({
  name: 'question',
  initialState,
  reducers: {
    clearQuestionsForQuiz: (state, action: PayloadAction<string>) => {
      delete state.questionsByQuiz[action.payload];
      delete state.loadingByQuiz[action.payload];
      delete state.errorByQuiz[action.payload];
      delete state.generatingByQuiz[action.payload];
    },
    setQuestionsForQuiz: (state, action: PayloadAction<{ quizId: string; questions: Question[] }>) => {
      state.questionsByQuiz[action.payload.quizId] = action.payload.questions;
    },
    addQuestionForQuiz: (state, action: PayloadAction<{ quizId: string; question: Question }>) => {
      const { quizId, question } = action.payload;
      if (!state.questionsByQuiz[quizId]) {
        state.questionsByQuiz[quizId] = [];
      }
      state.questionsByQuiz[quizId].push(question);
    },
    setQuestionsGenerating: (state, action: PayloadAction<{ quizId: string; generating: boolean }>) => {
      const { quizId, generating } = action.payload;
      state.generatingByQuiz[quizId] = generating;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchQuestions.pending, (state, action) => {
        const quizId = action.meta.arg;
        state.loadingByQuiz[quizId] = true;
        state.errorByQuiz[quizId] = null;
      })
      .addCase(fetchQuestions.fulfilled, (state, action) => {
        const { quizId, questions } = action.payload;
        state.loadingByQuiz[quizId] = false;
        state.questionsByQuiz[quizId] = questions;
        state.errorByQuiz[quizId] = null;
      })
      .addCase(fetchQuestions.rejected, (state, action) => {
        const quizId = action.meta.arg;
        state.loadingByQuiz[quizId] = false;
        state.errorByQuiz[quizId] = action.error.message || 'Failed to fetch questions';
      })
      .addCase(deleteQuestion.fulfilled, (state, action) => {
        const { quizId, questionId } = action.payload;
        if (state.questionsByQuiz[quizId]) {
          state.questionsByQuiz[quizId] = state.questionsByQuiz[quizId].filter(
            q => q._id !== questionId
          );
        }
      })
      .addCase(updateQuestion.fulfilled, (state, action) => {
        const { quizId, question } = action.payload;
        if (state.questionsByQuiz[quizId]) {
          const index = state.questionsByQuiz[quizId].findIndex(q => q._id === question._id);
          if (index !== -1) {
            state.questionsByQuiz[quizId][index] = question;
          }
        }
      })
      .addCase(deleteAllQuestions.fulfilled, (state, action) => {
        const quizId = action.payload;
        state.questionsByQuiz[quizId] = [];
      });
  },
});

export const {
  clearQuestionsForQuiz,
  setQuestionsForQuiz,
  addQuestionForQuiz,
  setQuestionsGenerating,
} = questionSlice.actions;

export default questionSlice.reducer;
