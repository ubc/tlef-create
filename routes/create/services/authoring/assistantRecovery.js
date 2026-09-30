// Recovery decisions are based on owned saved state, not model-generated diagnoses.
export function canReviseAssistantPlan(assistant) {
  return assistant?.status === 'awaiting_approval' ||
    (assistant?.status === 'failed' && assistant.phase === 'generating'
      && assistant.errorCode === 'ASSISTANT_QUESTION_BATCH_FAILED');
}

export function assistantQuestionRows(assistant) {
  return (assistant?.plan || []).flatMap(row => Array.from({ length: row.count }, () => row));
}

export function assistantRecoveryMessage(assistant) {
  const generation = assistant?.generation;
  const failed = generation?.items?.filter(item => item.status === 'failed') || [];
  if (!failed.length) return 'This step could not finish. Would you like to review the saved teaching plan and instructions, or retry the task? A retry may use additional AI credits.';
  const rows = assistantQuestionRows(assistant);
  const ready = generation.readyCount ?? generation.completedQuestions ?? 0;
  return [
    `${failed.length} of ${generation.totalQuestions} questions need attention. ${ready} prepared questions are retained, but no questions from this batch have been added to the course.`,
    ...failed.map(item => `Question ${item.index + 1}${rows[item.index]?.title ? ` (${rows[item.index].title})` : ''}: ${item.message || 'This draft did not pass its checks.'}`),
    failed.some(item => item.review)
      ? 'Expand Questions needing attention to inspect the rejected drafts and review observations. An AI review flag is not a proof of correctness.'
      : 'A review flag is not proof that the reviewer is correct. This older attempt did not save the rejected drafts or detailed review explanations.',
    'Would you like to keep this plan and retry the unfinished questions, or revise the teaching plan first? Tell me the audience, difficulty, question count, or constraints you want to change. You can also edit the question instructions in Teaching plan.',
    'Choose Resume task to explicitly retry the unchanged batch using additional AI credits. A revised plan needs your approval before any new questions are generated.'
  ].join('\n\n');
}
