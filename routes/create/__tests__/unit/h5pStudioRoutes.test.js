import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const owner = '507f1f77bcf86cd799439011';
const findOne = jest.fn();
const create = jest.fn();
const removeRecord = jest.fn();
const complete = jest.fn();
const deleteContent = jest.fn();
let parameters;
const editor = {
  render: jest.fn().mockResolvedValue({ scripts: [] }),
  getContent: jest.fn(async () => ({ params: { params: parameters } })),
  saveOrUpdateContentReturnMetaData: jest.fn(async (_id, params, metadata) => { parameters = params; return { id: '123', metadata }; }),
  deleteContent,
  contentManager: { contentFileExists: jest.fn().mockResolvedValue(true) }
};
jest.unstable_mockModule('../../models/H5PContent.js', () => ({ default: { findOne, create, deleteOne: removeRecord } }));
jest.unstable_mockModule('../../models/Quiz.js', () => ({ default: { findOne } }));
jest.unstable_mockModule('../../middleware/auth.js', () => ({ authenticateToken: (req, _res, next) => { req.user = { id: owner }; next(); } }));
jest.unstable_mockModule('../../services/llmService.js', () => ({ default: { streamCompletion: complete } }));
jest.unstable_mockModule('../../services/h5pExportService.js', () => ({ buildNativeH5PDocument: jest.fn() }));
jest.unstable_mockModule('../../services/lumiService.js', () => ({
  getEditor: () => editor, toLumiUser: user => user,
  getSystemUser: () => ({ id: 'system' }), finalizeContentOwnership: jest.fn(),
  getH5PExpressRouter: jest.fn(), importH5PContent: jest.fn(), renderContent: jest.fn()
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
  test('exposes installed catalog without content or account details', async () => {
    const response = await request(app).get('/ai/catalog');
    expect(response.status).toBe(200);
    expect(response.body.data.types.length).toBeGreaterThan(30);
    expect(response.body.data.types[0]).not.toHaveProperty('directory');
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
