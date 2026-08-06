/**
 * Canonical backend registry for mapping CREATE question types to native H5P
 * libraries. Conversion code consumes this metadata instead of maintaining a
 * second set of dependency and standalone-export switches.
 *
 * `aiEnabled` means the type is exposed in CREATE's AI authoring workflow.
 * Legacy adapters remain registered so existing questions can still export.
 */
const adapterDefinitions = [
  {
    type: 'multiple-choice',
    label: 'Multiple Choice',
    mainLibrary: 'H5P.MultiChoice 1.16',
    dependencies: ['H5P.MultiChoice', 'H5P.Question'],
    containers: ['column', 'interactive-book', 'question-set', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'true-false',
    label: 'True/False',
    mainLibrary: 'H5P.TrueFalse 1.8',
    dependencies: ['H5P.TrueFalse', 'H5P.Question'],
    containers: ['column', 'interactive-book', 'question-set', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'flashcard',
    label: 'Flashcard',
    mainLibrary: 'H5P.Dialogcards 1.9',
    dependencies: ['H5P.Dialogcards', 'H5P.Audio'],
    containers: ['column', 'interactive-book', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'guess-the-answer',
    label: 'Guess the Answer',
    mainLibrary: 'H5P.GuessTheAnswer 1.5',
    dependencies: ['H5P.GuessTheAnswer', 'FontAwesome'],
    containers: ['column', 'interactive-book', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'summary',
    label: 'Summary',
    mainLibrary: 'H5P.Accordion 1.0',
    dependencies: ['H5P.Accordion', 'H5P.AdvancedText'],
    containers: ['column', 'interactive-book', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'discussion',
    label: 'Discussion',
    mainLibrary: 'H5P.AdvancedText 1.1',
    dependencies: ['H5P.AdvancedText'],
    containers: ['column', 'interactive-book', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'matching',
    label: 'Matching',
    mainLibrary: 'H5P.DragText 1.10',
    dependencies: ['H5P.DragText', 'H5P.Question', 'jQuery.ui', 'H5P.TextUtilities'],
    containers: ['column', 'interactive-book', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'ordering',
    label: 'Ordering',
    mainLibrary: 'H5P.DragText 1.10',
    dependencies: ['H5P.DragText', 'H5P.Question', 'jQuery.ui', 'H5P.TextUtilities'],
    containers: ['column', 'interactive-book', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'cloze',
    label: 'Fill in the Blank',
    mainLibrary: 'H5P.Blanks 1.14',
    dependencies: ['H5P.Blanks', 'H5P.Question', 'H5P.TextUtilities'],
    containers: ['column', 'interactive-book', 'question-set', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'mark-the-words',
    label: 'Mark the Words',
    mainLibrary: 'H5P.MarkTheWords 1.11',
    dependencies: ['H5P.MarkTheWords', 'H5P.Question'],
    containers: ['column', 'interactive-book', 'question-set', 'mixed-activity'],
    aiEnabled: true,
    directStandaloneExport: true
  },
  {
    type: 'single-choice-set',
    label: 'Single Choice Set',
    mainLibrary: 'H5P.SingleChoiceSet 1.11',
    dependencies: ['H5P.SingleChoiceSet', 'H5P.Question', 'H5P.Transition'],
    containers: ['column', 'interactive-book', 'mixed-activity'],
    aiEnabled: true
  },
  {
    type: 'essay',
    label: 'Essay',
    mainLibrary: 'H5P.Essay 1.5',
    dependencies: ['H5P.Essay', 'H5P.Question', 'H5P.TextUtilities'],
    containers: ['column', 'interactive-book', 'question-set', 'mixed-activity'],
    aiEnabled: true,
    directStandaloneExport: true
  },
  {
    type: 'sort-paragraphs',
    label: 'Sort Paragraphs',
    mainLibrary: 'H5P.SortParagraphs 0.11',
    dependencies: ['H5P.SortParagraphs', 'H5P.Question'],
    containers: ['standalone', 'mixed-activity'],
    aiEnabled: true,
    directStandaloneExport: true
  },
  {
    type: 'crossword',
    label: 'Crossword',
    mainLibrary: 'H5P.Crossword 0.5',
    dependencies: ['H5P.Crossword', 'H5P.Question', 'H5P.Image', 'H5P.MaterialDesignIcons', 'jQuery.ui'],
    containers: ['standalone', 'mixed-activity'],
    aiEnabled: true,
    directStandaloneExport: true
  },
  {
    type: 'branching-scenario',
    label: 'Branching Scenario',
    mainLibrary: 'H5P.BranchingScenario 1.10',
    dependencies: ['H5P.BranchingScenario', 'H5P.BranchingQuestion', 'H5P.AdvancedText'],
    containers: ['standalone', 'mixed-activity'],
    aiEnabled: true,
    directStandaloneExport: true
  },
  {
    type: 'documentation-tool',
    label: 'Documentation Tool',
    mainLibrary: 'H5P.DocumentationTool 1.8',
    dependencies: [
      'H5P.DocumentationTool',
      'H5P.StandardPage',
      'H5P.GoalsPage',
      'H5P.GoalsAssessmentPage',
      'H5P.DocumentExportPage',
      'H5P.TextInputField',
      'H5P.Text'
    ],
    containers: ['column', 'interactive-book', 'mixed-activity'],
    aiEnabled: true,
    directStandaloneExport: true
  },
  {
    type: 'free-text',
    label: 'Free Text',
    mainLibrary: 'H5P.FreeTextQuestion 1.0',
    dependencies: ['H5P.FreeTextQuestion', 'H5P.CKEditor'],
    containers: [],
    aiEnabled: false
  },
  {
    type: 'open-ended',
    label: 'Open Ended',
    mainLibrary: 'H5P.OpenEndedQuestion 1.0',
    dependencies: ['H5P.OpenEndedQuestion'],
    containers: [],
    aiEnabled: false
  },
  {
    type: 'simple-multi-choice',
    label: 'Simple Multi Choice',
    mainLibrary: 'H5P.SimpleMultiChoice 1.1',
    dependencies: ['H5P.SimpleMultiChoice'],
    containers: [],
    aiEnabled: false
  },
  {
    type: 'dictation',
    label: 'Dictation',
    mainLibrary: 'H5P.Dictation 1.4',
    dependencies: ['H5P.Dictation', 'H5P.Question', 'H5P.Audio', 'H5P.TextUtilities'],
    containers: [],
    aiEnabled: false
  },
  {
    type: 'arithmetic-quiz',
    label: 'Arithmetic Quiz',
    mainLibrary: 'H5P.ArithmeticQuiz 1.1',
    dependencies: ['H5P.ArithmeticQuiz'],
    containers: [],
    aiEnabled: false,
    directStandaloneExport: true
  },
  {
    type: 'question-set',
    label: 'Question Set',
    mainLibrary: 'H5P.QuestionSet 1.20',
    dependencies: ['H5P.QuestionSet', 'H5P.Video'],
    containers: [],
    aiEnabled: false,
    convertible: false
  }
];

export const H5P_TYPE_ADAPTERS = Object.freeze(Object.fromEntries(
  adapterDefinitions.map(definition => [
    definition.type,
    Object.freeze({
      ...definition,
      dependencies: Object.freeze([...definition.dependencies]),
      containers: Object.freeze([...definition.containers]),
      aiEnabled: Boolean(definition.aiEnabled),
      convertible: definition.convertible !== false,
      directStandaloneExport: Boolean(definition.directStandaloneExport)
    })
  ])
));

export function getH5PTypeAdapter(type) {
  return H5P_TYPE_ADAPTERS[type] || null;
}

export function listH5PTypeAdapters({ aiEnabled } = {}) {
  const adapters = Object.values(H5P_TYPE_ADAPTERS);
  if (aiEnabled === undefined) return adapters;
  return adapters.filter(adapter => adapter.aiEnabled === aiEnabled);
}

export function getH5PTypeDependencies(type) {
  return getH5PTypeAdapter(type)?.dependencies || [];
}

export function isH5PTypeAllowedInContainer(type, container) {
  return Boolean(getH5PTypeAdapter(type)?.containers.includes(container));
}

export function getH5PTypesForContainer(container, { aiEnabled = true } = {}) {
  return listH5PTypeAdapters({ aiEnabled })
    .filter(adapter => adapter.containers.includes(container))
    .map(adapter => adapter.type);
}

export function getDirectStandaloneQuestionTypes() {
  return new Set(
    listH5PTypeAdapters()
      .filter(adapter => adapter.directStandaloneExport)
      .map(adapter => adapter.type)
  );
}

export default H5P_TYPE_ADAPTERS;
