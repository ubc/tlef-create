import { describe, expect, test } from '@jest/globals';
import {
  alignPlanItemsToSubpoints,
  buildQuestionBudget,
  discardPlanItemsOutsideBudget,
  rebalancePlanToBudget
} from '../../services/questionBudgetService.js';

const learningObjectives = [
  {
    _id: 'lo-1',
    text: 'Analyze forces with free-body diagrams.',
    generationMetadata: {
      bloomLevel: 'analyze',
      subpoints: ['Identify forces', 'Choose axes', 'Resolve components', 'Check signs']
    }
  },
  {
    _id: 'lo-2',
    text: "Explain Newton's third law.",
    generationMetadata: {
      bloomLevel: 'understand',
      subpoints: ['Identify action-reaction pairs', 'Explain why pairs do not cancel']
    }
  },
  {
    _id: 'lo-3',
    text: 'Create equations for connected systems.',
    generationMetadata: {
      bloomLevel: 'create',
      subpoints: []
    }
  }
];

describe('questionBudgetService', () => {
  test('returns the same automatic budget for the same LO metadata', () => {
    const first = buildQuestionBudget(learningObjectives, { approach: 'support' });
    const second = buildQuestionBudget(learningObjectives, { approach: 'support' });

    expect(first).toEqual(second);
    expect(first.total).toBe(7);
    expect(first.allocations.map(allocation => allocation.count)).toEqual([4, 1, 2]);
  });

  test('uses the instructor total while preserving relative LO complexity', () => {
    const budget = buildQuestionBudget(learningObjectives, {
      approach: 'support',
      requestedTotal: 12
    });

    expect(budget.total).toBe(12);
    expect(budget.allocations.map(allocation => allocation.count)).toEqual([6, 2, 4]);
  });

  test('gives an emphasized objective at least half of a fixed total', () => {
    const budget = buildQuestionBudget(learningObjectives, {
      approach: 'assess',
      requestedTotal: 7,
      emphasize: [2]
    });
    const counts = budget.allocations.map(allocation => allocation.count);

    expect(budget.total).toBe(7);
    expect(counts[2]).toBeGreaterThanOrEqual(4);
    expect(counts[2]).toBeGreaterThan(Math.max(counts[0], counts[1]));
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    expect(budget.allocations[2].rationale).toContain('instructor asked to emphasize');
  });

  test('de-emphasized objectives keep one question and lose share', () => {
    const baseline = buildQuestionBudget(learningObjectives, { approach: 'assess', requestedTotal: 9 });
    const budget = buildQuestionBudget(learningObjectives, { approach: 'assess', requestedTotal: 9, deemphasize: [0] });

    expect(budget.total).toBe(9);
    expect(budget.allocations[0].count).toBeLessThan(baseline.allocations[0].count);
    expect(budget.allocations[0].count).toBeGreaterThanOrEqual(1);
  });

  test('adds questions for an emphasized objective in automatic mode', () => {
    const baseline = buildQuestionBudget(learningObjectives, { approach: 'assess' });
    const emphasized = buildQuestionBudget(learningObjectives, { approach: 'assess', emphasize: [2] });

    expect(emphasized.total).toBeGreaterThan(baseline.total);
    expect(emphasized.allocations[2].count).toBeGreaterThanOrEqual(Math.ceil(emphasized.total / 2));
  });

  test('puts every question on the objectives the instructor limited the quiz to', () => {
    const fixed = buildQuestionBudget(learningObjectives, { approach: 'assess', requestedTotal: 7, only: [2] });
    expect(fixed.total).toBe(7);
    expect(fixed.allocations).toHaveLength(1);
    expect(fixed.allocations[0]).toMatchObject({ learningObjectiveIndex: 2, count: 7 });

    const auto = buildQuestionBudget(learningObjectives, { approach: 'assess', only: [2] });
    const baseline = buildQuestionBudget(learningObjectives, { approach: 'assess' });
    expect(auto.total).toBe(baseline.total);
    expect(auto.allocations.map(a => a.learningObjectiveIndex)).toEqual([2]);
  });

  test('rebalancing keeps an LO-limited plan on that objective', () => {
    const budget = buildQuestionBudget(learningObjectives, { approach: 'assess', requestedTotal: 7, only: [2] });
    const modelRows = [
      { type: 'multiple-choice', learningObjectiveIndex: 0, count: 3 },
      { type: 'multiple-choice', learningObjectiveIndex: 2, count: 2 }
    ];
    const kept = discardPlanItemsOutsideBudget(modelRows, budget).items;
    const plan = rebalancePlanToBudget(kept, budget, 'multiple-choice', 'assess');
    expect(plan.every(item => item.learningObjectiveIndex === 2)).toBe(true);
    expect(plan.reduce((sum, item) => sum + item.count, 0)).toBe(7);
  });

  test('rejects a total that cannot cover every learning objective', () => {
    expect(() => buildQuestionBudget(learningObjectives, {
      approach: 'assess',
      requestedTotal: 2
    })).toThrow('Question total must be at least 3');
  });

  test('enforces per-LO counts and maps rows to concrete subpoints', () => {
    const budget = buildQuestionBudget(learningObjectives, { approach: 'support' });
    const llmPlan = [
      {
        type: 'flashcard',
        learningObjectiveIndex: 0,
        count: 9,
        rationale: 'LLM proposal'
      },
      {
        type: 'multiple-choice',
        learningObjectiveIndex: 1,
        count: 3,
        rationale: 'LLM proposal'
      }
    ];

    const rebalanced = rebalancePlanToBudget(llmPlan, budget, 'multiple-choice', 'support');
    const aligned = alignPlanItemsToSubpoints(rebalanced, learningObjectives);
    const countsByLO = aligned.reduce((counts, item) => {
      counts[item.learningObjectiveIndex] = (counts[item.learningObjectiveIndex] || 0) + item.count;
      return counts;
    }, {});

    expect(countsByLO).toEqual({ 0: 4, 1: 1, 2: 2 });
    expect(aligned.filter(item => item.learningObjectiveIndex === 0).map(item => item.focusArea))
      .toEqual(learningObjectives[0].generationMetadata.subpoints);
  });

  test('groups every subpoint when there are fewer questions than subpoints', () => {
    const aligned = alignPlanItemsToSubpoints([
      {
        type: 'multiple-choice',
        learningObjectiveIndex: 0,
        count: 2,
        rationale: 'Assess the objective'
      }
    ], learningObjectives);

    expect(aligned.map(item => item.focusArea)).toEqual([
      'Identify forces; Choose axes',
      'Resolve components; Check signs'
    ]);
  });

  test('discards invalid model LO indexes before the budget restores coverage', () => {
    const budget = buildQuestionBudget(learningObjectives, { approach: 'support' });
    const sanitized = discardPlanItemsOutsideBudget([
      { type: 'flashcard', learningObjectiveIndex: '0', count: 1 },
      { type: 'flashcard', learningObjectiveIndex: 6, count: 2 },
      { type: 'flashcard', learningObjectiveIndex: -1, count: 2 },
      { type: 'flashcard', learningObjectiveIndex: 'not-an-index', count: 2 }
    ], budget);

    expect(sanitized.items).toEqual([
      { type: 'flashcard', learningObjectiveIndex: 0, count: 1 }
    ]);
    expect(sanitized.discardedIndexes).toEqual(['6', '-1', 'not-an-index']);

    const rebalanced = rebalancePlanToBudget(
      sanitized.items,
      budget,
      'multiple-choice',
      'support'
    );
    expect(rebalanced.reduce((sum, item) => sum + item.count, 0)).toBe(budget.total);
    expect(new Set(rebalanced.map(item => item.learningObjectiveIndex))).toEqual(new Set([0, 1, 2]));
  });
});
