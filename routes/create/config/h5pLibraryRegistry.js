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

  return needed;
}

export default LIBRARY_REGISTRY;
