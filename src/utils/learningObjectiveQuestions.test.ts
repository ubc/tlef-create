import { describe, expect, it, vi } from 'vitest';
import type { Question } from '../services/api';
import {
  buildLinkedQuestionRegenerationPrompt,
  getQuestionsLinkedToObjective,
  regenerateQuestionsSequentially,
} from './learningObjectiveQuestions';

const question = (id: string, learningObjective: Question['learningObjective']) => ({
  _id: id,
  learningObjective,
} as Question);

describe('learning-objective question impact', () => {
  it('finds linked questions for populated and id-only objective references', () => {
    const questions = [
      question('q1', 'lo-1'),
      question('q2', { _id: 'lo-1', text: 'Objective 1' } as Question['learningObjective']),
      question('q3', 'lo-2'),
    ];

    expect(getQuestionsLinkedToObjective(questions, 'lo-1').map(item => item._id))
      .toEqual(['q1', 'q2']);
  });

  it('explains that Cancel keeps questions rather than cancelling the LO update', () => {
    const prompt = buildLinkedQuestionRegenerationPrompt(2, 'edit');
    expect(prompt).toContain('Select OK to regenerate the 2 linked questions');
    expect(prompt).toContain('Select Cancel to keep the existing questions unchanged.');
  });

  it('continues regenerating remaining linked questions after one fails', async () => {
    const questions = [question('q1', 'lo-1'), question('q2', 'lo-1'), question('q3', 'lo-1')];
    const regenerate = vi.fn(async (item: Question) => {
      if (item._id === 'q2') throw new Error('temporary failure');
    });

    const result = await regenerateQuestionsSequentially(questions, regenerate);

    expect(regenerate).toHaveBeenCalledTimes(3);
    expect(result.succeeded.map(item => item._id)).toEqual(['q1', 'q3']);
    expect(result.failed.map(item => item._id)).toEqual(['q2']);
  });
});
