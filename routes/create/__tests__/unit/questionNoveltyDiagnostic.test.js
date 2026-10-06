import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { buildRejectedNoveltyDraft } from '../../services/questionNoveltyDiagnostic.js';
import RejectedQuestionDraft from '../../models/RejectedQuestionDraft.js';
import Question from '../../models/Question.js';
import Session from '../../models/StudioAssistantSession.js';
import coursePromptService from '../../services/coursePromptService.js';
import questionJobs from '../../services/questionGenerationJobs.js';
import streaming from '../../services/questionStreamingService.js';

process.env.RAG_SKIP_AUTO_INIT = 'true';
const { createQuestionBatchWork } = await import('../../services/questionBatchGeneration.js');
const { readAssistantSession } = await import('../../services/studioAssistantService.js');
const owner = '507f1f77bcf86cd799439011';
const quizId = '507f1f77bcf86cd799439012';
const jobId = '507f1f77bcf86cd799439013';
const sessionId = '507f1f77bcf86cd799439014';
const result = { novel: false, method: 'lexical-and-semantic', similarity: 0.904, noveltyScore: 0.096,
  lexicalSimilarity: 0.6078, threshold: 0.76, lexicalClosest: { questionId: 'lexical-ref', questionText: 'PRIVATE lexical stem' },
  semanticSimilarity: 0.904, semanticThreshold: 0.9, semanticClosest: { questionId: 'question-15', questionText: 'PRIVATE semantic stem' } };
const rejectedDraft = () => buildRejectedNoveltyDraft({ question: { questionText: 'PRIVATE candidate',
  content: { options: [{ text: 'Synthetic answer', isCorrect: true }] } }, result });

afterEach(() => jest.restoreAllMocks());

describe('bounded application novelty diagnostics', () => {
  test('records separate scores, thresholds and actual closest identities without turning similarity into correctness', () => {
    const draft = rejectedDraft();
    expect(draft.novelty).toEqual({ method: 'lexical-and-semantic', similarity: 0.904, noveltyScore: 0.096,
      lexical: { similarity: 0.6078, threshold: 0.76, questionId: 'lexical-ref', questionText: 'PRIVATE lexical stem' },
      semantic: { similarity: 0.904, threshold: 0.9, questionId: 'question-15', questionText: 'PRIVATE semantic stem' } });
    expect(draft.issues[0]).toContain('60.78% is below the 76.00%');
    expect(draft.issues[1]).toContain('90.40% meets or exceeds the 90.00%');
    expect(draft.issues[2]).toContain('does not prove');
    expect(draft.reviewSummary).toBeUndefined();
  });
  test('bounds generated and closest content and copies no prompts, provider data or arbitrary metadata', () => {
    const draft = buildRejectedNoveltyDraft({ candidate: 'C'.repeat(9000), question: {
      questionText: 'Old display title', correctAnswer: 'A'.repeat(3000), prompt: 'SECRET prompt',
      content: { options: Array.from({ length: 30 }, () => ({ text: 'O'.repeat(900), isCorrect: true, feedback: 'SECRET provider data' })) }
    }, result: { ...result, prompt: 'SECRET prompt', semanticClosest: { questionId: 'R'.repeat(200),
      questionText: 'S'.repeat(8000), source: 'SECRET source', vector: [1, 2] } } });
    expect(draft.questionText).toHaveLength(4000); expect(draft.correctAnswer).toHaveLength(2000);
    expect(draft.options).toHaveLength(20); expect(draft.options[0].text).toHaveLength(500);
    expect(draft.novelty.semantic.questionId).toHaveLength(120); expect(draft.novelty.semantic.questionText).toHaveLength(240);
    expect(JSON.stringify(draft)).not.toContain('SECRET');
    expect(new RejectedQuestionDraft({ owner, quiz: quizId, job: jobId, index: 0, ...draft }).validateSync()).toBeUndefined();
  });
  test('does not invent missing closest identities or accept malformed metrics', () => {
    const draft = buildRejectedNoveltyDraft({ question: {}, result: { novel: false, similarity: 0.95,
      method: 'lexical-and-semantic', lexicalSimilarity: NaN, threshold: -1,
      semanticSimilarity: 0.95, semanticThreshold: 0.9,
      mostSimilarQuestionId: 'cannot-assume-which-check', mostSimilarQuestionText: 'DO NOT BORROW THIS' } });
    expect(draft.novelty.lexical).toBeUndefined();
    expect(draft.novelty.semantic).toEqual({ similarity: 0.95, threshold: 0.9 });
    expect(JSON.stringify(draft)).not.toContain('DO NOT BORROW');
    expect(draft.issues[0]).toContain('identity was not recorded');
    expect(buildRejectedNoveltyDraft({ result: { ...result, novel: true } })).toBeUndefined();
  });
  test('lexical fallback does not present an unperformed semantic check', () => {
    const draft = buildRejectedNoveltyDraft({ result: { ...result, method: 'lexical', lexicalSimilarity: 1 } });
    expect(draft.novelty.semantic).toBeUndefined();
    expect(draft.issues.some(issue => issue.startsWith('Semantic'))).toBe(false);
  });
  test('typed storage rejects invalid scores and oversized comparison summaries', () => {
    for (const novelty of [{ similarity: 1.1 }, { lexical: { threshold: -1 } },
      { semantic: { questionText: 'X'.repeat(241) } }]) {
      expect(new RejectedQuestionDraft({ owner, quiz: quizId, job: jobId, index: 0, novelty }).validateSync()).toBeDefined();
    }
  });
});

function emptyQuestions() {
  const query = { select: jest.fn(), sort: jest.fn(), lean: jest.fn().mockResolvedValue([]) };
  query.select.mockReturnValue(query); query.sort.mockReturnValue(query);
  jest.spyOn(Question, 'find').mockReturnValue(query);
}

async function batchFailure(error, { storageError = false } = {}) {
  emptyQuestions();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(coursePromptService, 'buildCoursePromptInstructions').mockResolvedValue({ prompt: '' });
  jest.spyOn(streaming, 'generateQuestionWithStreaming').mockRejectedValue(error);
  const save = jest.spyOn(RejectedQuestionDraft, 'updateOne');
  if (storageError) save.mockRejectedValue(new Error('Synthetic diagnostic storage failure'));
  else save.mockResolvedValue({ acknowledged: true });
  const job = { _id: jobId, sessionId: 'synthetic-batch', baseQuestionIds: [],
    items: [{ index: 0, questionId: 'question-1', status: 'queued', savedQuestionId: '507f1f77bcf86cd799439015' }] };
  const updateItem = jest.fn(async (index, patch) => Object.assign(job.items[index], patch));
  const work = createQuestionBatchWork({ quiz: { _id: quizId, folder: 'synthetic-folder', learningObjectives: [] },
    questionConfigs: [{ questionType: 'multiple-choice', customPrompt: 'Synthetic task', useCustomPromptOnly: true }],
    readiness: { processedMaterialIds: [] }, userId: owner });
  await work({ job, assertActive: async () => {}, updateItem, signal: new AbortController().signal });
  return { save, job };
}

describe('novelty persistence and owned read boundary', () => {
  test('stores a duplicate draft under exact owner/job/item and leaves privacy-limited receipt free of private text', async () => {
    const draft = rejectedDraft();
    const { save, job } = await batchFailure({ code: 'QUESTION_DUPLICATE_DETECTED', rejectedDraft: draft });
    expect(save).toHaveBeenCalledWith({ owner, quiz: quizId, job: jobId, index: 0 }, {
      $set: { quiz: quizId, reason: 'QUESTION_DUPLICATE_DETECTED', ...draft },
      $unset: { calculationCheck: '', reviewSummary: '', contentSummary: '' }
    }, { upsert: true, runValidators: true });
    expect(job.items[0]).toMatchObject({ status: 'failed', code: 'QUESTION_DUPLICATE_DETECTED' });
    expect(JSON.stringify(job.items[0])).not.toContain('PRIVATE');
  });
  test('diagnostic storage failure preserves the actual safe duplicate failure', async () => {
    const { job } = await batchFailure({ code: 'QUESTION_DUPLICATE_DETECTED', rejectedDraft: rejectedDraft() }, { storageError: true });
    expect(job.items[0]).toMatchObject({ status: 'failed', code: 'QUESTION_DUPLICATE_DETECTED' });
  });
  test('a reviewer failure replaces stale novelty, while unrelated failure never stores a rejected draft', async () => {
    const quality = await batchFailure({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'ANSWER_INVALID',
      rejectedDraft: { questionText: 'Reviewer-rejected question', issues: ['Invalid answer'] } });
    expect(quality.save.mock.calls[0][1].$unset).toEqual({ novelty: '' });
    jest.restoreAllMocks();
    const unrelated = await batchFailure({ code: 'MODEL_SERVICE_LIMIT_REACHED', rejectedDraft: rejectedDraft() });
    expect(unrelated.save).not.toHaveBeenCalled();
  });

  function assistantFixture(jobQuiz = quizId) {
    jest.spyOn(Session, 'findOne').mockResolvedValue({ _id: sessionId, owner, courseId: 'synthetic-course', quizId,
      status: 'failed', materialIds: [], objectives: [], plan: [], outputs: [], events: [], questionJobRequestId: 'synthetic-request' });
    jest.spyOn(questionJobs, 'get').mockResolvedValue({ _id: jobId, quiz: jobQuiz, status: 'failed',
      items: [{ index: 0, status: 'failed' }, { index: 1, status: 'ready' }] });
    const query = { select: jest.fn(), lean: jest.fn().mockResolvedValue([{ index: 0, ...rejectedDraft() }]) };
    query.select.mockReturnValue(query);
    const find = jest.spyOn(RejectedQuestionDraft, 'find').mockReturnValue(query);
    emptyQuestions();
    return { find, query };
  }
  test('owned assistant read exposes current failed-item novelty only through the scoped rejected-content query', async () => {
    const { find, query } = assistantFixture();
    const view = await readAssistantSession(owner, sessionId);
    expect(find).toHaveBeenCalledWith({ owner, quiz: quizId, job: jobId, index: { $in: [0] } });
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('novelty'));
    expect(view.generation.items[0].review.novelty).toEqual(rejectedDraft().novelty);
    expect(view.generation.items[1].review).toBeUndefined();
  });
  test('an unrelated receipt or unowned session cannot access rejected content', async () => {
    const { find } = assistantFixture('different-quiz');
    await readAssistantSession(owner, sessionId);
    expect(find).not.toHaveBeenCalled();
    Session.findOne.mockResolvedValue(null);
    await expect(readAssistantSession('another-owner', sessionId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(find).not.toHaveBeenCalled();
  });
});
