import { describe, expect, it } from 'vitest';
import type { LearningObjective, Question } from '../services/api';
import {
  filterQuestionsByLearningObjectiveId,
  getQuestionLearningObjectiveId
} from './questionLearningObjective';

const questionWithObjective = (
  id: string,
  learningObjective: Question['learningObjective']
) => ({ _id: id, learningObjective });

describe('question learning objective helpers', () => {
  it('uses the stable objective id for both populated and unpopulated questions', () => {
    const populatedObjective = {
      _id: 'objective-1',
      text: 'Analyze evidence',
      order: 0
    } as LearningObjective;

    expect(getQuestionLearningObjectiveId(
      questionWithObjective('question-1', populatedObjective)
    )).toBe('objective-1');
    expect(getQuestionLearningObjectiveId(
      questionWithObjective('question-2', 'objective-2')
    )).toBe('objective-2');
  });

  it('filters by objective id instead of objective text or array position', () => {
    const questions = [
      questionWithObjective('question-1', {
        _id: 'objective-1',
        text: 'Duplicate text',
        order: 0
      } as LearningObjective),
      questionWithObjective('question-2', {
        _id: 'objective-2',
        text: 'Duplicate text',
        order: 1
      } as LearningObjective)
    ];

    expect(filterQuestionsByLearningObjectiveId(questions, 'objective-2'))
      .toEqual([questions[1]]);
    expect(filterQuestionsByLearningObjectiveId(questions, null))
      .toEqual(questions);
  });
});
