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
  { id: 'cloze', label: 'Cloze Test' },
  { id: 'mark-the-words', label: 'Mark the Words' },
  { id: 'single-choice-set', label: 'Single Choice Set' },
  { id: 'essay', label: 'Essay' },
  { id: 'question-set', label: 'Question Set' },
  { id: 'free-text', label: 'Free Text' },
  { id: 'open-ended', label: 'Open Ended' },
  { id: 'simple-multi-choice', label: 'Simple Multi Choice' },
  { id: 'sort-paragraphs', label: 'Sort Paragraphs' },
  { id: 'crossword', label: 'Crossword' },
  { id: 'dictation', label: 'Dictation' },
  { id: 'arithmetic-quiz', label: 'Arithmetic Quiz' },
  { id: 'branching-scenario', label: 'Branching Scenario' }
];
