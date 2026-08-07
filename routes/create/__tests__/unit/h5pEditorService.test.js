import { describe, expect, jest, test } from '@jest/globals';
import {
  buildH5PSourceFingerprint,
  buildLumiSaveResult,
  getH5PSourceUpdatedAt,
  isGeneratedH5PDraftOutdated,
  normalizeEditorPayload,
  saveNativeH5PDocument,
  saveNativeH5PDocumentAndRecord,
  serializeH5PContent
} from '../../services/h5pEditorService.js';

describe('h5pEditorService', () => {
  test('tracks question and Learning Objective edits in the generated H5P source revision', () => {
    const quiz = {
      name: 'Week 1',
      containerMode: 'column',
      updatedAt: new Date('2026-08-01T00:00:00Z'),
      questions: [{
        _id: 'question-1',
        order: 1,
        type: 'multiple-choice',
        questionText: 'Original question',
        content: { options: [] },
        updatedAt: new Date('2026-08-03T00:00:00Z')
      }],
      learningObjectives: [{
        _id: 'objective-1',
        order: 1,
        text: 'Original objective',
        updatedAt: new Date('2026-08-02T00:00:00Z')
      }]
    };
    const fingerprint = buildH5PSourceFingerprint(quiz);

    expect(getH5PSourceUpdatedAt(quiz)).toEqual(new Date('2026-08-03T00:00:00Z'));
    expect(isGeneratedH5PDraftOutdated({ sourceFingerprint: fingerprint }, quiz)).toBe(false);

    quiz.questions[0].questionText = 'Edited question';
    expect(isGeneratedH5PDraftOutdated({ sourceFingerprint: fingerprint }, quiz)).toBe(true);
  });

  test('ignores unrelated Quiz timestamp changes and marks legacy drafts out of date', () => {
    const quiz = {
      name: 'Week 1',
      containerMode: 'column',
      updatedAt: new Date('2026-08-01T00:00:00Z'),
      questions: [],
      learningObjectives: []
    };
    const sourceFingerprint = buildH5PSourceFingerprint(quiz);

    quiz.updatedAt = new Date('2026-08-05T00:00:00Z');
    expect(isGeneratedH5PDraftOutdated({ sourceFingerprint }, quiz)).toBe(false);
    expect(isGeneratedH5PDraftOutdated({ sourceFingerprint: null }, quiz)).toBe(true);
  });

  test('marks a generated draft out of date when the effective H5P target format changes', () => {
    const quiz = {
      name: 'Week 1',
      containerMode: 'column',
      settings: { targetFormat: 'column' },
      questions: [],
      learningObjectives: []
    };
    const sourceFingerprint = buildH5PSourceFingerprint(quiz);

    quiz.settings.targetFormat = 'standalone';
    expect(isGeneratedH5PDraftOutdated({ sourceFingerprint }, quiz)).toBe(true);
  });

  test('normalizes the official editor save payload', () => {
    expect(normalizeEditorPayload({
      library: 'H5P.MultiChoice 1.16',
      params: {
        metadata: { title: '  Week 1 check  ' },
        params: { question: 'What is H5P?' }
      }
    })).toEqual({
      library: 'H5P.MultiChoice 1.16',
      metadata: { title: '  Week 1 check  ' },
      parameters: { question: 'What is H5P?' },
      title: 'Week 1 check'
    });
  });

  test('rejects malformed editor payloads before they reach Lumi', () => {
    expect(() => normalizeEditorPayload({ library: 'H5P.MultiChoice 1.16' }))
      .toThrow('The H5P editor payload is malformed.');
    expect(() => normalizeEditorPayload({
      library: 'H5P.MultiChoice 1.16',
      params: { metadata: [], params: {} }
    })).toThrow('H5P metadata must be an object.');
  });

  test('serializes only the H5P Studio metadata exposed to the client', () => {
    const content = serializeH5PContent({
      _id: { toString: () => 'record-1' },
      owner: 'private-owner',
      lumiContentId: 'content-1',
      title: 'Quiz',
      mainLibrary: 'H5P.Column',
      source: 'generated',
      status: 'draft',
      folder: null,
      quiz: { toString: () => 'quiz-1' },
      sourceQuizUpdatedAt: null,
      lastEditedAt: new Date('2026-08-05T00:00:00Z'),
      createdAt: new Date('2026-08-05T00:00:00Z'),
      updatedAt: new Date('2026-08-05T00:00:00Z')
    });

    expect(content).toMatchObject({
      id: 'record-1',
      contentId: 'content-1',
      quizId: 'quiz-1',
      source: 'generated'
    });
    expect(content).not.toHaveProperty('owner');
  });

  test('builds the response expected by the H5P React save callback', () => {
    const record = {
      _id: { toString: () => 'record-1' },
      lumiContentId: 'content-1',
      title: 'Quiz',
      mainLibrary: 'H5P.Column',
      source: 'editor',
      status: 'draft',
      folder: null,
      quiz: null
    };
    const result = buildLumiSaveResult({ id: 'content-1', metadata: { title: 'Quiz' } }, record);
    expect(result.contentId).toBe('content-1');
    expect(result.metadata.title).toBe('Quiz');
    expect(result.content.id).toBe('record-1');
  });

  test('saves generated native documents through the official Lumi save API', async () => {
    const save = jest.fn().mockResolvedValue({ id: 'native-1', metadata: { title: 'Quiz' } });
    const editor = { saveOrUpdateContentReturnMetaData: save };
    const document = {
      library: 'H5P.Column 1.18',
      metadata: { title: 'Quiz', mainLibrary: 'H5P.Column' },
      parameters: { content: [] }
    };
    const user = { id: 'user-1', name: 'Instructor', type: 'local' };

    await expect(saveNativeH5PDocument(editor, document, user))
      .resolves.toEqual({ id: 'native-1', metadata: { title: 'Quiz' } });
    expect(save).toHaveBeenCalledWith(
      undefined,
      document.parameters,
      document.metadata,
      document.library,
      user
    );
  });

  test('rejects malformed generated documents before calling Lumi', async () => {
    const save = jest.fn();

    await expect(saveNativeH5PDocument(
      { saveOrUpdateContentReturnMetaData: save },
      { library: '', metadata: {}, parameters: {} },
      { id: 'user-1' }
    )).rejects.toMatchObject({ code: 'INVALID_NATIVE_H5P_DOCUMENT' });
    expect(save).not.toHaveBeenCalled();
  });

  test('rolls back Lumi content when the application record cannot be created', async () => {
    const databaseError = new Error('Database unavailable');
    const editor = {
      saveOrUpdateContentReturnMetaData: jest.fn().mockResolvedValue({
        id: 'native-rollback',
        metadata: { title: 'Quiz' }
      }),
      deleteContent: jest.fn().mockResolvedValue(undefined)
    };
    const document = {
      library: 'H5P.Column 1.18',
      metadata: { title: 'Quiz', mainLibrary: 'H5P.Column' },
      parameters: { content: [] }
    };
    const user = { id: 'user-1' };
    const cleanupUser = { id: 'system' };

    await expect(saveNativeH5PDocumentAndRecord({
      editor,
      document,
      user,
      cleanupUser,
      createRecord: jest.fn().mockRejectedValue(databaseError)
    })).rejects.toBe(databaseError);

    expect(editor.deleteContent).toHaveBeenCalledWith('native-rollback', cleanupUser);
  });
});
