import { describe, expect, it } from 'vitest';
import type { Question } from '../services/api';
import type { PlanItem } from '../components/generation/generationTypes';
import { reconcilePlanItemsWithQuestions } from './questionPlanSync';

const planItem = (overrides: Partial<PlanItem> = {}): PlanItem => ({
  id: 'plan-1',
  type: 'multiple-choice',
  learningObjectiveId: 'objective-1',
  count: 5,
  difficulty: 'moderate',
  focusArea: 'Apply the model',
  rationale: 'Assess application',
  ...overrides
});

const question = (
  id: string,
  overrides: Partial<Question> = {}
): Question => ({
  _id: id,
  quiz: 'quiz-1',
  learningObjective: 'objective-1',
  type: 'multiple-choice',
  difficulty: 'moderate',
  questionText: `Question ${id}`,
  content: { selectionMode: 'single' },
  correctAnswer: 'A',
  order: 0,
  reviewStatus: 'pending',
  createdBy: 'user-1',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
  ...overrides
});

describe('reconcilePlanItemsWithQuestions', () => {
  it('reduces a persisted plan count to the current Redux question count', () => {
    const currentPlan = [planItem()];
    const reconciled = reconcilePlanItemsWithQuestions(
      currentPlan,
      [question('question-1')]
    );

    expect(reconciled).toEqual([
      expect.objectContaining({
        id: 'plan-1',
        count: 1,
        focusArea: 'Apply the model',
        rationale: 'Assess application'
      })
    ]);
  });

  it('adds a plan row for a manually added question that has no matching row', () => {
    const reconciled = reconcilePlanItemsWithQuestions(
      [planItem()],
      [
        question('question-1'),
        question('question-2', {
          learningObjective: 'objective-2',
          type: 'true-false'
        })
      ]
    );

    expect(reconciled).toEqual([
      expect.objectContaining({ id: 'plan-1', count: 1 }),
      expect.objectContaining({
        id: 'synced-question-2',
        learningObjectiveId: 'objective-2',
        type: 'true-false',
        count: 1
      })
    ]);
  });

  it('preserves separate focus rows when question metadata identifies them', () => {
    const currentPlan = [
      planItem({ id: 'focus-a', count: 2, focusArea: 'Focus A' }),
      planItem({ id: 'focus-b', count: 2, focusArea: 'Focus B' })
    ];
    const reconciled = reconcilePlanItemsWithQuestions(currentPlan, [
      question('question-1', {
        generationMetadata: {
          generatedFrom: [],
          llmModel: 'test',
          generationPrompt: 'test',
          focusArea: 'Focus B',
          confidence: 1,
          processingTime: 1
        }
      })
    ]);

    expect(reconciled).toEqual([
      expect.objectContaining({ id: 'focus-b', count: 1, focusArea: 'Focus B' })
    ]);
  });
});
