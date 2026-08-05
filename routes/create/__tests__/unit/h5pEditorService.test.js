import { describe, expect, test } from '@jest/globals';
import {
  buildLumiSaveResult,
  normalizeEditorPayload,
  serializeH5PContent
} from '../../services/h5pEditorService.js';

describe('h5pEditorService', () => {
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
});
