import { RootState } from './index';
import { Question } from '../services/api';

const EMPTY_QUESTIONS: Question[] = [];

/**
 * Select questions for a specific quiz.
 * Returns stable empty array if no questions loaded yet.
 */
export const selectQuestionsByQuiz = (state: RootState, quizId: string): Question[] =>
  state.question.questionsByQuiz[quizId] || EMPTY_QUESTIONS;

/**
 * Select loading state for a specific quiz's questions.
 */
export const selectQuestionsLoading = (state: RootState, quizId: string): boolean =>
  state.question.loadingByQuiz[quizId] || false;

/**
 * Select whether a specific quiz is currently generating questions.
 */
export const selectIsGenerating = (state: RootState, quizId: string): boolean =>
  state.plan.generationStatusByQuiz[quizId]?.generating || false;

/**
 * Select the full generation status for a specific quiz.
 */
export const selectGenerationStatus = (state: RootState, quizId: string) =>
  state.plan.generationStatusByQuiz[quizId] || null;
