import { expect, test } from '@jest/globals';
import { nativeReviewFailureMessage } from '../../services/authoring/nativeReviewFailureMessage.js';

test.each(['INSTRUCTION_MISMATCH', 'ANSWER_INVALID', 'EVIDENCE_INSUFFICIENT', 'REVIEW_UNAVAILABLE', 'REVIEW_INVALID_RESPONSE', 'REVIEW_LIMIT_REACHED'])(
  'known native review failure %s has an activity diagnosis without exposing raw provider details', reason => {
    const message = nativeReviewFailureMessage({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: reason,
      message: 'PRIVATE_PROVIDER_MESSAGE', rejectedDraft: { issues: ['PRIVATE_REVIEW_PROSE'] } });
    expect(message).toContain('Activity check stopped:');
    expect(message).toContain('saved draft is preserved');
    expect(message).not.toMatch(/PRIVATE_|model configuration|No question was saved/);
    if (reason === 'INSTRUCTION_MISMATCH') expect(message).toContain('did not meet the teaching requirements');
    if (reason === 'REVIEW_LIMIT_REACHED') expect(message).toContain('rate limit or usage allowance');
  });

test('unknown reasons use an application-owned quality diagnosis and never echo the reason or message', () => {
  expect(nativeReviewFailureMessage({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'PRIVATE_REASON', message: 'PRIVATE_PROVIDER_MESSAGE' }))
    .toContain('The activity did not pass its quality check.');
  expect(nativeReviewFailureMessage({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'PRIVATE_REASON', message: 'PRIVATE_PROVIDER_MESSAGE' }))
    .not.toContain('PRIVATE_');
});

test('untyped and unrelated errors remain subject to the existing safe masking policy', () => {
  expect(nativeReviewFailureMessage(new Error('PRIVATE_PROVIDER_MESSAGE'))).toBeNull();
  expect(nativeReviewFailureMessage({ code: 'UNKNOWN_PROVIDER_ERROR', message: 'PRIVATE_PROVIDER_MESSAGE' })).toBeNull();
});
