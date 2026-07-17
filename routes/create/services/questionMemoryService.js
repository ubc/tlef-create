const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'these', 'this', 'to', 'was',
  'what', 'when', 'where', 'which', 'who', 'why', 'with'
]);

const BOILERPLATE_PATTERNS = [
  /which of the following/gi,
  /select all that apply/gi,
  /choose the (best|correct) answer/gi,
  /true or false/gi
];

export function normalizeQuestionText(value = '') {
  return BOILERPLATE_PATTERNS
    .reduce((text, pattern) => text.replace(pattern, ' '), String(value))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensFor(value) {
  return normalizeQuestionText(value)
    .split(' ')
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function bigramsFor(tokens) {
  if (tokens.length < 2) return tokens;
  return tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`);
}

function setOverlap(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (!leftSet.size || !rightSet.size) return { jaccard: 0, containment: 0 };

  const intersection = [...leftSet].filter(value => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return {
    jaccard: intersection / union,
    containment: intersection / Math.min(leftSet.size, rightSet.size)
  };
}

export function calculateQuestionSimilarity(left, right) {
  const normalizedLeft = normalizeQuestionText(left);
  const normalizedRight = normalizeQuestionText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftTokens = tokensFor(normalizedLeft);
  const rightTokens = tokensFor(normalizedRight);
  const tokenOverlap = setOverlap(leftTokens, rightTokens);
  const bigramOverlap = setOverlap(bigramsFor(leftTokens), bigramsFor(rightTokens));

  return Number((
    tokenOverlap.jaccard * 0.4
    + tokenOverlap.containment * 0.4
    + bigramOverlap.jaccard * 0.2
  ).toFixed(4));
}

export function findMostSimilarQuestion(candidate, questions = []) {
  return questions.reduce((best, question) => {
    const questionText = question.questionText || question.text || '';
    const similarity = calculateQuestionSimilarity(candidate, questionText);
    return similarity > best.similarity
      ? {
          similarity,
          questionId: question._id?.toString?.() || question.id || question.questionId,
          questionText
        }
      : best;
  }, { similarity: 0, questionId: null, questionText: '' });
}

export function calculateCosineSimilarity(leftVector, rightVector) {
  const left = Array.from(leftVector || []);
  const right = Array.from(rightVector || []);
  if (!left.length || left.length !== right.length) return 0;

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  if (!leftMagnitude || !rightMagnitude) return 0;
  return Number((dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))).toFixed(4));
}

function selectSemanticCandidates(candidate, questions = [], limit = 24) {
  const scored = questions.map((question, index) => ({
    question,
    index,
    lexicalSimilarity: calculateQuestionSimilarity(
      candidate,
      question.questionText || question.text || ''
    )
  }));
  const topLexical = [...scored]
    .sort((left, right) => right.lexicalSimilarity - left.lexicalSimilarity)
    .slice(0, Math.ceil(limit / 2));
  const recent = scored.slice(-Math.floor(limit / 2));
  const seen = new Set();

  return [...topLexical, ...recent]
    .filter(item => {
      const key = item.question.questionId
        || item.question.id
        || item.question._id?.toString?.()
        || `${item.index}:${item.question.questionText || item.question.text || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(item.question.questionText || item.question.text);
    })
    .slice(0, limit)
    .map(item => item.question);
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
}

function formatCounts(counts, limit = 12) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, count]) => `${label} (${count})`)
    .join('; ');
}

export function buildQuestionMemory(existingQuestions = [], { recentLimit = 12 } = {}) {
  if (!existingQuestions.length) {
    return {
      prompt: '',
      previousQuestions: [],
      comparisonQuestions: [],
      stats: { total: 0, recent: 0, compressed: 0 }
    };
  }

  const recentQuestions = existingQuestions.slice(-recentLimit);
  const compressedQuestions = existingQuestions.slice(0, Math.max(0, existingQuestions.length - recentLimit));
  const typeCounts = countBy(existingQuestions, question => question.type || 'unknown');
  const focusCounts = countBy(existingQuestions, question => (
    question.generationMetadata?.plannedSlice
    || question.generationMetadata?.focusArea
    || question.generationMetadata?.subObjective
  ));
  const objectiveCounts = countBy(existingQuestions, question => question.learningObjective?.toString?.());

  const recentSummary = recentQuestions.map((question, index) => {
    const focus = question.generationMetadata?.plannedSlice
      || question.generationMetadata?.focusArea
      || 'general focus';
    return `${index + 1}. [${question.type || 'question'}] ${question.questionText.slice(0, 280)} | Focus: ${focus}`;
  }).join('\n');

  const prompt = [
    'BOUNDED QUIZ MEMORY AND NOVELTY RULES:',
    `The quiz already contains ${existingQuestions.length} question(s).`,
    recentSummary ? `Recent question stems:\n${recentSummary}` : '',
    compressedQuestions.length
      ? `Older history is compressed into coverage counts (${compressedQuestions.length} questions; full stems intentionally omitted).`
      : '',
    `Question type coverage: ${formatCounts(typeCounts) || 'none'}.`,
    focusCounts.size ? `Covered focus areas: ${formatCounts(focusCounts)}.` : '',
    objectiveCounts.size ? `Learning objectives already assessed: ${formatCounts(objectiveCounts)}.` : '',
    'Generate a meaningfully novel question. Do not repeat the same assessed fact, scenario, misconception, stem pattern, or answer-option pattern.',
    'When reusing a learning objective, select a different subpoint, application context, reasoning step, or Bloom-level task.'
  ].filter(Boolean).join('\n');

  return {
    prompt,
    previousQuestions: recentQuestions.map(question => ({
      questionText: question.questionText,
      type: question.type,
      explanation: question.explanation?.slice(0, 300),
      focusArea: question.generationMetadata?.plannedSlice
        || question.generationMetadata?.focusArea
    })),
    comparisonQuestions: existingQuestions.map(question => ({
      id: question._id?.toString?.() || question.id,
      questionText: question.questionText
    })),
    stats: {
      total: existingQuestions.length,
      recent: recentQuestions.length,
      compressed: compressedQuestions.length
    }
  };
}

class QuestionMemoryService {
  constructor() {
    this.sessionQuestions = new Map();
    this.semanticQueue = Promise.resolve();
  }

  async findMostSemanticallySimilarQuestion(candidate, questions = []) {
    const candidates = selectSemanticCandidates(candidate, questions);
    if (!candidates.length) return null;

    const runEmbedding = async () => {
      const { default: ragService } = await import('./ragService.js');
      if (!ragService.isInitialized || !ragService.embeddings?.embed) return null;

      const texts = [
        candidate,
        ...candidates.map(question => question.questionText || question.text || '')
      ];
      const vectors = await ragService.embeddings.embed(texts);
      const candidateVector = vectors?.[0];
      if (!candidateVector) return null;

      return candidates.reduce((best, question, index) => {
        const similarity = calculateCosineSimilarity(candidateVector, vectors[index + 1]);
        return similarity > best.similarity
          ? {
              similarity,
              questionId: question._id?.toString?.() || question.id || question.questionId,
              questionText: question.questionText || question.text || ''
            }
          : best;
      }, { similarity: 0, questionId: null, questionText: '' });
    };

    const queuedCheck = this.semanticQueue.then(runEmbedding, runEmbedding);
    this.semanticQueue = queuedCheck.catch(() => null);
    return queuedCheck;
  }

  async reserveIfNovel({
    sessionId,
    questionId,
    candidate,
    existingQuestions = [],
    threshold = 0.76,
    semanticThreshold = 0.9
  }) {
    const sessionQuestions = this.sessionQuestions.get(sessionId) || [];
    const comparisonPool = [
      ...existingQuestions,
      ...sessionQuestions.filter(question => question.questionId !== questionId)
    ];
    const lexicalClosest = findMostSimilarQuestion(candidate, comparisonPool);
    let semanticClosest = null;

    try {
      semanticClosest = await this.findMostSemanticallySimilarQuestion(candidate, comparisonPool);
    } catch (error) {
      console.warn(`⚠️ Semantic duplicate check unavailable; using lexical fallback: ${error.message}`);
    }

    const semanticSimilarity = semanticClosest?.similarity || 0;
    const effectiveSimilarity = Math.max(lexicalClosest.similarity, semanticSimilarity);
    const closest = semanticSimilarity > lexicalClosest.similarity
      ? semanticClosest
      : lexicalClosest;
    const novel = lexicalClosest.similarity < threshold && semanticSimilarity < semanticThreshold;

    if (novel) {
      sessionQuestions.push({ questionId, questionText: candidate });
      this.sessionQuestions.set(sessionId, sessionQuestions);
    }

    return {
      novel,
      threshold,
      semanticThreshold,
      similarity: effectiveSimilarity,
      lexicalSimilarity: lexicalClosest.similarity,
      semanticSimilarity,
      method: semanticClosest ? 'lexical-and-semantic' : 'lexical',
      noveltyScore: Number((1 - effectiveSimilarity).toFixed(4)),
      mostSimilarQuestionId: closest.questionId,
      mostSimilarQuestionText: closest.questionText
    };
  }

  clearSession(sessionId) {
    this.sessionQuestions.delete(sessionId);
  }
}

const questionMemoryService = new QuestionMemoryService();

export default questionMemoryService;
