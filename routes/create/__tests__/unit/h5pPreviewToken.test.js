import { afterEach, describe, expect, test } from '@jest/globals';
import { createH5PPreviewToken, verifyH5PPreviewToken } from '../../utils/h5pPreviewToken.js';

const originalSecret = process.env.H5P_PREVIEW_SIGNING_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.H5P_PREVIEW_SIGNING_SECRET;
  else process.env.H5P_PREVIEW_SIGNING_SECRET = originalSecret;
});

describe('H5P nested preview tokens', () => {
  test('binds a short-lived token to its user, quiz and question', () => {
    process.env.H5P_PREVIEW_SIGNING_SECRET = 'test-secret';
    const token = createH5PPreviewToken(
      { userId: 'user-1', quizId: 'quiz-1', questionId: 'question-1' },
      { now: 1000, ttlSeconds: 60 }
    );

    expect(verifyH5PPreviewToken(token, {
      quizId: 'quiz-1', questionId: 'question-1'
    }, { now: 2000 })).toMatchObject({ userId: 'user-1' });
    expect(verifyH5PPreviewToken(token, { questionId: 'question-2' }, { now: 2000 })).toBeNull();
    expect(verifyH5PPreviewToken(token, {}, { now: 61000 })).toBeNull();
    expect(verifyH5PPreviewToken(`${token.slice(0, -1)}x`, {}, { now: 2000 })).toBeNull();
  });
});
