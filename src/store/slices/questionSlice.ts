import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { questionsApi, Question } from '../../services/api';
import { setUser } from './appSlice';

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

export interface ReviewQuestionDraft {
  original: Question;
  question: Question;
}

interface QuestionState {
  // Per-quiz question data keyed by quizId
  questionsByQuiz: Record<string, Question[]>;
  loadingByQuiz: Record<string, boolean>;
  errorByQuiz: Record<string, string | null>;
  generatingByQuiz: Record<string, boolean>;
  // Local edits are separate from the authoritative published list. Publication
  // may retire a question ID, but must never silently discard its open editor.
  reviewDraftsByQuiz: Record<string, Record<string, ReviewQuestionDraft>>;
  reviewDraftOwnerId: string | null;
}

const initialState: QuestionState = {
  questionsByQuiz: {},
  loadingByQuiz: {},
  errorByQuiz: {},
  generatingByQuiz: {},
  reviewDraftsByQuiz: {},
  reviewDraftOwnerId: null,
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
      delete state.reviewDraftsByQuiz[action.payload];
    },
    setQuestionsForQuiz: (state, action: PayloadAction<{ quizId: string; questions: Question[] }>) => {
      state.questionsByQuiz[action.payload.quizId] = action.payload.questions;
    },
    addQuestionForQuiz: (state, action: PayloadAction<{ quizId: string; question: Question }>) => {
      const { quizId, question } = action.payload;
      if (!state.questionsByQuiz[quizId]) {
        state.questionsByQuiz[quizId] = [];
      }
      const index = state.questionsByQuiz[quizId].findIndex(item => item._id === question._id);
      if (index === -1) state.questionsByQuiz[quizId].push(question);
      else state.questionsByQuiz[quizId][index] = question;
    },
    setQuestionsGenerating: (state, action: PayloadAction<{ quizId: string; generating: boolean }>) => {
      const { quizId, generating } = action.payload;
      state.generatingByQuiz[quizId] = generating;
    },
    startReviewDraft: (state, action: PayloadAction<{ quizId: string; questionId: string }>) => {
      const { quizId, questionId } = action.payload;
      const question = state.questionsByQuiz[quizId]?.find(item => item._id === questionId);
      if (!question || state.reviewDraftsByQuiz[quizId]?.[questionId]) return;
      state.reviewDraftsByQuiz[quizId] ??= {};
      state.reviewDraftsByQuiz[quizId][questionId] = { original: question, question };
    },
    updateReviewDrafts: (state, action: PayloadAction<{ quizId: string; questions: Question[] }>) => {
      const drafts = state.reviewDraftsByQuiz[action.payload.quizId];
      for (const question of action.payload.questions) {
        if (drafts?.[question._id]) drafts[question._id].question = question;
      }
    },
    discardReviewDraft: (state, action: PayloadAction<{ quizId: string; questionId: string; expected?: Question }>) => {
      const { quizId, questionId, expected } = action.payload;
      const draft = state.reviewDraftsByQuiz[quizId]?.[questionId];
      // A late save must not clear edits typed after that request began.
      if (draft && (!expected || JSON.stringify(draft.question) === JSON.stringify(expected))) {
        delete state.reviewDraftsByQuiz[quizId][questionId];
      }
    },
    updateSavedQuestionForQuiz: (state, action: PayloadAction<{ quizId: string; question: Question }>) => {
      const { quizId, question } = action.payload;
      const index = state.questionsByQuiz[quizId]?.findIndex(item => item._id === question._id) ?? -1;
      if (index !== -1) state.questionsByQuiz[quizId][index] = question;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(setUser, (state, action) => {
        const ownerId = action.payload?.id || null;
        if (!ownerId || ownerId !== state.reviewDraftOwnerId) state.reviewDraftsByQuiz = {};
        state.reviewDraftOwnerId = ownerId;
      })
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
  startReviewDraft,
  updateReviewDrafts,
  discardReviewDraft,
  updateSavedQuestionForQuiz,
} = questionSlice.actions;

const EMPTY_REVIEW_DRAFTS: Record<string, ReviewQuestionDraft> = {};
export const selectReviewDrafts = (state: { question: QuestionState }, quizId: string) =>
  state.question.reviewDraftsByQuiz?.[quizId] || EMPTY_REVIEW_DRAFTS;
export const selectHasReviewDrafts = (state: { question: QuestionState }, quizId: string) =>
  Object.keys(selectReviewDrafts(state, quizId)).length > 0;

export default questionSlice.reducer;
