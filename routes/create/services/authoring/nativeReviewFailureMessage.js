const qualityMessages = {
  INSTRUCTION_MISMATCH: 'The activity did not meet the teaching requirements.',
  ANSWER_INVALID: 'The activity content or saved answers were flagged as incorrect or ambiguous.',
  RUBRIC_INVALID: 'The assessment criteria did not match the teaching task.',
  FEEDBACK_INVALID: 'The feedback did not agree with the activity and its saved answers.',
  EVIDENCE_INSUFFICIENT: 'The supplied evidence did not support the activity.',
  REVIEW_INPUT_LIMIT: 'The activity exceeded the supported check size.',
  REVIEW_INVALID_RESPONSE: 'The activity checker returned an incomplete or unreadable result.',
  REVIEW_UNAVAILABLE: 'The activity check service could not finish.',
  REVIEW_LIMIT_REACHED: 'The activity check reached an AI rate limit or usage allowance.',
  ARITHMETIC_INVALID_SCHEMA: 'The activity check omitted required calculation details.',
  ARITHMETIC_FALSE_EQUALITY: 'An activity calculation did not match its claimed result.',
  ARITHMETIC_DIVISION_BY_ZERO: 'An activity calculation divided by zero.',
  ARITHMETIC_UNSUPPORTED_EXPRESSION: 'An activity calculation could not be verified.',
  FEEDBACK_TEXT_LIMIT: 'The feedback exceeded the supported check size.'
};

// Only the application-owned review code selects this diagnosis. Provider
// messages and reviewer prose never become the task's public error message.
export function nativeReviewFailureMessage(error) {
  if (error?.code !== 'QUESTION_QUALITY_REVIEW') return null;
  const reason = error.qualityFailureReason;
  const message = Object.hasOwn(qualityMessages, reason) ? qualityMessages[reason] : 'The activity did not pass its quality check.';
  const recovery = ['REVIEW_UNAVAILABLE', 'REVIEW_LIMIT_REACHED', 'REVIEW_INVALID_RESPONSE'].includes(reason)
    ? 'Check the review service or allowance before explicitly resuming the task.'
    : 'Review the saved AI check observations and refine the requirements or evidence before retrying.';
  return `Activity check stopped: ${message} Your saved draft is preserved. ${recovery}`;
}
