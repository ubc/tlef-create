export const QUESTION_FAILURE_STAGES = ['preparation', 'evidence', 'generation', 'review', 'saving'];

const reviews = {
  REVIEW_UNAVAILABLE: 'The question review service could not finish. No unchecked question was published.',
  REVIEW_LIMIT_REACHED: 'The question review reached an AI rate limit or usage allowance. No unchecked question was published. Check the provider allowance or wait before explicitly retrying.',
  REVIEW_INVALID_RESPONSE: 'The question review returned an incomplete or unreadable result.',
  ANSWER_INVALID: 'The answer key or question was flagged as incorrect or ambiguous. Review its evidence and wording.',
  INSTRUCTION_MISMATCH: 'The draft did not follow the instructions for this question. Review its topic and constraints.',
  FEEDBACK_INVALID: 'The feedback did not agree with the task and saved answers or was incomplete.',
  RUBRIC_INVALID: 'The reference response or assessment criteria did not match the teaching task.',
  EVIDENCE_INSUFFICIENT: 'The supplied evidence did not support the draft. Review the sources or clarify the missing information before retrying.',
  REVIEW_INPUT_LIMIT: 'The draft exceeded the supported semantic review size. Refine its scope before retrying.',
  ARITHMETIC_INVALID_SCHEMA: 'The question review omitted required calculation details.',
  ARITHMETIC_FALSE_EQUALITY: 'A feedback calculation produced an incorrect result.',
  ARITHMETIC_DIVISION_BY_ZERO: 'A feedback calculation divided by zero.',
  ARITHMETIC_UNSUPPORTED_EXPRESSION: 'A feedback calculation used an expression that could not be verified.',
  FEEDBACK_TEXT_LIMIT: 'The reviewed feedback exceeded the supported text length.'
};
const diagnoses = {
  H5P_ASSISTANT_INVALID_TASK_PLAN: { stage: 'evidence', message: 'This planned question refers to missing or unapproved source evidence. Question generation did not start.', recovery: 'Review the question’s planned focus and selected sources, then save an updated teaching plan.', retryable: false },
  QUESTION_EVIDENCE_SCOPE: { stage: 'evidence', message: 'The retrieved evidence did not match the approved material scope. This item was stopped before using that evidence.', recovery: 'Check the selected material scope and refresh the teaching plan before continuing.', retryable: false },
  MATERIAL_INDEX_MISSING: { stage: 'evidence', message: 'A selected material has no searchable evidence in the current embedding index. Question generation and review did not start.', recovery: 'Choose Restore material search, then Resume task to continue with the approved plan.', retryable: true },
  MATERIAL_RETRIEVAL_UNAVAILABLE: { stage: 'evidence', message: 'The material retrieval service could not read the selected evidence.', recovery: 'Restore the retrieval service, then explicitly retry the unfinished questions.', retryable: true },
  MATERIAL_EVIDENCE_NOT_FOUND: { stage: 'evidence', message: 'No relevant evidence was found in the selected materials for this question.', recovery: 'Review the selected sources and question scope before explicitly retrying.', retryable: true },
  MATERIAL_EMBEDDING_UNAVAILABLE: { stage: 'evidence', message: 'The embedding service could not prepare the material search.', recovery: 'Restore the embedding service, then explicitly retry the unfinished questions.', retryable: true },
  EMBEDDING_AUTH_FAILED: { stage: 'evidence', message: 'The embedding service rejected its configured credentials.', recovery: 'Ask the administrator to correct the embedding service credentials, then explicitly retry.', retryable: true },
  QUESTION_DUPLICATE_DETECTED: { stage: 'review', fixedStage: true, message: 'The generated question was rejected by the application’s duplicate check because it was too similar to another question in this batch or learning object.', recovery: 'Review the question focus and choose a different fact, subpoint or reasoning step while keeping the approved topic and exclusions. Approve any plan changes before explicitly retrying.', retryable: true },
  QUESTION_PLANNED_SLICE_MISMATCH: { stage: 'review', fixedStage: true, message: 'The generated question did not match its assigned planned slice. The application’s coverage check rejected it.', recovery: 'Review the assigned slice and this question’s instructions. Approve any plan changes before explicitly retrying.', retryable: true },
  QUESTION_INVALID_RESPONSE: { stage: 'generation', message: 'The model returned an unreadable or invalid question. No question was saved. An explicit retry generates a new draft using additional AI credits.', recovery: 'Review the question instructions, then explicitly retry using additional AI credits.', retryable: true },
  MODEL_SERVICE_LIMIT_REACHED: { stage: 'generation', message: 'The AI service reached a rate limit or usage allowance. Check the provider allowance or wait before explicitly retrying. No fallback generation was started.', recovery: 'Check the provider allowance or wait before explicitly retrying.', retryable: true },
  GENERATION_TIMEOUT: { stage: 'generation', message: 'This question exceeded its generation deadline. This item was not published.', recovery: 'Check the saved task status before explicitly retrying; a retry may use additional AI credits.', retryable: true },
  QUESTION_QUALITY_REVIEW: { stage: 'review', message: 'This question did not pass its quality check.', recovery: 'Inspect the saved review observations and refine the instructions before explicitly retrying.', retryable: true },
  NO_API_KEY: { stage: 'preparation', message: 'An AI API key is required before generating questions.', recovery: 'Configure an authorized AI API key, then explicitly retry.', retryable: true },
  MATERIALS_NOT_READY: { stage: 'evidence', message: 'Assigned materials are not ready for question generation.', recovery: 'Wait for the selected materials to finish processing or restore their processing, then explicitly retry.', retryable: true },
  QUESTION_TYPE_UNAVAILABLE: { stage: 'preparation', message: 'The selected question type is temporarily unavailable.', recovery: 'Choose an available question type in the teaching plan and approve the revised plan.', retryable: true },
  GENERATION_INTERRUPTED: { stage: 'generation', message: 'Generation was interrupted. Your previous questions are unchanged. CREATE will not automatically spend more AI credits.', recovery: 'Check the saved progress before explicitly choosing Resume task.', retryable: true },
  GENERATION_OUTCOME_UNCONFIRMED: { stage: 'saving', message: 'The question save could not be confirmed.', recovery: 'Check the saved task status before starting another attempt to avoid duplicate work.', retryable: false },
  QUESTION_SAVE_FAILED: { stage: 'saving', message: 'The question could not be saved.', recovery: 'Restore database access and check the saved task status before explicitly retrying.', retryable: true },
  QUESTION_GENERATION_FAILED: { stage: 'preparation', message: 'This question could not be completed. No detailed failure reason was saved.', recovery: 'Check the instructions and service status before explicitly retrying.', retryable: true }
};

// Only application-owned diagnoses cross receipt/API boundaries. Never persist
// provider messages, prompts, source text, stack traces or model review prose.
export function safeQuestionFailure(error, stage) {
  const code = Object.hasOwn(diagnoses, error?.code) ? error.code : 'QUESTION_GENERATION_FAILED';
  const reason = code === 'QUESTION_QUALITY_REVIEW' && Object.hasOwn(reviews, error?.qualityFailureReason)
    ? error.qualityFailureReason : undefined;
  const diagnosis = diagnoses[code];
  const failure = { code, stage: reason || diagnosis.fixedStage ? 'review' : (QUESTION_FAILURE_STAGES.includes(stage) ? stage : diagnosis.stage),
    message: reason ? reviews[reason] : diagnosis.message, recovery: diagnosis.recovery, retryable: diagnosis.retryable };
  if (reason === 'EVIDENCE_INSUFFICIENT') failure.recovery = 'Review or supplement the evidence and clarify the missing information before explicitly retrying.';
  return { code, ...(reason ? { reason } : {}), message: failure.message, failure };
}

export function savedQuestionFailure(item) {
  if (item.status !== 'failed') return undefined;
  // Older generic receipts have no evidence about their actual failure stage.
  if (!item.failure && (!item.code || item.code === 'QUESTION_GENERATION_FAILED')) return undefined;
  return safeQuestionFailure({ code: item.code, qualityFailureReason: item.reason }, item.failure?.stage).failure;
}
