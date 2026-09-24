import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getGenerationReadiness, isCustomPromptOnly } from '../../utils/generationReadiness.js';
import Quiz from '../../models/Quiz.js';
import Question from '../../models/Question.js';
import questionGenerationJobs from '../../services/questionGenerationJobs.js';
import { getStudioCatalog } from '../../services/h5pStudioCatalog.js';

process.env.RAG_SKIP_AUTO_INIT = 'true';
const { default: streamingRouter } = await import('../../controllers/streamingController.js');
const { default: questionRouter } = await import('../../controllers/questionController.js');
const { default: llmService } = await import('../../services/llmService.js');
const { default: ragService } = await import('../../services/ragService.js');

const grounded = { questionType: 'multiple-choice', learningObjective: 'Explain condensation.' };
const customOnly = { questionType: 'multiple-choice', learningObjective: null, useCustomPromptOnly: true, customPrompt: 'Use this instructor-provided scenario.' };

function invoke(router, path, body, params = {}, method = 'post') {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route?.methods[method]).route;
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, locals: {}, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ status: this.statusCode, body: value }); } };
    route.stack.at(-1).handle({ body, params, user: { id: 'instructor' } }, res, reject);
  });
}

function mockQuiz(materials) {
  const quiz = { _id: 'quiz', createdBy: 'instructor', materials, questions: ['question'], learningObjectives: [{ _id: 'lo', text: grounded.learningObjective }] };
  const query = { populate: jest.fn(() => query), then: (resolve, reject) => Promise.resolve(quiz).then(resolve, reject) };
  jest.spyOn(Quiz, 'findOne').mockReturnValue(query);
  return quiz;
}

let restoreRuntime;
function simulateUnavailableBranching() {
  const libraries = getStudioCatalog().libraries;
  const key = 'H5PEditor.BranchingScenario 1.5';
  const entry = libraries.get(key);
  libraries.delete(key);
  restoreRuntime = () => { if (entry) libraries.set(key, entry); };
}
beforeEach(() => { jest.spyOn(Quiz, 'updateOne').mockResolvedValue({ modifiedCount: 1 }); });
afterEach(() => { jest.restoreAllMocks(); restoreRuntime?.(); restoreRuntime = null; });

describe('material-dependent generation readiness', () => {
  test.each(['failed', 'processing', 'pending'])('blocks %s-only materials while preserving explicit custom prompt mode', processingStatus => {
    const quiz = { materials: [{ _id: 'material', processingStatus }] };
    expect(getGenerationReadiness(quiz, [grounded])).toMatchObject({ ready: false, code: 'MATERIALS_NOT_READY' });
    expect(getGenerationReadiness(quiz, [customOnly])).toMatchObject({ ready: true });
    expect(getGenerationReadiness(quiz, [customOnly, grounded])).toMatchObject({ ready: false });
  });

  test('blocks empty materials and stale completed status with missing indexed chunks', () => {
    expect(getGenerationReadiness({ materials: [] }, [grounded]).ready).toBe(false);
    expect(getGenerationReadiness({ materials: [{ _id: 'material', processingStatus: 'completed', processingMetadata: { chunkCount: 3, embeddedChunkCount: 2 } }] }, [grounded]).ready).toBe(false);
    expect(getGenerationReadiness({ materials: [{ _id: 'material', processingStatus: 'completed' }] }, [grounded])).toMatchObject({ ready: true, processedMaterialIds: ['material'] });
  });

  test('does not let course-like instructions override a linked learning objective', () => {
    expect(isCustomPromptOnly({ ...grounded, customPrompt: 'Use plain language.' })).toBe(false);
    expect(getGenerationReadiness({ materials: [] }, [{ ...customOnly, customPrompt: ' ' }])).toMatchObject({ ready: false, status: 400 });
    expect(getGenerationReadiness({ materials: [] }, [{ learningObjective: null, customPrompt: 'A self-contained instructor scenario.' }]).ready).toBe(true);
  });

  test('preflight and streaming start both reject failed-only materials before generation work', async () => {
    mockQuiz([{ _id: 'material', processingStatus: 'failed' }]);
    jest.spyOn(questionGenerationJobs, 'get').mockResolvedValue(null);
    const findQuestions = jest.spyOn(Question, 'find');
    for (const path of ['/generation-readiness', '/generate-questions']) {
      const response = await invoke(streamingRouter, path, { quizId: '507f1f77bcf86cd799439011', requestId: 'unit-readiness-request-123', questionConfigs: [grounded] });
      expect(response).toMatchObject({ status: 409, body: { success: false, error: { code: 'MATERIALS_NOT_READY' } } });
    }
    expect(findQuestions).not.toHaveBeenCalled();
    expect(Quiz.findOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439011', createdBy: 'instructor' });
  });

  test('preflight accepts the null-objective custom-only contract', async () => {
    mockQuiz([]);
    expect(await invoke(streamingRouter, '/generation-readiness', { quizId: 'quiz', questionConfigs: [customOnly] })).toMatchObject({ status: 200, body: { success: true, data: { ready: true } } });
  });

  test('unavailable runtime types are rejected by preflight and manual creation before writes', async () => {
    simulateUnavailableBranching();
    mockQuiz([]);
    const findQuestions = jest.spyOn(Question, 'findOne');
    const config = { ...customOnly, questionType: 'branching-scenario' };
    expect(await invoke(streamingRouter, '/generation-readiness', { quizId: 'quiz', questionConfigs: [config] })).toMatchObject({ status: 503, body: { error: { code: 'QUESTION_TYPE_UNAVAILABLE' } } });
    expect(await invoke(questionRouter, '/', { quizId: 'quiz', type: 'branching-scenario' })).toMatchObject({ status: 503 });
    expect(findQuestions).not.toHaveBeenCalled();
  });

  test('rejects attempts to switch into an unavailable type while preserving edits to existing Branching content', async () => {
    simulateUnavailableBranching();
    jest.spyOn(Quiz, 'exists').mockResolvedValue({ _id: 'quiz' });
    const question = { quiz: 'quiz', type: 'multiple-choice', questionText: 'Original', addEdit: jest.fn(async () => {}) };
    jest.spyOn(Question, 'findOne').mockResolvedValue(question);
    expect(await invoke(questionRouter, '/:id', { type: 'branching-scenario' }, { id: 'question' }, 'put')).toMatchObject({ status: 503 });
    expect(question.addEdit).not.toHaveBeenCalled();
    question.type = 'branching-scenario';
    expect(await invoke(questionRouter, '/:id', { type: 'branching-scenario', questionText: 'Edited existing activity' }, { id: 'question' }, 'put')).toMatchObject({ status: 200 });
    expect(question.questionText).toBe('Edited existing activity');
    expect(Quiz.updateOne).toHaveBeenCalledWith({ _id: 'quiz', createdBy: 'instructor' }, { $set: { 'progress.reviewCompleted': false } });
  });

  test('regeneration with failed-only materials keeps the original question untouched', async () => {
    mockQuiz([{ _id: 'material', processingStatus: 'failed' }]);
    const question = { _id: 'question', quiz: 'quiz', type: 'multiple-choice', questionText: 'Original question', learningObjective: { text: grounded.learningObjective }, addEdit: jest.fn() };
    jest.spyOn(Question, 'findOne').mockReturnValue({ populate: async () => question });
    expect(await invoke(questionRouter, '/:id/regenerate', {}, { id: 'question' })).toMatchObject({ status: 409 });
    expect(question.questionText).toBe('Original question');
    expect(question.addEdit).not.toHaveBeenCalled();
  });

  test('regenerates a saved custom-only question without materials or a learning objective', async () => {
    mockQuiz([]);
    const question = {
      _id: 'question', quiz: 'quiz', type: 'multiple-choice', questionText: 'Original question', learningObjective: null,
      generationMetadata: { instructorPrompt: 'Assess this self-contained scenario.', useCustomPromptOnly: true },
      addEdit: jest.fn(async () => {})
    };
    jest.spyOn(Question, 'findOne').mockReturnValue({ populate: async () => question });
    const generate = jest.spyOn(llmService, 'generateQuestion').mockResolvedValue({ success: true, questionData: {
      questionText: 'Revised question', options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }],
      correctAnswer: 'Yes', explanation: 'The scenario supports yes.'
    } });
    const retrieve = jest.spyOn(ragService, 'retrieveRelevantContent');
    expect(await invoke(questionRouter, '/:id/regenerate', {}, { id: 'question' })).toMatchObject({ status: 200 });
    expect(retrieve).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ learningObjective: null, customPrompt: 'Assess this self-contained scenario.', relevantContent: [] }));
    expect(question.questionText).toBe('Revised question');
  });

  test('regeneration preserves material grounding and replaces citation metadata with actual retrieved sources', async () => {
    mockQuiz([{ _id: 'material', processingStatus: 'completed' }]);
    const question = {
      _id: 'question', quiz: 'quiz', type: 'multiple-choice', questionText: 'Original question', learningObjective: { text: grounded.learningObjective },
      generationMetadata: {}, addEdit: jest.fn(async () => {})
    };
    jest.spyOn(Question, 'findOne').mockReturnValue({ populate: async () => question });
    const source = { content: 'Condensation changes vapor to liquid.', score: 0.9, metadata: { materialId: 'material', materialName: 'Water cycle', chunkIndex: 0, sectionTitle: 'Chunk 1' } };
    const retrieve = jest.spyOn(ragService, 'retrieveRelevantContent').mockResolvedValue({ chunks: [source] });
    const generate = jest.spyOn(llmService, 'generateQuestion').mockResolvedValue({ success: true, questionData: {
      questionText: 'Revised grounded question', options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }], correctAnswer: 'Yes'
    } });
    expect(await invoke(questionRouter, '/:id/regenerate', {}, { id: 'question' })).toMatchObject({ status: 200 });
    expect(retrieve).toHaveBeenCalledWith(grounded.learningObjective, 'multiple-choice', expect.objectContaining({ materialIds: ['material'] }));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ relevantContent: [source] }));
    expect(question.generationMetadata.sourceReferences[0]).toMatchObject({ materialId: 'material', chunkIndex: 0, section: 'Chunk 1' });
  });
});
