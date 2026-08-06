import { getH5PTypeDependencies } from './h5pTypeAdapterRegistry.js';

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
  'H5P.InteractiveBook': { majorVersion: 1, minorVersion: 11, dirName: 'H5P.InteractiveBook-1.11' },
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
  'H5P.DocumentationTool': { majorVersion: 1, minorVersion: 8, dirName: 'H5P.DocumentationTool-1.8' },
  'H5P.StandardPage':      { majorVersion: 1, minorVersion: 5, dirName: 'H5P.StandardPage-1.5' },
  'H5P.GoalsPage':         { majorVersion: 1, minorVersion: 5, dirName: 'H5P.GoalsPage-1.5' },
  'H5P.GoalsAssessmentPage': { majorVersion: 1, minorVersion: 4, dirName: 'H5P.GoalsAssessmentPage-1.4' },
  'H5P.DocumentExportPage': { majorVersion: 1, minorVersion: 5, dirName: 'H5P.DocumentExportPage-1.5' },
  'H5P.TextInputField':    { majorVersion: 1, minorVersion: 2, dirName: 'H5P.TextInputField-1.2' },
  'H5P.Text':              { majorVersion: 1, minorVersion: 1, dirName: 'H5P.Text-1.1' },
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

  for (const questionType of questionTypes) {
    for (const dependency of getH5PTypeDependencies(questionType)) {
      needed.add(dependency);
    }
  }

  return needed;
}

export default LIBRARY_REGISTRY;
