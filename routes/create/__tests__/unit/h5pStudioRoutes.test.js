import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const owner = '507f1f77bcf86cd799439011';
const findOne = jest.fn();
const find = jest.fn();
const create = jest.fn();
const removeRecord = jest.fn();
const complete = jest.fn();
const deleteContent = jest.fn();
const getJob = jest.fn();
const renderContent = jest.fn();
jest.unstable_mockModule('../../services/studioGenerationJobs.js', () => ({
  default: { get: getJob, start: async (_owner, _id, work) => { await work(async () => {}); return {}; } },
  serializeStudioJob: value => value
}));
let parameters;
const editor = {
  render: jest.fn().mockResolvedValue({ scripts: [] }),
  getContent: jest.fn(async () => ({ params: { params: parameters } })),
  saveOrUpdateContentReturnMetaData: jest.fn(async (_id, params, metadata) => { parameters = params; return { id: '123', metadata }; }),
  deleteContent,
  contentManager: { contentFileExists: jest.fn().mockResolvedValue(true) }
};
jest.unstable_mockModule('../../models/H5PContent.js', () => ({ default: { find, findOne, create, deleteOne: removeRecord } }));
jest.unstable_mockModule('../../models/Quiz.js', () => ({ default: { findOne } }));
jest.unstable_mockModule('../../middleware/auth.js', () => ({ authenticateToken: (req, _res, next) => { req.user = { id: owner }; next(); } }));
jest.unstable_mockModule('../../services/llmService.js', () => ({ default: { streamCompletion: complete } }));
jest.unstable_mockModule('../../services/h5pExportService.js', () => ({ buildNativeH5PDocument: jest.fn() }));
jest.unstable_mockModule('../../services/lumiService.js', () => ({
  getEditor: () => editor, toLumiUser: user => user,
  getSystemUser: () => ({ id: 'system' }), finalizeContentOwnership: jest.fn(),
  getH5PExpressRouter: jest.fn(), importH5PContent: jest.fn(), renderContent
}));
const { default: router } = await import('../../controllers/h5pEditorController.js');
const app = express();
app.use(express.json());
app.use(router);
const body = { library: 'H5P.Chart 1.2', instructions: 'Create a chart of oaks 12 and pines 8.' };

describe('Studio AI REST boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findOne.mockReturnValue(null);
    complete.mockResolvedValue({ model: 'test', content: JSON.stringify({ title: 'Trees', params: { graphMode: 'barChart', listOfTypes: [{ text: 'Oak', value: 12 }] } }) });
    create.mockImplementation(async value => ({ ...value, _id: 'record' }));
    editor.getContent.mockImplementation(async () => ({ params: { params: parameters } }));
  });
  test('validates course filters and keeps every activity listing owner-scoped', async () => {
    const folderId = '507f1f77bcf86cd799439012';
    find.mockReturnValue({ sort: () => ({ limit: async () => [] }) });
    const response = await request(app).get(`/contents?folderId=${folderId}`);
    expect(response.status).toBe(200);
    expect(find).toHaveBeenCalledWith({ owner, folder: folderId });
    expect((await request(app).get('/contents?folderId=invalid')).status).toBe(400);
    expect((await request(app).get('/contents?quizId[$ne]=x')).status).toBe(400);
    expect(find).toHaveBeenCalledTimes(1);
  });
  test('exposes installed catalog without content or account details', async () => {
    const response = await request(app).get('/ai/catalog');
    expect(response.status).toBe(200);
    expect(response.body.data.types.length).toBeGreaterThan(30);
    expect(response.body.data.types[0]).not.toHaveProperty('directory');
  });
  test('answers a prompt-helper question without saving H5P content or generating a draft', async () => {
    complete.mockResolvedValueOnce({ content: JSON.stringify({ reply: 'What audience?', nextStep: 'continue', draft: '' }) });
    const requestBody = { messages: [{ role: 'user', content: 'Help me ask about energy' }], kind: 'single', layout: 'column',
      activityType: 'Multiple Choice', selectedQuestionTypes: [], evidenceSelected: false };
    const result = await request(app).post('/ai/brief').send(requestBody);
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ nextStep: 'continue', draft: '' });
    expect(create).not.toHaveBeenCalled();
    expect((await request(app).post('/ai/brief').send({ ...requestBody, messages: [{ role: 'assistant', content: 'No user message' }] })).status).toBe(400);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  test('grounds prompt helper context in selected objectives of an owned Learning Object', async () => {
    const quizId = '507f1f77bcf86cd799439012';
    const objectiveId = '507f1f77bcf86cd799439013';
    findOne.mockReturnValueOnce({ populate: () => ({ populate: async () => ({
      name: 'Forces', folder: '507f1f77bcf86cd799439014',
      learningObjectives: [{ _id: objectiveId, text: 'Explain net force' }]
    }) }) });
    complete.mockResolvedValueOnce({ content: JSON.stringify({ reply: 'I can see the selected objective.', nextStep: 'continue', draft: '' }) });
    const response = await request(app).post('/ai/brief').send({
      messages: [{ role: 'user', content: 'Help me teach forces' }], kind: 'single', layout: 'column',
      activityType: 'Multiple Choice', selectedQuestionTypes: [], evidenceSelected: true,
      quizId, objectiveIds: [objectiveId], materialIds: []
    });
    expect(response.status).toBe(200);
    expect(findOne).toHaveBeenCalledWith({ _id: quizId, createdBy: owner });
    expect(complete.mock.calls[0][0].prompt).toContain('Explain net force');
  });
  test('renders owned previews with the native toolbar and rejects non-owned content', async () => {
    expect((await request(app).get('/contents/private/preview')).status).toBe(404);
    expect(renderContent).not.toHaveBeenCalled();
    findOne.mockResolvedValueOnce({ owner });
    renderContent.mockResolvedValueOnce('<!doctype html><html></html>');
    const response = await request(app).get('/contents/owned/preview');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(renderContent).toHaveBeenCalledWith('owned', { id: owner }, {
      showFrame: true, showDownloadButton: true, showLicenseButton: true,
      showEmbedButton: false, showH5PIcon: true
    });
  });
  test('looks up receipts and their results only for the signed-in owner', async () => {
    getJob.mockResolvedValueOnce(null);
    expect((await request(app).get('/ai/jobs/another-request')).status).toBe(404);
    expect(getJob).toHaveBeenCalledWith(owner, 'another-request');
    getJob.mockResolvedValueOnce({ status: 'succeeded', contentId: 'deleted-or-not-owned' });
    const response = await request(app).get('/ai/jobs/owned-request');
    expect(response.body.data.content).toBeNull();
    expect(findOne).toHaveBeenCalledWith({ lumiContentId: 'deleted-or-not-owned', owner });
  });
  test('source status neither exposes non-owned drafts nor deleted source quiz details', async () => {
    expect((await request(app).get('/contents/private/source')).status).toBe(404);
    findOne.mockResolvedValueOnce({ owner, quiz: '507f1f77bcf86cd799439012' });
    findOne.mockReturnValueOnce({ populate: () => ({ populate: async () => null }) });
    const response = await request(app).get('/contents/owned/source');
    expect(response.body.data.source).toEqual({ independent: true, quizId: null, folderId: null, title: null, state: 'unavailable' });
    expect(findOne).toHaveBeenLastCalledWith({ _id: '507f1f77bcf86cd799439012', createdBy: owner });
  });
  test('creates a separate compatible empty template without an AI call', async () => {
    const response = await request(app).post('/ai/template').send({ library: 'H5P.Dictation 1.3' });
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ owner, source: 'editor', status: 'draft' }));
    expect(editor.saveOrUpdateContentReturnMetaData).toHaveBeenCalledWith(undefined, {}, expect.any(Object), 'H5P.Dictation 1.3', { id: owner });
    expect(complete).not.toHaveBeenCalled();
    const invalid = await request(app).post('/ai/template').send({ library: 'H5P.Dictation 1.4' });
    expect(invalid.status).toBe(400);
  });
  test('saves a new owned draft with bounded provenance, not a normal Quiz question', async () => {
    const response = await request(app).post('/ai/generate').send(body);
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ owner, source: 'ai-studio', status: 'draft', aiGeneration: expect.objectContaining({ validation: 'structural' }) }));
    expect(response.body.data.content.contentId).toBe('123');
    expect(JSON.stringify(create.mock.calls)).not.toContain(body.instructions);
  });
  test('rejects a non-owned template before reading Lumi files or calling the model', async () => {
    const response = await request(app).post('/ai/generate').send({ ...body, templateContentId: 'someone-elses' });
    expect(response.status).toBe(404);
    expect(findOne).toHaveBeenCalledWith({ lumiContentId: 'someone-elses', owner });
    expect(editor.getContent).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  test('rejects invalid quiz ids and media requirements without AI cost', async () => {
    expect((await request(app).post('/ai/generate').send({ ...body, quizId: 'bad' })).status).toBe(400);
    const response = await request(app).post('/ai/generate').send({ ...body, library: 'H5P.MemoryGame 1.3' });
    expect(response.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  test('rolls back Lumi content if Mongo ownership cannot be created', async () => {
    create.mockRejectedValueOnce(new Error('Database unavailable'));
    const response = await request(app).post('/ai/generate').send(body);
    expect(response.status).toBe(502);
    expect(deleteContent).toHaveBeenCalledWith('123', { id: 'system' });
    expect(response.body.error.message).not.toContain('Database unavailable');
  });
  test('does not save an incomplete media template even if browser validation allows it', async () => {
    findOne.mockResolvedValue({ owner, save: jest.fn() });
    const response = await request(app).patch('/contents/123').send({ library: 'H5P.Dictation 1.3', params: { metadata: { title: 'Incomplete template' }, params: {} } });
    expect(response.status).toBe(400);
    expect(editor.saveOrUpdateContentReturnMetaData).not.toHaveBeenCalled();
  });
});
