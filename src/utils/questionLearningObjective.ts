import type { Question } from '../services/api';

export function getQuestionLearningObjectiveId(
  question: Pick<Question, 'learningObjective'>
): string | null {
  const learningObjective = question.learningObjective;

  if (typeof learningObjective === 'string') {
    return learningObjective || null;
  }

  return learningObjective?._id || null;
}

export function filterQuestionsByLearningObjectiveId<T extends Pick<Question, 'learningObjective'>>(
  questions: readonly T[],
  learningObjectiveId: string | null
): T[] {
  if (!learningObjectiveId) {
    return [...questions];
  }

  return questions.filter(
    question => getQuestionLearningObjectiveId(question) === learningObjectiveId
  );
}
