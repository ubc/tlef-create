/**
 * H5P Library Registry — maps machineName to version info and directory name.
 * Used by createH5PPackage to selectively include only needed library directories.
 */
const LIBRARY_REGISTRY = {
  'FontAwesome':        { majorVersion: 4, minorVersion: 5, dirName: 'FontAwesome-4.5' },
  'H5P.FontIcons':      { majorVersion: 1, minorVersion: 0, dirName: 'H5P.FontIcons-1.0' },
  'H5P.Transition':     { majorVersion: 1, minorVersion: 0, dirName: 'H5P.Transition-1.0' },
  'H5P.JoubelUI':       { majorVersion: 1, minorVersion: 3, dirName: 'H5P.JoubelUI-1.3' },
  'H5P.Column':         { majorVersion: 1, minorVersion: 18, dirName: 'H5P.Column-1.18' },
  'H5P.Question':       { majorVersion: 1, minorVersion: 5, dirName: 'H5P.Question-1.5' },
  'H5P.Audio':          { majorVersion: 1, minorVersion: 5, dirName: 'H5P.Audio-1.5' },
  'H5P.Video':          { majorVersion: 1, minorVersion: 6, dirName: 'H5P.Video-1.6' },
  'jQuery.ui':          { majorVersion: 1, minorVersion: 10, dirName: 'jQuery.ui-1.10' },
  'H5P.Dialogcards':    { majorVersion: 1, minorVersion: 9, dirName: 'H5P.Dialogcards-1.9' },
  'H5P.MultiChoice':    { majorVersion: 1, minorVersion: 16, dirName: 'H5P.MultiChoice-1.16' },
  'H5P.TrueFalse':      { majorVersion: 1, minorVersion: 8, dirName: 'H5P.TrueFalse-1.8' },
  'H5P.DragText':       { majorVersion: 1, minorVersion: 10, dirName: 'H5P.DragText-1.10' },
  'H5P.Blanks':         { majorVersion: 1, minorVersion: 14, dirName: 'H5P.Blanks-1.14' },
  'H5P.Accordion':      { majorVersion: 1, minorVersion: 0, dirName: 'H5P.Accordion-1.0' },
  'H5P.AdvancedText':   { majorVersion: 1, minorVersion: 1, dirName: 'H5P.AdvancedText-1.1' },
  'H5P.SortParagraphs': { majorVersion: 0, minorVersion: 11, dirName: 'H5P.SortParagraphs-0.11' },
  'H5P.SingleChoiceSet':{ majorVersion: 1, minorVersion: 11, dirName: 'H5P.SingleChoiceSet-1.11' },
  'H5P.QuestionSet':    { majorVersion: 1, minorVersion: 20, dirName: 'H5P.QuestionSet-1.20' },
  'H5P.TextUtilities':  { majorVersion: 1, minorVersion: 3, dirName: 'H5P.TextUtilities-1.3' },
  'H5P.MarkTheWords':   { majorVersion: 1, minorVersion: 11, dirName: 'H5P.MarkTheWords-1.11' },
  'H5P.Essay':          { majorVersion: 1, minorVersion: 5, dirName: 'H5P.Essay-1.5' },
  'H5P.FreeTextQuestion': { majorVersion: 1, minorVersion: 0, dirName: 'H5P.FreeTextQuestion-1.0' },
  'H5P.OpenEndedQuestion': { majorVersion: 1, minorVersion: 0, dirName: 'H5P.OpenEndedQuestion-1.0' },
  'H5P.SimpleMultiChoice': { majorVersion: 1, minorVersion: 1, dirName: 'H5P.SimpleMultiChoice-1.1' },
  'H5P.CKEditor':       { majorVersion: 1, minorVersion: 0, dirName: 'H5P.CKEditor-1.0' },
  'H5P.Crossword':      { majorVersion: 0, minorVersion: 5, dirName: 'H5P.Crossword-0.5' },
  'H5P.Components':     { majorVersion: 1, minorVersion: 0, dirName: 'H5P.Components-1.0' },
  'H5P.Dictation':      { majorVersion: 1, minorVersion: 4, dirName: 'H5P.Dictation-1.4' },
  'H5P.ArithmeticQuiz': { majorVersion: 1, minorVersion: 1, dirName: 'H5P.ArithmeticQuiz-1.1' },
  'H5P.BranchingScenario': { majorVersion: 1, minorVersion: 10, dirName: 'H5P.BranchingScenario-1.10' },
  'H5P.BranchingQuestion': { majorVersion: 1, minorVersion: 0, dirName: 'H5P.BranchingQuestion-1.0' },
  'H5P.Image':          { majorVersion: 1, minorVersion: 1, dirName: 'H5P.Image-1.1' },
  'Drop':               { majorVersion: 1, minorVersion: 0, dirName: 'Drop-1.0' },
  'Tether':             { majorVersion: 1, minorVersion: 0, dirName: 'Tether-1.0' },
  'H5P.MaterialDesignIcons': { majorVersion: 1, minorVersion: 0, dirName: 'H5P.MaterialDesignIcons-1.0' },
};

/**
 * Determine which H5P libraries are needed based on question types.
 * @param {Set<string>} questionTypes - Set of question type strings
 * @param {Object} flags - { hasMixedContent, isFlashcardOnly }
 * @returns {Set<string>} Set of library machine names needed
 */
export function getNeededLibraries(questionTypes, flags = {}) {
  const needed = new Set([
    'FontAwesome', 'H5P.FontIcons', 'H5P.Transition', 'H5P.JoubelUI'
  ]);

  if (flags.hasMixedContent || !flags.isFlashcardOnly) {
    needed.add('H5P.Column');
  }

  if (questionTypes.has('flashcard')) {
    needed.add('H5P.Dialogcards');
    needed.add('H5P.Audio');
  }
  if (questionTypes.has('multiple-choice')) {
    needed.add('H5P.MultiChoice');
    needed.add('H5P.Question');
  }
  if (questionTypes.has('true-false')) {
    needed.add('H5P.TrueFalse');
    needed.add('H5P.Question');
  }
  if (questionTypes.has('ordering') || questionTypes.has('matching')) {
    needed.add('H5P.DragText');
    needed.add('H5P.Question');
    needed.add('jQuery.ui');
    needed.add('H5P.TextUtilities');
  }
  if (questionTypes.has('cloze')) {
    needed.add('H5P.Blanks');
    needed.add('H5P.Question');
    needed.add('H5P.TextUtilities');
  }
  if (questionTypes.has('summary')) {
    needed.add('H5P.Accordion');
    needed.add('H5P.AdvancedText');
  }
  if (questionTypes.has('discussion')) {
    needed.add('H5P.AdvancedText');
  }
  if (questionTypes.has('mark-the-words')) {
    needed.add('H5P.MarkTheWords');
    needed.add('H5P.Question');
  }
  if (questionTypes.has('single-choice-set')) {
    needed.add('H5P.SingleChoiceSet');
    needed.add('H5P.Question');
    needed.add('H5P.Transition');
  }
  if (questionTypes.has('essay')) {
    needed.add('H5P.Essay');
    needed.add('H5P.Question');
    needed.add('H5P.TextUtilities');
  }
  if (questionTypes.has('question-set')) {
    needed.add('H5P.QuestionSet');
    needed.add('H5P.Video');
  }
  if (questionTypes.has('free-text')) {
    needed.add('H5P.FreeTextQuestion');
    needed.add('H5P.CKEditor');
  }
  if (questionTypes.has('open-ended')) {
    needed.add('H5P.OpenEndedQuestion');
  }
  if (questionTypes.has('simple-multi-choice')) {
    needed.add('H5P.SimpleMultiChoice');
  }
  if (questionTypes.has('sort-paragraphs')) {
    needed.add('H5P.SortParagraphs');
    needed.add('H5P.Question');
  }
  if (questionTypes.has('crossword')) {
    needed.add('H5P.Crossword');
    needed.add('H5P.Question');
    needed.add('H5P.Image');
    needed.add('H5P.MaterialDesignIcons');
    needed.add('jQuery.ui');
  }
  if (questionTypes.has('dictation')) {
    needed.add('H5P.Dictation');
    needed.add('H5P.Question');
    needed.add('H5P.Audio');
    needed.add('H5P.TextUtilities');
  }
  if (questionTypes.has('arithmetic-quiz')) {
    needed.add('H5P.ArithmeticQuiz');
  }
  if (questionTypes.has('branching-scenario')) {
    needed.add('H5P.BranchingScenario');
    needed.add('H5P.BranchingQuestion');
    needed.add('H5P.AdvancedText');
  }

  return needed;
}

export default LIBRARY_REGISTRY;
