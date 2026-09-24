import { useCallback } from 'react';
import type { QuestionGenerationJob, StreamingQuestionConfig } from '../services/api';
import { useQuestionGenerationJob } from './useQuestionGenerationJob';

/** Review additions use the same durable, all-or-nothing task as Blueprint. */
export function useSingleQuestionGeneration(quizId: string, ownerId?: string, onSettled?: (job: QuestionGenerationJob) => void) {
  const task = useQuestionGenerationJob(quizId, ownerId, onSettled);
  const { start } = task;
  const generate = useCallback(async (config: StreamingQuestionConfig) => {
    const job = await start([config], 'append');
    const questionId = job.questionIds[0];
    if (!questionId) throw new Error('The completed task did not identify its saved question. Refresh Review.');
    return questionId;
  }, [start]);
  return { ...task, generate, isGenerating: task.isBusy };
}
