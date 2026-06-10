export type TargetFormat = 'column' | 'interactive-book' | 'question-set' | 'standalone';

export interface TargetFormatOption {
  value: TargetFormat;
  label: string;
  description: string;
}

export interface QuestionTypeOption {
  value: string;
  label: string;
}

export const TARGET_FORMATS: TargetFormatOption[] = [
  {
    value: 'column',
    label: 'Column',
    description: 'Flexible page layout with mixed content.'
  },
  {
    value: 'interactive-book',
    label: 'Interactive Book',
    description: 'Chapter-based learning object with Column pages.'
  },
  {
    value: 'question-set',
    label: 'Question Set',
    description: 'Scored quiz format with a smaller question set.'
  },
  {
    value: 'standalone',
    label: 'Standalone',
    description: 'Best for complex single H5P activities.'
  }
];

export const QUESTION_TYPES: QuestionTypeOption[] = [
  { value: 'multiple-choice', label: 'Multiple Choice' },
  { value: 'true-false', label: 'True/False' },
  { value: 'flashcard', label: 'Flashcard' },
  { value: 'summary', label: 'Summary' },
  { value: 'discussion', label: 'Discussion' },
  { value: 'matching', label: 'Matching' },
  { value: 'ordering', label: 'Ordering' },
  { value: 'cloze', label: 'Fill in the Blank' },
  { value: 'mark-the-words', label: 'Mark the Words' },
  { value: 'single-choice-set', label: 'Single Choice Set' },
  { value: 'essay', label: 'Essay' },
  { value: 'sort-paragraphs', label: 'Sort Paragraphs' },
  { value: 'crossword', label: 'Crossword' },
  { value: 'branching-scenario', label: 'Branching Scenario' },
  { value: 'documentation-tool', label: 'Documentation Tool' }
];

export const QUESTION_TYPES_BY_TARGET: Record<TargetFormat, string[]> = {
  column: [
    'multiple-choice',
    'true-false',
    'cloze',
    'mark-the-words',
    'ordering',
    'matching',
    'single-choice-set',
    'essay',
    'flashcard',
    'summary',
    'discussion',
    'documentation-tool',
    'crossword',
    'sort-paragraphs'
  ],
  'interactive-book': [
    'multiple-choice',
    'true-false',
    'cloze',
    'mark-the-words',
    'ordering',
    'matching',
    'single-choice-set',
    'essay',
    'flashcard',
    'summary',
    'discussion',
    'documentation-tool'
  ],
  'question-set': [
    'multiple-choice',
    'true-false',
    'cloze',
    'mark-the-words',
    'essay'
  ],
  standalone: [
    'branching-scenario',
    'documentation-tool',
    'crossword',
    'sort-paragraphs'
  ]
};

export function getQuestionTypesForTarget(targetFormat: TargetFormat): QuestionTypeOption[] {
  const allowed = new Set(QUESTION_TYPES_BY_TARGET[targetFormat]);
  return QUESTION_TYPES.filter(type => allowed.has(type.value));
}

export function getFallbackQuestionType(targetFormat: TargetFormat): string {
  return QUESTION_TYPES_BY_TARGET[targetFormat][0] || QUESTION_TYPES[0].value;
}

export function isQuestionTypeAllowedForTarget(type: string, targetFormat: TargetFormat): boolean {
  return QUESTION_TYPES_BY_TARGET[targetFormat].includes(type);
}

export function normalizeQuestionTypeForTarget(type: string, targetFormat: TargetFormat): string {
  return isQuestionTypeAllowedForTarget(type, targetFormat)
    ? type
    : getFallbackQuestionType(targetFormat);
}
