import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import questionReducer, { setQuestionsForQuiz, updateSavedQuestionForQuiz } from '../../store/slices/questionSlice';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useQuestionDrafts } from './useQuestionDrafts';
import { useQuestionEditHandlers } from './useQuestionEditHandlers';
import type { ExtendedQuestion } from './reviewTypes';

const saved = {
  _id: 'q1', questionText: 'Saved question', correctAnswer: 'Correct', explanation: 'Saved explanation',
  type: 'multiple-choice', content: { selectionMode: 'single', options: [
    { text: 'Correct', isCorrect: true, order: 0, chosenFeedback: 'Saved feedback' },
    { text: 'Wrong', isCorrect: false, order: 1 },
    { text: 'Other', isCorrect: false, order: 2 }
  ] }
} as ExtendedQuestion;

function renderEditor() {
  const store = configureStore({ reducer: { question: questionReducer } });
  store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [saved] }));
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
  const result = renderHook(() => {
    const drafts = useQuestionDrafts('quiz1');
    return { ...drafts, drafts, handlers: useQuestionEditHandlers(drafts.questions, drafts.setQuestions) };
  }, { wrapper });
  return { ...result, store };
}

describe('question edit drafts', () => {
  it('Cancel restores all fields and nested content without mutating the saved Redux object', () => {
    const { result } = renderEditor();
    act(() => result.current.drafts.toggleEdit('q1'));
    act(() => result.current.handlers.updateQuestion('q1', 'questionText', 'Unsaved question'));
    act(() => result.current.handlers.updateMultipleChoiceFeedback('q1', 0, 'chosenFeedback', 'Unsaved feedback'));
    act(() => result.current.handlers.removeMultipleChoiceOption('q1', 0));
    expect(saved.content.options).toHaveLength(3);
    expect(saved.content.options[1].isCorrect).toBe(false);
    act(() => result.current.drafts.toggleEdit('q1'));
    expect(result.current.questions[0]).toEqual({ ...saved, isEditing: false });
  });

  it('a new edit after save rolls back to the newly saved version', () => {
    const { result, store } = renderEditor();
    act(() => result.current.drafts.toggleEdit('q1'));
    act(() => result.current.handlers.updateMultipleChoiceOption('q1', 0, 'Updated correct answer'));
    expect(result.current.questions[0].correctAnswer).toBe('Updated correct answer');
    act(() => {
      store.dispatch(updateSavedQuestionForQuiz({ quizId: 'quiz1', question: result.current.questions[0] }));
      result.current.drafts.discardSnapshot('q1');
    });
    act(() => result.current.drafts.toggleEdit('q1'));
    act(() => result.current.handlers.updateMultipleChoiceOption('q1', 0, 'Unwanted answer'));
    act(() => result.current.drafts.toggleEdit('q1'));
    expect(result.current.questions[0].correctAnswer).toBe('Updated correct answer');
    expect(result.current.questions[0].content.options[0].text).toBe('Updated correct answer');
  });

  it('retains nested options and feedback after publication and an editor remount', () => {
    const first = renderEditor();
    act(() => first.result.current.toggleEdit('q1'));
    act(() => first.result.current.handlers.updateMultipleChoiceFeedback('q1', 0, 'chosenFeedback', 'Recovered feedback'));
    act(() => first.result.current.handlers.updateMultipleChoiceOption('q1', 0, 'Recovered correct answer'));
    act(() => first.store.dispatch(setQuestionsForQuiz({ quizId: 'quiz1', questions: [] })));
    expect(first.result.current.questions).toEqual([]);
    expect(first.result.current.recoveredDrafts[0].question.content.options[0]).toMatchObject({ text: 'Recovered correct answer', chosenFeedback: 'Recovered feedback' });
    expect(first.result.current.recoveredDrafts[0].original).toEqual(saved);
    first.unmount();
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={first.store}>{children}</Provider>;
    const second = renderHook(() => useQuestionDrafts('quiz1'), { wrapper });
    expect(second.result.current.recoveredDrafts[0].question.correctAnswer).toBe('Recovered correct answer');
    expect(second.result.current.recoveredDrafts[0].question.content.options[0].chosenFeedback).toBe('Recovered feedback');
  });
});
