import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, test } from '@jest/globals';
import {
  buildNativeH5PDocument,
  convertQuestionToH5P,
  createH5PPackage
} from '../../services/h5pExportService.js';
import { saveNativeH5PDocument } from '../../services/h5pEditorService.js';
import {
  getEditor,
  getSystemUser,
  initializeLumi
} from '../../services/lumiService.js';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

function createQuiz(overrides = {}) {
  return {
    _id: 'quiz-1',
    name: 'Native document test',
    containerMode: 'column',
    chapters: [],
    learningObjectives: [],
    questions: [{
      _id: 'question-1',
      type: 'multiple-choice',
      questionText: 'Which answer is correct?',
      content: {
        options: [
          { text: 'Correct', isCorrect: true },
          { text: 'Incorrect', isCorrect: false }
        ]
      }
    }],
    ...overrides
  };
}

describe('native H5P document pipeline', () => {
  test('builds the root library, metadata, and parameters without a ZIP', async () => {
    const document = await buildNativeH5PDocument(createQuiz());

    expect(document.library).toBe('H5P.Column 1.18');
    expect(document.metadata).toMatchObject({
      title: 'Native document test',
      mainLibrary: 'H5P.Column'
    });
    expect(document.parameters.content).toHaveLength(1);
    expect(document.parameters.content[0].content.library).toBe('H5P.MultiChoice 1.16');
  });

  test('supports a preview container override without mutating the Learning Object', async () => {
    const quiz = createQuiz({ containerMode: 'column' });
    const document = await buildNativeH5PDocument(quiz, { containerMode: 'question-set' });

    expect(document.library).toBe('H5P.QuestionSet 1.20');
    expect(quiz.containerMode).toBe('column');
  });

  test('rejects multiple questions for the Standalone target instead of emitting an invalid Column', async () => {
    const quiz = createQuiz({
      containerMode: 'standalone',
      questions: [
        {
          _id: 'sort-1',
          type: 'sort-paragraphs',
          questionText: 'Sort the first sequence.',
          content: { paragraphs: ['First', 'Second'] }
        },
        {
          _id: 'sort-2',
          type: 'sort-paragraphs',
          questionText: 'Sort the second sequence.',
          content: { paragraphs: ['Alpha', 'Beta'] }
        }
      ]
    });

    await expect(buildNativeH5PDocument(quiz)).rejects.toMatchObject({
      code: 'INVALID_STANDALONE_H5P_SOURCE'
    });
  });

  test('uses a stable non-answer ordering across separate native document builds', async () => {
    const quiz = createQuiz({
      questions: [{
        _id: 'ordering-1',
        type: 'ordering',
        questionText: 'Put these steps in order.',
        content: {
          items: ['First', 'Second', 'Third'],
          correctOrder: ['First', 'Second', 'Third']
        }
      }]
    });

    const first = await buildNativeH5PDocument(quiz);
    const second = await buildNativeH5PDocument(quiz);
    const firstText = first.parameters.content[0].content.params.textField;
    const secondText = second.parameters.content[0].content.params.textField;

    expect(firstText).toBe(secondText);
    expect(firstText).not.toBe('*1*. First\n*2*. Second\n*3*. Third\n');
  });

  test('omits an empty optional media group from native Guess the Answer parameters', async () => {
    const document = await buildNativeH5PDocument(createQuiz({
      questions: [{
        _id: 'guess-1',
        type: 'guess-the-answer',
        questionText: 'Which force balances gravity?',
        content: {
          solutionLabel: 'Reveal answer',
          solutionText: 'The normal force'
        }
      }]
    }));
    const params = document.parameters.content[0].content.params;

    expect(params.taskDescription).toContain('Which force balances gravity?');
    expect(params.solutionText).toBe('The normal force');
    expect(params).not.toHaveProperty('media');
  });

  test('escapes plain authored text before H5P runtimes insert it as HTML', () => {
    const essay = convertQuestionToH5P({
      type: 'essay',
      questionText: 'Explain the result.',
      content: { sampleAnswer: '<img src=x onerror="window.top.hacked=true">' }
    });
    const branching = convertQuestionToH5P({
      type: 'branching-scenario',
      content: {
        introText: 'Start',
        nodes: [
          { index: 0 },
          {
            index: 1,
            question: 'Choose',
            alternatives: [{
              text: '<img src=x onerror="window.top.hacked=true">',
              nextContentId: -1
            }]
          }
        ]
      }
    });
    const guess = convertQuestionToH5P({
      type: 'guess-the-answer',
      questionText: 'Reveal the answer.',
      content: {
        solutionLabel: '<img src=x onerror="window.top.hacked=true">',
        solutionText: 'Safe answer'
      }
    });
    const summaryKeyPoint = convertQuestionToH5P({
      type: 'summary',
      content: {
        keyPoints: [{
          title: '<img src=x onerror="window.top.hacked=true">',
          explanation: 'Safe explanation'
        }]
      }
    });
    const summaryFallback = convertQuestionToH5P({
      type: 'summary',
      explanation: 'Safe summary',
      content: { title: '<img src=x onerror="window.top.hacked=true">' }
    }, { learningObjectives: [] });

    expect(essay.params.solution.sample).toContain('&lt;img');
    expect(branching.params.branchingScenario.content[1]
      .type.params.branchingQuestion.alternatives[0].text).toContain('&lt;img');
    expect(guess.params.solutionLabel).toContain('&lt;img');
    expect(summaryKeyPoint.params.panels[0].title).toContain('&lt;img');
    expect(summaryFallback.params.panels[0].title).toContain('&lt;img');
  });

  test('packages the exact same metadata and parameters returned by the builder', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tlef-native-h5p-'));
    const outputPath = path.join(temporaryDirectory, 'content.h5p');

    try {
      const quiz = createQuiz();
      const document = await buildNativeH5PDocument(quiz);
      await createH5PPackage(quiz, outputPath, { document });

      const archive = new AdmZip(outputPath);
      const packagedMetadata = JSON.parse(archive.readAsText('h5p.json'));
      const packagedParameters = JSON.parse(archive.readAsText('content/content.json'));

      expect(packagedMetadata).toEqual(document.metadata);
      expect(packagedParameters).toEqual(document.parameters);
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('saves and reloads the generated document through Lumi without importing a package', async () => {
    await initializeLumi();
    const editor = getEditor();
    const user = {
      id: 'native-document-author',
      name: 'Native document author',
      email: 'author@example.invalid',
      type: 'local'
    };
    const cleanupUser = getSystemUser();

    const cases = [
      { quiz: createQuiz(), library: 'H5P.Column 1.18' },
      { quiz: createQuiz({ containerMode: 'question-set' }), library: 'H5P.QuestionSet 1.20' },
      { quiz: createQuiz({ containerMode: 'interactive-book' }), library: 'H5P.InteractiveBook 1.11' },
      {
        quiz: createQuiz({
          containerMode: 'standalone',
          questions: [{
            _id: 'sort-1',
            type: 'sort-paragraphs',
            questionText: 'Sort these paragraphs.',
            content: { paragraphs: ['First', 'Second'] }
          }]
        }),
        library: 'H5P.SortParagraphs 0.11'
      },
      {
        quiz: createQuiz({
          questions: [{
            _id: 'flashcard-1',
            type: 'flashcard',
            questionText: 'Front',
            content: { front: 'Front', back: 'Back' }
          }]
        }),
        library: 'H5P.Dialogcards 1.9'
      },
      {
        quiz: createQuiz({
          questions: [{
            _id: 'guess-1',
            type: 'guess-the-answer',
            questionText: 'Which pattern is this?',
            content: {
              solutionLabel: 'Reveal answer',
              solutionText: 'The adapter pattern'
            }
          }]
        }),
        library: 'H5P.Column 1.18'
      }
    ];

    for (const testCase of cases) {
      const document = await buildNativeH5PDocument(testCase.quiz);
      const result = await saveNativeH5PDocument(editor, document, user);

      try {
        const saved = await editor.getContent(result.id, user);
        expect(document.library).toBe(testCase.library);
        expect(saved.library).toBe(document.library);
        expect(JSON.parse(JSON.stringify(saved.params.params)))
          .toEqual(JSON.parse(JSON.stringify(document.parameters)));
        expect(saved.h5p.mainLibrary).toBe(document.metadata.mainLibrary);
      } finally {
        await editor.deleteContent(result.id, cleanupUser);
      }
    }
  });

  test('uses native Dialog Cards parameters for flashcard-only content', async () => {
    const document = await buildNativeH5PDocument(createQuiz({
      questions: [{
        _id: 'flashcard-1',
        type: 'flashcard',
        questionText: 'Front',
        content: { front: 'Front', back: 'Back' }
      }]
    }));

    expect(document.library).toBe('H5P.Dialogcards 1.9');
    expect(document.parameters.dialogs).toHaveLength(1);
    expect(document.parameters).not.toHaveProperty('content');
  });
});
