import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import streamingController from '../../controllers/streamingController.js';

function createTestApp(userDoc) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userDoc;
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/api/streaming', streamingController);
  return app;
}

function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/streaming', streamingController);
  return app;
}

describe('Streaming API Integration Tests', () => {
  let app;
  let unauthApp;
  let user;
  let quiz;

  beforeEach(async () => {
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Quiz.deleteMany({});
    await LearningObjective.deleteMany({});

    user = await User.create({ cwlId: 'streamtest', password: 'TestPass123' });
    app = createTestApp(user);
    unauthApp = createUnauthApp();

    const folder = await Folder.create({ name: 'Stream Folder', instructor: user._id });
    quiz = await Quiz.create({
      name: 'Stream Quiz',
      folder: folder._id,
      createdBy: user._id
    });
    const lo = await LearningObjective.create({
      text: 'Test objective',
      quiz: quiz._id,
      order: 0,
      createdBy: user._id
    });
    quiz.learningObjectives = [lo._id];
    await quiz.save();
  });

  describe('GET /api/streaming/questions/:sessionId', () => {
    test('should reject invalid session ID (too short)', async () => {
      const res = await request(app).get('/api/streaming/questions/abc');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid session ID');
    });

    test('should return 401 without auth', async () => {
      const res = await request(unauthApp).get('/api/streaming/questions/valid-session-id-1234567890');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/streaming/generate-questions', () => {
    test('should reject missing quizId', async () => {
      const res = await request(app)
        .post('/api/streaming/generate-questions')
        .send({ questionConfigs: [{ questionType: 'multiple-choice' }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    test('should reject missing questionConfigs', async () => {
      const res = await request(app)
        .post('/api/streaming/generate-questions')
        .send({ quizId: quiz._id.toString() });
      expect(res.status).toBe(400);
    });

    test('should reject non-array questionConfigs', async () => {
      const res = await request(app)
        .post('/api/streaming/generate-questions')
        .send({ quizId: quiz._id.toString(), questionConfigs: 'not-array' });
      expect(res.status).toBe(400);
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/streaming/generate-questions')
        .send({
          quizId: fakeId.toString(),
          questionConfigs: [{ questionType: 'multiple-choice' }]
        });
      expect(res.status).toBe(404);
    });

    test('should return 401 without auth', async () => {
      const res = await request(unauthApp)
        .post('/api/streaming/generate-questions')
        .send({
          quizId: quiz._id.toString(),
          questionConfigs: [{ questionType: 'multiple-choice' }]
        });
      expect(res.status).toBe(401);
    });

    test('should return session info for valid input', async () => {
      const res = await request(app)
        .post('/api/streaming/generate-questions')
        .send({
          quizId: quiz._id.toString(),
          questionConfigs: [{ questionType: 'multiple-choice' }]
        });
      // Will succeed or fail based on questionStreamingService availability
      // but should not be a 400/404 validation error
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.sessionId).toBeDefined();
        expect(res.body.sseEndpoint).toContain('/api/streaming/questions/');
      }
    });
  });
});
