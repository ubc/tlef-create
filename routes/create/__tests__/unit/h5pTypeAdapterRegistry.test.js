import { describe, expect, test } from '@jest/globals';
import LIBRARY_REGISTRY, { getNeededLibraries } from '../../config/h5pLibraryRegistry.js';
import {
  getDirectStandaloneQuestionTypes,
  getH5PTypesForContainer,
  getH5PTypeAdapter,
  listH5PTypeAdapters
} from '../../config/h5pTypeAdapterRegistry.js';
import {
  convertQuestionToH5P,
  H5P_QUESTION_ADAPTERS
} from '../../services/h5pExportService.js';

const AI_TYPES = [
  'multiple-choice',
  'true-false',
  'flashcard',
  'summary',
  'discussion',
  'matching',
  'ordering',
  'cloze',
  'mark-the-words',
  'single-choice-set',
  'essay',
  'sort-paragraphs',
  'crossword',
  'branching-scenario',
  'documentation-tool'
];

const fixtures = {
  'multiple-choice': {
    questionText: 'Choose one.',
    content: { options: [{ text: 'Answer', isCorrect: true }] }
  },
  'true-false': { questionText: 'True or false?', correctAnswer: 'true' },
  flashcard: { questionText: 'Front', content: { front: 'Front', back: 'Back' } },
  summary: {
    questionText: 'Summarize.',
    content: { keyPoints: [{ title: 'Point', explanation: 'Explanation' }] }
  },
  discussion: { questionText: 'Discuss this topic.' },
  matching: {
    questionText: 'Match the pairs.',
    content: { leftItems: ['A'], rightItems: ['B'], matchingPairs: [['A', 'B']] }
  },
  ordering: {
    questionText: 'Order the steps.',
    content: { items: ['First', 'Second'], correctOrder: ['First', 'Second'] }
  },
  cloze: {
    questionText: 'Complete $$',
    content: { textWithBlanks: 'Complete $$', correctAnswers: ['this'], blankOptions: [] }
  },
  'mark-the-words': {
    questionText: 'Mark the word.',
    content: { text: 'Mark *this* word.' }
  },
  'single-choice-set': {
    questionText: 'Choose one.',
    content: { questions: [{ question: 'Question', answers: ['Correct', 'Wrong'] }] }
  },
  essay: {
    questionText: 'Explain.',
    content: { sampleAnswer: 'Example', keywords: [] }
  },
  'sort-paragraphs': {
    questionText: 'Sort these paragraphs.',
    content: { paragraphs: ['First', 'Second'] }
  },
  crossword: {
    questionText: 'Complete the crossword.',
    content: { words: [{ answer: 'TEST', clue: 'A trial' }, { answer: 'SET', clue: 'A collection' }] }
  },
  'branching-scenario': {
    questionText: 'Choose a path.',
    content: { introText: 'Start', nodes: [] }
  },
  'documentation-tool': {
    questionText: 'Document your work.',
    content: { title: 'Project reflection', pages: [] }
  }
};

describe('H5P type adapter registry', () => {
  test('registers every AI-enabled CREATE question type once', () => {
    expect(listH5PTypeAdapters({ aiEnabled: true }).map(adapter => adapter.type))
      .toEqual(AI_TYPES);
    expect(new Set(AI_TYPES).size).toBe(AI_TYPES.length);
  });

  test.each(AI_TYPES)('%s has a converter that emits its declared native library', type => {
    const metadata = getH5PTypeAdapter(type);
    const adapter = H5P_QUESTION_ADAPTERS[type];
    const question = { type, ...fixtures[type] };
    const result = adapter.toH5P(question, { learningObjectives: [] });

    expect(metadata.aiEnabled).toBe(true);
    expect(adapter.toH5P).toEqual(expect.any(Function));
    expect(result.library).toBe(metadata.mainLibrary);
    expect(convertQuestionToH5P(question, { learningObjectives: [] }).library)
      .toBe(metadata.mainLibrary);
  });

  test('keeps dependency declarations resolvable by the vendored library registry', () => {
    for (const adapter of listH5PTypeAdapters()) {
      for (const dependency of adapter.dependencies) {
        expect(LIBRARY_REGISTRY[dependency]).toBeDefined();
      }
    }
  });

  test('derives package dependencies from adapter metadata', () => {
    const dependencies = getNeededLibraries(new Set(['matching', 'summary']));

    expect(dependencies).toBeInstanceOf(Set);
    expect([...dependencies]).toEqual(expect.arrayContaining([
      'H5P.DragText',
      'H5P.Question',
      'jQuery.ui',
      'H5P.TextUtilities',
      'H5P.Accordion',
      'H5P.AdvancedText'
    ]));
  });

  test('keeps backend container capabilities aligned with the CREATE matrix', () => {
    expect(getH5PTypesForContainer('question-set')).toEqual([
      'multiple-choice',
      'true-false',
      'cloze',
      'mark-the-words',
      'essay'
    ]);
    expect(getH5PTypesForContainer('standalone')).toEqual([
      'sort-paragraphs',
      'crossword',
      'branching-scenario'
    ]);
  });

  test('preserves the existing direct standalone package behavior', () => {
    expect([...getDirectStandaloneQuestionTypes()]).toEqual([
      'mark-the-words',
      'essay',
      'sort-paragraphs',
      'crossword',
      'branching-scenario',
      'documentation-tool',
      'arithmetic-quiz'
    ]);
  });

  test('returns null for unknown and container-only types', () => {
    expect(convertQuestionToH5P({ type: 'unknown' })).toBeNull();
    expect(convertQuestionToH5P({ type: 'question-set' })).toBeNull();
  });
});
