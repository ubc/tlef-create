import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import type { AppDispatch, RootState } from '../../store';
import { selectQuestionsByQuiz } from '../../store/selectors';
import {
  discardReviewDraft, selectReviewDrafts, startReviewDraft, updateReviewDrafts,
} from '../../store/slices/questionSlice';
import type { Question } from '../../services/api';
import type { ExtendedQuestion } from './reviewTypes';

/** Keep complete local drafts independent of batch publication and tab mounts. */
export function useQuestionDrafts(quizId: string) {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const saved = useSelector((state: RootState) => selectQuestionsByQuiz(state, quizId));
  const drafts = useSelector((state: RootState) => selectReviewDrafts(state, quizId));
  const questions = useMemo(() => saved.map(question => drafts[question._id]
    ? { ...drafts[question._id].question, isEditing: true }
    : { ...question, isEditing: false }), [saved, drafts]);
  const recoveredDrafts = useMemo(() => Object.values(drafts).filter(draft =>
    !saved.some(question => question._id === draft.question._id)), [saved, drafts]);

  const setQuestions: Dispatch<SetStateAction<ExtendedQuestion[]>> = useCallback(update => {
    const state = store.getState();
    const currentDrafts = selectReviewDrafts(state, quizId);
    const current = selectQuestionsByQuiz(state, quizId).map(question => currentDrafts[question._id]
      ? { ...currentDrafts[question._id].question, isEditing: true }
      : { ...question, isEditing: false });
    const next = typeof update === 'function' ? update(current) : update;
    dispatch(updateReviewDrafts({ quizId, questions: next.filter(question => question.isEditing).map(question => {
      const savedFields = { ...question };
      delete savedFields.isEditing;
      return savedFields;
    }) }));
  }, [dispatch, quizId, store]);

  const toggleEdit = (questionId: string) => {
    dispatch(selectReviewDrafts(store.getState(), quizId)[questionId]
      ? discardReviewDraft({ quizId, questionId })
      : startReviewDraft({ quizId, questionId }));
  };
  const discardSnapshot = (questionId: string, expected?: Question) => {
    dispatch(discardReviewDraft({ quizId, questionId, expected }));
  };

  return { questions, setQuestions, recoveredDrafts, toggleEdit, discardSnapshot };
}
