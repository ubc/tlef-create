import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, test } from '@jest/globals';
import {
  buildNativeH5PDocument,
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
