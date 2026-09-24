import { randomUUID } from 'node:crypto';

export const QUESTION_MUTATION_LEASE_MS = 60_000;
export const freeQuestionMutation = now => ({ $or: [
  { 'questionMutation.token': { $exists: false } },
  { 'questionMutation.token': null },
  { 'questionMutation.leaseUntil': { $lt: now } }
] });

// A short, single-document mutex bridges edits to Question and the Quiz
// publication list without requiring MongoDB replica-set transactions.
export async function beginQuestionMutation(Quiz, quizId, owner, now = () => new Date()) {
  const token = randomUUID();
  const quiz = await Quiz.findOneAndUpdate({
    _id: quizId, createdBy: owner, ...freeQuestionMutation(now())
  }, {
    $set: { questionMutation: { token, leaseUntil: new Date(+now() + QUESTION_MUTATION_LEASE_MS) }, 'progress.reviewCompleted': false },
    $inc: { questionRevision: 1, __v: 1 }
  }, { new: true });
  if (!quiz) throw Object.assign(new Error('Another question edit is finishing. Please try again.'), { code: 'QUESTION_EDIT_BUSY', status: 409 });
  const expiredError = () => Object.assign(new Error('The question edit lease expired or the learning object changed. Refresh to check the saved result before trying again.'), { code: 'QUESTION_EDIT_EXPIRED', status: 409 });
  // $$NOW is evaluated by MongoDB when the write executes, not when this
  // process first sends it. A delayed request must not reuse an expired lease.
  const activeFilter = () => ({ _id: quizId, createdBy: owner, 'questionMutation.token': token,
    $expr: { $gte: ['$questionMutation.leaseUntil', '$$NOW'] } });
  let expectedVersion = quiz.__v;
  return {
    token,
    quiz,
    async assertActive() {
      if (!await Quiz.exists(activeFilter())) throw expiredError();
    },
    async writeQuiz(update) {
      const updated = await Quiz.findOneAndUpdate({ ...activeFilter(), __v: expectedVersion }, {
        ...update, $inc: { ...update.$inc, questionRevision: 1, __v: 1 }
      }, { new: true });
      if (!updated) throw expiredError();
      expectedVersion = updated.__v;
      return updated;
    },
    async finish() {
      await Quiz.updateOne(activeFilter(), {
        $unset: { questionMutation: '' }, $inc: { questionRevision: 1, __v: 1 }
      });
    }
  };
}

export async function withQuestionMutation(Quiz, quizId, owner, work) {
  const mutation = await beginQuestionMutation(Quiz, quizId, owner);
  try { await mutation.assertActive(); const result = await work(mutation); await mutation.assertActive(); return result; }
  finally { await mutation.finish(); }
}

export function publishedQuestionFilter(quiz) {
  return { quiz: quiz._id, _id: { $in: quiz.questions || [] } };
}
