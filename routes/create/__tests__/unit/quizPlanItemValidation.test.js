import { describe, expect, test } from '@jest/globals';
import mongoose from 'mongoose';
import Quiz from '../../models/Quiz.js';

function buildQuizWithPlanItem(planItem) {
  return new Quiz({
    name: 'Plan validation test',
    folder: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(),
    settings: {
      planItems: [{
        type: 'multiple-choice',
        count: 1,
        ...planItem
      }]
    }
  });
}

describe('quiz blueprint plan item validation', () => {
  test('accepts a custom-prompt-only row without a learning objective', () => {
    const quiz = buildQuizWithPlanItem({
      learningObjective: null,
      customPrompt: 'Assess the instructor-provided case study.',
      useCustomPromptOnly: true,
      selectionMode: 'multiple'
    });

    expect(quiz.validateSync()).toBeUndefined();
    expect(quiz.settings.planItems[0].learningObjective).toBeNull();
    expect(quiz.settings.planItems[0].customPrompt).toBe('Assess the instructor-provided case study.');
    expect(quiz.settings.planItems[0].selectionMode).toBe('multiple');
  });

  test('still requires either a linked objective or a custom prompt', () => {
    const quiz = buildQuizWithPlanItem({ learningObjective: null });
    const validationError = quiz.validateSync();

    expect(validationError).toBeDefined();
    expect(validationError?.errors['settings.planItems.0.learningObjective']).toBeDefined();
  });
});
