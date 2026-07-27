import { describe, expect, it } from 'vitest';
import type { LearningObjective } from '../services/api';
import { normalizeLearningObjectiveData } from './learningObjectiveState';

describe('normalizeLearningObjectiveData', () => {
  it('preserves complete objective records after an objective is deleted', () => {
    const objectives = [
      { _id: 'objective-2', text: 'Evaluate a model', order: 1 },
      { _id: 'objective-3', text: 'Create a solution', order: 2 }
    ] as LearningObjective[];

    expect(normalizeLearningObjectiveData(objectives)).toEqual([
      {
        _id: 'objective-2',
        text: 'Evaluate a model',
        order: 1,
        generationMetadata: undefined
      },
      {
        _id: 'objective-3',
        text: 'Create a solution',
        order: 2,
        generationMetadata: undefined
      }
    ]);
  });

  it('drops incomplete records instead of exposing them as Unknown objectives', () => {
    const objectives = [
      { _id: 'objective-1', text: '', order: 0 },
      { _id: 'objective-2', text: 'Analyze evidence', order: 1 }
    ] as LearningObjective[];

    expect(normalizeLearningObjectiveData(objectives).map(objective => objective.text))
      .toEqual(['Analyze evidence']);
  });
});
