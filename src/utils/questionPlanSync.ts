import type { Question } from '../services/api';
import type { PlanItem } from '../components/generation/generationTypes';
import { getQuestionLearningObjectiveId } from './questionLearningObjective';

function getPlanGroupKey(learningObjectiveId: string, type: string) {
  return `${learningObjectiveId}::${type}`;
}

function getQuestionMatchScore(item: PlanItem, question: Question) {
  let score = 0;
  const metadata = question.generationMetadata;

  if (item.difficulty === question.difficulty) score += 2;
  if (item.selectionMode === question.content?.selectionMode) score += 2;
  if (item.focusArea && item.focusArea === metadata?.focusArea) score += 6;
  if (item.bloomLevel && item.bloomLevel === metadata?.bloomLevel) score += 3;
  if (item.pedagogicalIntent && item.pedagogicalIntent === metadata?.pedagogicalIntent) score += 3;

  return score;
}

function createPlanItemFromQuestion(question: Question): PlanItem {
  const learningObjectiveId = getQuestionLearningObjectiveId(question) || '';
  const metadata = question.generationMetadata;

  return {
    id: `synced-${question._id}`,
    type: question.type,
    learningObjectiveId,
    count: 1,
    difficulty: question.difficulty,
    focusArea: metadata?.focusArea,
    bloomLevel: metadata?.bloomLevel as PlanItem['bloomLevel'],
    pedagogicalIntent: metadata?.pedagogicalIntent as PlanItem['pedagogicalIntent'],
    rationale: metadata?.planRationale,
    ...(question.type === 'multiple-choice' && {
      selectionMode: question.content?.selectionMode || 'single'
    }),
    ...(!learningObjectiveId && {
      customPrompt: question.questionText,
      useCustomPromptOnly: true
    })
  };
}

export function reconcilePlanItemsWithQuestions(
  planItems: readonly PlanItem[],
  questions: readonly Question[]
): PlanItem[] {
  if (questions.length === 0) {
    return [...planItems];
  }

  const countsByPlanId = new Map<string, number>();
  const newItemsByGroup = new Map<string, PlanItem>();

  questions.forEach(question => {
    const learningObjectiveId = getQuestionLearningObjectiveId(question) || '';
    const groupKey = getPlanGroupKey(learningObjectiveId, question.type);
    const candidates = planItems.filter(item => (
      getPlanGroupKey(item.learningObjectiveId, item.type) === groupKey
    ));

    if (candidates.length > 0) {
      const selected = [...candidates].sort((left, right) => {
        const scoreDifference = getQuestionMatchScore(right, question)
          - getQuestionMatchScore(left, question);
        if (scoreDifference !== 0) return scoreDifference;

        const leftLoad = (countsByPlanId.get(left.id) || 0) / Math.max(left.count, 1);
        const rightLoad = (countsByPlanId.get(right.id) || 0) / Math.max(right.count, 1);
        return leftLoad - rightLoad;
      })[0];

      countsByPlanId.set(selected.id, (countsByPlanId.get(selected.id) || 0) + 1);
      return;
    }

    const existingNewItem = newItemsByGroup.get(groupKey);
    if (existingNewItem) {
      existingNewItem.count += 1;
    } else {
      newItemsByGroup.set(groupKey, createPlanItemFromQuestion(question));
    }
  });

  const reconciled = [
    ...planItems
      .filter(item => (countsByPlanId.get(item.id) || 0) > 0)
      .map(item => ({
        ...item,
        count: countsByPlanId.get(item.id) || 0
      })),
    ...newItemsByGroup.values()
  ];

  const unchanged = reconciled.length === planItems.length
    && reconciled.every((item, index) => (
      item.id === planItems[index].id
      && item.count === planItems[index].count
    ));

  return unchanged ? [...planItems] : reconciled;
}
