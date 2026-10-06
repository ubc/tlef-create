import { describe, expect, jest, test } from '@jest/globals';
import {
  buildQuestionMemory,
  calculateCosineSimilarity,
  calculateQuestionSimilarity,
  findMostSimilarQuestion,
  normalizeQuestionText,
  QuestionMemoryService
} from '../../services/questionMemoryService.js';

describe('questionMemoryService', () => {
  test('normalizes generic question boilerplate before comparison', () => {
    expect(normalizeQuestionText('Which of the following describes Methane?'))
      .toBe('describes methane');
  });

  test('scores repeated question stems higher than distinct tasks', () => {
    const duplicateScore = calculateQuestionSimilarity(
      'What is the primary anthropogenic source of methane emissions?',
      'Which of the following is the primary anthropogenic source of methane emissions?'
    );
    const distinctScore = calculateQuestionSimilarity(
      'What is the primary anthropogenic source of methane emissions?',
      'Calculate the net force on a block moving down an inclined plane.'
    );

    expect(duplicateScore).toBeGreaterThan(0.76);
    expect(distinctScore).toBeLessThan(0.3);
  });

  test('keeps only recent full questions in the LLM-facing memory', () => {
    const questions = Array.from({ length: 20 }, (_, index) => ({
      _id: `question-${index}`,
      type: 'multiple-choice',
      questionText: `Question ${index} about concept ${index}`,
      learningObjective: `lo-${index % 3}`,
      generationMetadata: { focusArea: `focus-${index % 4}` }
    }));

    const memory = buildQuestionMemory(questions, { recentLimit: 5 });
    expect(memory.previousQuestions).toHaveLength(5);
    expect(memory.comparisonQuestions).toHaveLength(20);
    expect(memory.stats).toEqual({ total: 20, recent: 5, compressed: 15 });
    expect(memory.prompt).toContain('Older history is compressed');
  });

  test('returns the closest existing question for the novelty gate', () => {
    const closest = findMostSimilarQuestion(
      'What is the main source of methane emissions?',
      [
        { id: 'a', questionText: 'Calculate acceleration on a ramp.' },
        { id: 'b', questionText: 'What is the main source of methane emissions?' }
      ]
    );

    expect(closest.questionId).toBe('b');
    expect(closest.similarity).toBe(1);
  });

  test('calculates cosine similarity for semantic duplicate checks', () => {
    expect(calculateCosineSimilarity([1, 0, 1], [1, 0, 1])).toBe(1);
    expect(calculateCosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(calculateCosineSimilarity([1], [1, 0])).toBe(0);
  });
});

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const candidate = 'Calculate the acceleration of a 2 kg block under a 6 N net force.';
const createMemory = () => {
  const memory = new QuestionMemoryService();
  memory.findMostSemanticallySimilarQuestion = jest.fn().mockResolvedValue(null);
  return memory;
};
const reserve = (memory, questionId, text = candidate, sessionId = 'batch') => memory.reserveIfNovel({
  sessionId, questionId, candidate: text, existingQuestions: []
});

describe('atomic per-session novelty reservations', () => {
  test('only one concurrent identical candidate is reserved, using unchanged thresholds', async () => {
    const memory = createMemory();
    const [first, second] = await Promise.all([reserve(memory, 'first'), reserve(memory, 'second')]);

    expect(first.novel).toBe(true);
    expect(second).toMatchObject({ novel: false, lexicalSimilarity: 1, mostSimilarQuestionId: 'first',
      threshold: 0.76, semanticThreshold: 0.9 });
    expect(memory.sessionQuestions.get('batch').map(question => question.questionId)).toEqual(['first']);
  });

  test('all distinct concurrent candidates remain available to later duplicate checks', async () => {
    const memory = createMemory();
    const texts = [candidate, 'Explain how evaporation changes liquid water into vapor.',
      'Identify the main anthropogenic source of methane emissions.'];
    const results = await Promise.all(texts.map((text, index) => reserve(memory, `question-${index}`, text)));

    expect(results.map(result => result.novel)).toEqual([true, true, true]);
    const repeated = await Promise.all(texts.map((text, index) => reserve(memory, `repeat-${index}`, text)));
    expect(repeated.map(result => result.novel)).toEqual([false, false, false]);
    expect(memory.sessionQuestions.get('batch')).toHaveLength(3);
  });

  test('diagnostics keep the actual lexical and semantic closest questions separate', async () => {
    const memory = createMemory();
    memory.findMostSemanticallySimilarQuestion.mockResolvedValue({ similarity: 0.91,
      questionId: 'semantic-closest', questionText: 'A different wording of the same reasoning task.' });
    const result = await memory.reserveIfNovel({ sessionId: 'batch', questionId: 'candidate', candidate,
      existingQuestions: [{ id: 'lexical-closest', questionText: candidate }] });
    expect(result).toMatchObject({ novel: false, lexicalSimilarity: 1, semanticSimilarity: 0.91,
      lexicalClosest: { questionId: 'lexical-closest', questionText: candidate },
      semanticClosest: { questionId: 'semantic-closest', questionText: 'A different wording of the same reasoning task.' },
      mostSimilarQuestionId: 'lexical-closest' });
  });

  test('a blocked check in one session does not block another session', async () => {
    const memory = createMemory();
    const started = deferred(); const finish = deferred();
    memory.findMostSemanticallySimilarQuestion.mockImplementationOnce(async () => {
      started.resolve(); await finish.promise; return null;
    });
    const first = reserve(memory, 'first', candidate, 'session-a');
    await started.promise;
    try {
      await expect(reserve(memory, 'second', candidate, 'session-b')).resolves.toMatchObject({ novel: true });
      expect(memory.sessionQuestions.has('session-a')).toBe(false);
    } finally { finish.resolve(); }
    await expect(first).resolves.toMatchObject({ novel: true });
  });

  test('a failed semantic lookup uses the existing lexical fallback and releases the queue', async () => {
    const memory = createMemory();
    memory.findMostSemanticallySimilarQuestion.mockRejectedValueOnce(new Error('Semantic lookup unavailable'));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const [first, second] = await Promise.all([reserve(memory, 'first'), reserve(memory, 'second')]);
      expect(first).toMatchObject({ novel: true, method: 'lexical' });
      expect(second).toMatchObject({ novel: false, lexicalSimilarity: 1 });
    } finally { warning.mockRestore(); }
  });

  test('a rejected check does not poison subsequent queued work', async () => {
    const memory = createMemory();
    memory.findMostSemanticallySimilarQuestion.mockResolvedValueOnce({
      get similarity() { throw new Error('Similarity result could not be read'); }
    });
    const first = reserve(memory, 'first');
    const second = reserve(memory, 'second');
    await expect(first).rejects.toThrow('Similarity result could not be read');
    await expect(second).resolves.toMatchObject({ novel: true });
    expect(memory.sessionQuestions.get('batch').map(question => question.questionId)).toEqual(['second']);
  });

  test('clearing invalidates running and queued checks without reviving the session', async () => {
    const memory = createMemory();
    const started = deferred(); const finish = deferred();
    memory.findMostSemanticallySimilarQuestion.mockImplementationOnce(async () => {
      started.resolve(); await finish.promise; return null;
    });
    const first = reserve(memory, 'first');
    const second = reserve(memory, 'second');
    const rejected = Promise.all([first, second].map(result =>
      expect(result).rejects.toMatchObject({ code: 'GENERATION_INTERRUPTED' })));
    await started.promise;
    memory.clearSession('batch');
    memory.clearSession('batch');
    finish.resolve();
    await rejected;

    expect(memory.findMostSemanticallySimilarQuestion).toHaveBeenCalledTimes(1);
    expect(memory.sessionQuestions.has('batch')).toBe(false);
  });

  test('a new lifecycle with the same session ID cannot be overwritten by an old check', async () => {
    const memory = createMemory();
    const started = deferred(); const finish = deferred();
    memory.findMostSemanticallySimilarQuestion.mockImplementationOnce(async () => {
      started.resolve(); await finish.promise; return null;
    });
    const old = reserve(memory, 'old');
    const rejected = expect(old).rejects.toMatchObject({ code: 'GENERATION_INTERRUPTED' });
    await started.promise;
    memory.clearSession('batch');
    await expect(reserve(memory, 'fresh', 'Explain water evaporation.')).resolves.toMatchObject({ novel: true });
    finish.resolve();
    await rejected;

    expect(memory.sessionQuestions.get('batch').map(question => question.questionId)).toEqual(['fresh']);
    await expect(reserve(memory, 'repeat-fresh', 'Explain water evaporation.')).resolves.toMatchObject({ novel: false });
    memory.clearSession('batch');
    memory.clearSession('batch');
    expect(memory.sessionQuestions.has('batch')).toBe(false);
  });
});
