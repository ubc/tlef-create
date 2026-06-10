export type DeliveryTarget = 'h5p-package' | 'canvas-lti';
export type H5PPackageFormat = 'column' | 'interactive-book' | 'question-set' | 'standalone';
export type CanvasLTIFormat = 'mixed-activity';
export type TargetFormat = H5PPackageFormat | CanvasLTIFormat;

export interface DeliveryTargetOption {
  value: DeliveryTarget;
  label: string;
  description: string;
}

export interface TargetFormatOption {
  value: TargetFormat;
  label: string;
  description: string;
}

export interface QuestionTypeOption {
  value: string;
  label: string;
}

export const DELIVERY_TARGETS: DeliveryTargetOption[] = [
  {
    value: 'h5p-package',
    label: 'H5P Package',
    description: 'Download a standard .h5p package for Lumi, WordPress, Moodle, or h5p.org.'
  },
  {
    value: 'canvas-lti',
    label: 'Canvas LTI',
    description: 'Publish through CREATE’s LTI player for Canvas modules.'
  }
];

export const H5P_PACKAGE_FORMATS: TargetFormatOption[] = [
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

export const CANVAS_LTI_FORMATS: TargetFormatOption[] = [
  {
    value: 'mixed-activity',
    label: 'Mixed Activity',
    description: 'CREATE player runtime for Canvas LTI; supports all CREATE-renderable question types.'
  }
];

export const TARGET_FORMATS: TargetFormatOption[] = [
  ...H5P_PACKAGE_FORMATS,
  ...CANVAS_LTI_FORMATS
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
    'documentation-tool'
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
    'crossword',
    'sort-paragraphs'
  ],
  'mixed-activity': [
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
    'sort-paragraphs',
    'branching-scenario'
  ]
};

export type PedagogicalApproach = 'support' | 'assess' | 'gamify';

// Mirrors the `allowedTypes` lists in routes/create/services/promptTemplateInitializer.js
// so the UI can show users which H5P question types each AI approach will draw from.
export const QUESTION_TYPES_BY_APPROACH: Record<PedagogicalApproach, string[]> = {
  support: ['flashcard', 'summary', 'mark-the-words'],
  assess: ['multiple-choice', 'true-false', 'single-choice-set', 'essay'],
  gamify: ['matching', 'ordering', 'cloze', 'discussion', 'crossword', 'sort-paragraphs', 'mark-the-words']
};

export function getQuestionTypesForApproach(approach: PedagogicalApproach): QuestionTypeOption[] {
  const allowed = new Set(QUESTION_TYPES_BY_APPROACH[approach]);
  return QUESTION_TYPES.filter(type => allowed.has(type.value));
}

export function getFormatsForDeliveryTarget(deliveryTarget: DeliveryTarget): TargetFormatOption[] {
  return deliveryTarget === 'canvas-lti' ? CANVAS_LTI_FORMATS : H5P_PACKAGE_FORMATS;
}

export function getDefaultFormatForDeliveryTarget(deliveryTarget: DeliveryTarget): TargetFormat {
  return getFormatsForDeliveryTarget(deliveryTarget)[0].value;
}

export function getDeliveryTargetForFormat(targetFormat: TargetFormat): DeliveryTarget {
  return targetFormat === 'mixed-activity' ? 'canvas-lti' : 'h5p-package';
}

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

export function getUnsupportedQuestionTypesForTarget(types: string[], targetFormat: TargetFormat): QuestionTypeOption[] {
  const seen = new Set<string>();
  return types.reduce<QuestionTypeOption[]>((unsupported, type) => {
    if (seen.has(type) || isQuestionTypeAllowedForTarget(type, targetFormat)) {
      return unsupported;
    }
    seen.add(type);
    unsupported.push(QUESTION_TYPES.find(option => option.value === type) || { value: type, label: type });
    return unsupported;
  }, []);
}
