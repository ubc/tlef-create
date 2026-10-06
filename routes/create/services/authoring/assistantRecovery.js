// Recovery decisions are based on owned saved state, not model-generated diagnoses.
export function canReviseAssistantPlan(assistant) {
  return assistant?.status === 'objectives_ready' || assistant?.status === 'awaiting_approval' ||
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
  const ready = generation.readyCount ?? generation.completedQuestions ?? 0;
  const groups = new Map();
  for (const item of failed) {
    const failure = item.failure;
    const key = failure ? JSON.stringify([failure.code, failure.stage, failure.message, failure.recovery]) : `legacy:${item.code || ''}:${item.message || ''}`;
    const group = groups.get(key) || { failure, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  return [
    generation.published
      ? `${ready} of ${generation.totalQuestions} checked questions are saved and available in Question set preview. ${failed.length} questions still need attention after automatic rework.`
      : `${failed.length} of ${generation.totalQuestions} questions need attention. ${ready ? `${ready} prepared questions are retained and available in Question set preview.` : 'No questions were prepared.'}`,
    ...[...groups.values()].map(group => group.failure
      ? `${group.count} ${group.count === 1 ? 'question' : 'questions'} · ${group.failure.stage}: ${group.failure.message}\nNext step: ${group.failure.recovery}\nError code: ${group.failure.code}`
      : `${group.count} ${group.count === 1 ? 'question needs' : 'questions need'} attention. No detailed failure reason was saved.`),
    failed.some(item => item.review)
      ? 'Expand Questions needing attention to inspect the rejected drafts and review observations. An AI review flag is not a proof of correctness.'
      : 'No detailed review observations were saved for these failed questions.',
    'Would you like to keep this plan and retry the unfinished questions, or revise the teaching plan first? Tell me the audience, difficulty, question count, or constraints you want to change. You can also edit the question instructions in Teaching plan.',
    'Choose Resume task to explicitly retry the unchanged batch using additional AI credits. A revised plan needs your approval before any new questions are generated.'
  ].join('\n\n');
}
