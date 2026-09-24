import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import appReducer, { setUser, type UserInfo } from './appSlice';
import questionReducer, { setQuestionsForQuiz, startReviewDraft, updateReviewDrafts, selectHasReviewDrafts } from './questionSlice';
import type { Question } from '../../services/api';

const firstUser = { id: 'first-owner', displayName: 'First instructor' } as UserInfo;
const saved = { _id: 'q1', quiz: 'quiz1', questionText: 'Saved question', content: {} } as Question;
function setup() {
  const store = configureStore({ reducer: { app: appReducer, question: questionReducer } });
  store.dispatch(setUser(firstUser));
  store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [saved] }));
  store.dispatch(startReviewDraft({ quizId: 'quiz1', questionId: 'q1' }));
  store.dispatch(updateReviewDrafts({ quizId: 'quiz1', questions: [{ ...saved, questionText: 'Private unsaved instructor wording' }] }));
  return store;
}

describe('Review draft ownership', () => {
  it.each([null, { ...firstUser, id: 'second-owner' }])('clears private drafts on authentication owner change to %s', user => {
    const store = setup();
    expect(selectHasReviewDrafts(store.getState(), 'quiz1')).toBe(true);
    store.dispatch(setUser(user));
    expect(store.getState().question.reviewDraftsByQuiz).toEqual({});
    store.dispatch(setUser(firstUser));
    expect(selectHasReviewDrafts(store.getState(), 'quiz1')).toBe(false);
    expect(JSON.stringify(store.getState())).not.toContain('Private unsaved instructor wording');
  });

  it('preserves drafts when the current instructor profile is hydrated again', () => {
    const store = setup();
    store.dispatch(setUser({ ...firstUser, displayName: 'Updated display name' }));
    expect(store.getState().question.reviewDraftsByQuiz.quiz1.q1.question.questionText).toBe('Private unsaved instructor wording');
  });
});
