// Detailed, instructor-owned diagnostics. Privacy-limited job receipts keep only
// the safe failure code; no prompt, source excerpt or provider payload is copied.
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
const percent = value => `${(value * 100).toFixed(2)}%`;

function checkDiagnostic(similarity, threshold, closest) {
  const result = {};
  if (score(similarity) !== undefined) result.similarity = similarity;
  if (score(threshold) !== undefined) result.threshold = threshold;
  // The two checks can have different closest questions. Missing identities
  // stay unknown; never borrow the other check's closest question.
  if (typeof closest?.questionId === 'string') result.questionId = text(closest.questionId, 120);
  if (typeof closest?.questionText === 'string') result.questionText = text(closest.questionText, 240);
  return Object.keys(result).length ? result : undefined;
}

function checkIssue(label, check) {
  if (!check || check.similarity === undefined) return null;
  const comparison = check.threshold === undefined ? ' (threshold not recorded)'
    : ` ${check.similarity >= check.threshold ? 'meets or exceeds' : 'is below'} the ${percent(check.threshold)} rejection threshold`;
  const closest = check.questionText
    ? ` Closest ${label.toLowerCase()} question${check.questionId ? ` (${check.questionId})` : ''}: ${check.questionText}`
    : ' Closest question identity was not recorded.';
  return `${label} similarity ${percent(check.similarity)}${comparison}.${closest}`;
}

export function buildRejectedNoveltyDraft({ question = {}, candidate, result }) {
  if (result?.novel !== false) return undefined;
  const novelty = {};
  if (['lexical', 'lexical-and-semantic'].includes(result.method)) novelty.method = result.method;
  for (const key of ['similarity', 'noveltyScore']) {
    if (score(result[key]) !== undefined) novelty[key] = result[key];
  }
  novelty.lexical = checkDiagnostic(result.lexicalSimilarity, result.threshold, result.lexicalClosest);
  if (result.method === 'lexical-and-semantic') {
    novelty.semantic = checkDiagnostic(result.semanticSimilarity, result.semanticThreshold, result.semanticClosest);
  }
  const issues = [checkIssue('Lexical', novelty.lexical), checkIssue('Semantic', novelty.semantic)].filter(Boolean);
  if (!issues.length) issues.push(novelty.similarity === undefined
    ? 'The application rejected this draft as too similar; detailed scores were not recorded.'
    : `The application recorded ${percent(novelty.similarity)} similarity; separate lexical and semantic details were not recorded.`);
  issues.push('Application duplicate check: this similarity signal does not prove that the questions assess the same learning task. Review the two tasks and their approved instructions before choosing a revision.');
  const options = Array.isArray(question.content?.options) ? question.content.options
    : Array.isArray(question.options) ? question.options : [];
  return {
    questionText: text(candidate, 4000) || text(question.questionText, 4000),
    correctAnswer: text(question.correctAnswer, 2000),
    options: options.slice(0, 20).map(option => ({ text: text(option?.text, 500), isCorrect: option?.isCorrect === true })),
    issues,
    novelty
  };
}
