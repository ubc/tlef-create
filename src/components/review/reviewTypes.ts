import { Question } from '../../services/api';
import { LearningObjectiveData } from '../generation/generationTypes';

export interface ReviewEditProps {
  quizId: string;
  learningObjectives: LearningObjectiveData[];
}

export interface ExtendedQuestion extends Question {
  isEditing?: boolean;
}

export const questionTypes = [
  { id: 'multiple-choice', label: 'Multiple Choice' },
  { id: 'true-false', label: 'True/False' },
  { id: 'flashcard', label: 'Flashcard' },
  { id: 'summary', label: 'Summary' },
  { id: 'discussion', label: 'Discussion' },
  { id: 'matching', label: 'Matching' },
  { id: 'ordering', label: 'Ordering' },
  { id: 'cloze', label: 'Cloze Test' }
];
