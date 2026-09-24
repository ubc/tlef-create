import { describe, expect, it } from 'vitest';
import reducer, { assignMaterials, fetchQuizById, setCurrentQuiz, updateQuiz, updateQuizLocally } from './quizSlice';
import type { Quiz } from '../../services/api';

const saved = {
  _id: 'quiz1', name: 'Water cycle', folder: { _id: 'course1', name: 'QA course' },
  questions: ['question1'], materials: [], settings: { planMode: 'manual' }
} as Quiz;
const response = { ...saved, folder: 'course1', name: 'Updated water cycle' };

describe('Quiz course metadata after mutations', () => {
  it.each([
    ['blueprint save', () => updateQuizLocally(response)],
    ['quiz rename/settings', () => updateQuiz.fulfilled(response, 'request1', { id: 'quiz1', updates: { name: response.name } })],
    ['material assignment', () => assignMaterials.fulfilled(response, 'request1', { id: 'quiz1', materialIds: [] })],
    ['detail refresh fallback', () => fetchQuizById.fulfilled(response, 'request1', 'quiz1')]
  ])('keeps the loaded course name after %s returns a bare folder ID', (_label, action) => {
    const loaded = reducer(undefined, setCurrentQuiz(saved));
    const updated = reducer(loaded, action());
    expect(updated.currentQuiz?.folder).toEqual({ _id: 'course1', name: 'QA course' });
    expect(updated.currentQuiz?.name).toBe('Updated water cycle');
  });

  it('accepts a fresh course name and does not carry an old name into a different course', () => {
    const loaded = reducer(undefined, setCurrentQuiz(saved));
    const renamed = reducer(loaded, updateQuizLocally({ ...response, folder: { _id: 'course1', name: 'Renamed course' } }));
    expect(renamed.currentQuiz?.folder).toEqual({ _id: 'course1', name: 'Renamed course' });
    const moved = reducer(loaded, updateQuizLocally({ ...response, folder: 'course2' }));
    expect(moved.currentQuiz?.folder).toBe('course2');
    expect(reducer(loaded, setCurrentQuiz(null)).currentQuiz).toBeNull();
  });
});
