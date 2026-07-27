import type { LearningObjective } from '../services/api';
import type { LearningObjectiveData } from '../components/generation/generationTypes';

type ObjectiveLike = LearningObjective | LearningObjectiveData;

export function normalizeLearningObjectiveData(
  objectives: readonly ObjectiveLike[]
): LearningObjectiveData[] {
  return objectives
    .filter((objective): objective is ObjectiveLike => (
      Boolean(objective)
      && typeof objective._id === 'string'
      && typeof objective.text === 'string'
      && objective.text.trim().length > 0
    ))
    .map((objective, index) => ({
      _id: objective._id,
      text: objective.text,
      order: objective.order ?? index,
      generationMetadata: objective.generationMetadata
    }));
}
