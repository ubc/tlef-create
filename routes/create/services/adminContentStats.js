// These are current saved-content counts, not unmaintained lifetime counters.
export function buildUserContentStats(users, { folders, quizzes, questions }, limit = 50) {
  const index = rows => new Map(rows.filter(row => row._id != null).map(row => [String(row._id), row.count]));
  const counts = { folders: index(folders), quizzes: index(quizzes), questions: index(questions) };
  return users.map(user => ({
    _id: user._id,
    cwlId: user.cwlId,
    coursesCreated: counts.folders.get(String(user._id)) || 0,
    quizzesGenerated: counts.quizzes.get(String(user._id)) || 0,
    questionsCreated: counts.questions.get(String(user._id)) || 0,
    lastLogin: user.lastLogin,
    joinedAt: user.createdAt
  })).sort((a, b) => b.questionsCreated - a.questionsCreated || String(a.cwlId).localeCompare(String(b.cwlId))).slice(0, limit);
}
