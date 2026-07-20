import type { Question } from '../services/api';

export function getQuestionLearningObjectiveId(question: Question) {
  if (typeof question.learningObjective === 'string') return question.learningObjective;
  return question.learningObjective?._id || '';
}

export function getQuestionsLinkedToObjective(questions: Question[], objectiveId: string) {
  return questions.filter(question => getQuestionLearningObjectiveId(question) === objectiveId);
}

export function buildLinkedQuestionRegenerationPrompt(questionCount: number, action: 'edit' | 'regenerate') {
  const verb = action === 'edit' ? 'edit this learning objective' : 'regenerate this learning objective';
  return [
    `This learning objective has ${questionCount} linked question${questionCount === 1 ? '' : 's'}.`,
    '',
    `If you ${verb}, the existing question content may no longer match the objective.`,
    '',
    `Select OK to regenerate the ${questionCount} linked question${questionCount === 1 ? '' : 's'} after the objective is updated.`,
    'Select Cancel to keep the existing questions unchanged.'
  ].join('\n');
}

export async function regenerateQuestionsSequentially(
  questions: Question[],
  regenerate: (question: Question) => Promise<unknown>
) {
  const succeeded: Question[] = [];
  const failed: Question[] = [];

  for (const question of questions) {
    try {
      await regenerate(question);
      succeeded.push(question);
    } catch {
      failed.push(question);
    }
  }

  return { succeeded, failed };
}
