import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import Question from '../../models/Question.js';
import objectiveController from '../../controllers/objectiveController.js';

function createTestApp(userDoc) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userDoc;
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/api/objectives', objectiveController);
  return app;
}

function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/objectives', objectiveController);
  return app;
}

describe('Objectives API Integration Tests', () => {
  let app;
  let unauthApp;
  let user;
  let otherUser;
  let folder;
  let quiz;

  beforeEach(async () => {
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Quiz.deleteMany({});
    await LearningObjective.deleteMany({});
    await Question.deleteMany({});

    user = await User.create({ cwlId: 'objtest', password: 'TestPass123' });
    otherUser = await User.create({ cwlId: 'otherobj', password: 'TestPass123' });
    app = createTestApp(user);
    unauthApp = createUnauthApp();

    folder = await Folder.create({ name: 'Obj Folder', instructor: user._id });
    quiz = await Quiz.create({
      name: 'Obj Quiz',
      folder: folder._id,
      createdBy: user._id
    });
  });

  // ── GET /api/objectives/quiz/:quizId ──

  describe('GET /api/objectives/quiz/:quizId', () => {
    test('should return objectives sorted by order', async () => {
      await LearningObjective.create([
        { text: 'Second', quiz: quiz._id, order: 1, createdBy: user._id },
        { text: 'First', quiz: quiz._id, order: 0, createdBy: user._id },
        { text: 'Third', quiz: quiz._id, order: 2, createdBy: user._id }
      ]);

      const res = await request(app).get(`/api/objectives/quiz/${quiz._id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.objectives).toHaveLength(3);
      expect(res.body.data.objectives[0].text).toBe('First');
      expect(res.body.data.objectives[1].text).toBe('Second');
      expect(res.body.data.objectives[2].text).toBe('Third');
    });

    test('should return empty array for quiz with no objectives', async () => {
      const res = await request(app).get(`/api/objectives/quiz/${quiz._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.objectives).toEqual([]);
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).get(`/api/objectives/quiz/${fakeId}`);
      expect(res.status).toBe(404);
    });

    test('should return 404 for quiz owned by another user', async () => {
      const otherQuiz = await Quiz.create({
        name: 'Other Quiz',
        folder: folder._id,
        createdBy: otherUser._id
      });
      const res = await request(app).get(`/api/objectives/quiz/${otherQuiz._id}`);
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/objectives (single) ──

  describe('POST /api/objectives (single)', () => {
    test('should create a single objective', async () => {
      const res = await request(app)
        .post('/api/objectives')
        .send({ text: 'Understand arrays', quizId: quiz._id.toString() });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.objective.text).toBe('Understand arrays');
    });

    test('should reject missing text', async () => {
      const res = await request(app)
        .post('/api/objectives')
        .send({ quizId: quiz._id.toString() });

      expect(res.status).toBe(400);
    });

    test('should reject missing quizId', async () => {
      const res = await request(app)
        .post('/api/objectives')
        .send({ text: 'Some objective' });

      expect(res.status).toBe(400);
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/objectives')
        .send({ text: 'Some objective', quizId: fakeId.toString() });

      expect(res.status).toBe(404);
    });

    test('should return 404 for quiz owned by another user', async () => {
      const otherQuiz = await Quiz.create({
        name: 'Other Quiz',
        folder: folder._id,
        createdBy: otherUser._id
      });
      const res = await request(app)
        .post('/api/objectives')
        .send({ text: 'Some objective', quizId: otherQuiz._id.toString() });

      expect(res.status).toBe(404);
    });

    test('should add objective to quiz learningObjectives array', async () => {
      await request(app)
        .post('/api/objectives')
        .send({ text: 'Understand arrays', quizId: quiz._id.toString() });

      const updatedQuiz = await Quiz.findById(quiz._id);
      expect(updatedQuiz.learningObjectives).toHaveLength(1);
    });
  });

  // ── POST /api/objectives (batch) ──

  describe('POST /api/objectives (batch)', () => {
    test('should create batch of objectives', async () => {
      const res = await request(app)
        .post('/api/objectives')
        .send([
          { text: 'Objective A', quizId: quiz._id.toString() },
          { text: 'Objective B', quizId: quiz._id.toString() },
          { text: 'Objective C', quizId: quiz._id.toString() }
        ]);

      expect(res.status).toBe(201);
      expect(res.body.data.objectives).toHaveLength(3);
      expect(res.body.data.summary.successful).toBe(3);
    });

    test('should delete existing objectives before batch create', async () => {
      // Create initial objectives
      await LearningObjective.create([
        { text: 'Old 1', quiz: quiz._id, order: 0, createdBy: user._id },
        { text: 'Old 2', quiz: quiz._id, order: 1, createdBy: user._id }
      ]);

      const res = await request(app)
        .post('/api/objectives')
        .send([
          { text: 'New 1', quizId: quiz._id.toString() }
        ]);

      expect(res.status).toBe(201);
      expect(res.body.data.objectives).toHaveLength(1);

      // Verify old objectives are gone
      const remaining = await LearningObjective.find({ quiz: quiz._id });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].text).toBe('New 1');
    });

    test('should reject empty array', async () => {
      const res = await request(app)
        .post('/api/objectives')
        .send([]);

      expect(res.status).toBe(400);
    });

    test('should return 404 for non-existent quiz in batch', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/objectives')
        .send([{ text: 'Objective', quizId: fakeId.toString() }]);

      expect(res.status).toBe(404);
    });
  });

  // ── PUT /api/objectives/:id ──

  describe('PUT /api/objectives/:id', () => {
    test('should update objective text', async () => {
      const objective = await LearningObjective.create({
        text: 'Original text',
        quiz: quiz._id,
        order: 0,
        createdBy: user._id
      });

      const res = await request(app)
        .put(`/api/objectives/${objective._id}`)
        .send({ text: 'Updated text' });

      expect(res.status).toBe(200);
      expect(res.body.data.objective.text).toBe('Updated text');
    });

    test('should return 404 for non-existent objective', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put(`/api/objectives/${fakeId}`)
        .send({ text: 'Updated text' });

      expect(res.status).toBe(404);
    });

    test('should return 404 for objective owned by another user', async () => {
      const otherObjective = await LearningObjective.create({
        text: 'Other text',
        quiz: quiz._id,
        order: 0,
        createdBy: otherUser._id
      });

      const res = await request(app)
        .put(`/api/objectives/${otherObjective._id}`)
        .send({ text: 'Updated text' });

      expect(res.status).toBe(404);
    });

    test('should track edit history', async () => {
      const objective = await LearningObjective.create({
        text: 'Original text',
        quiz: quiz._id,
        order: 0,
        createdBy: user._id
      });

      await request(app)
        .put(`/api/objectives/${objective._id}`)
        .send({ text: 'Updated text' });

      const updated = await LearningObjective.findById(objective._id);
      expect(updated.editHistory).toHaveLength(1);
      expect(updated.editHistory[0].previousText).toBe('Original text');
    });
  });

  // ── PUT /api/objectives/reorder ──

  describe('PUT /api/objectives/reorder', () => {
    test('should reorder objectives correctly', async () => {
      const obj1 = await LearningObjective.create({ text: 'A', quiz: quiz._id, order: 0, createdBy: user._id });
      const obj2 = await LearningObjective.create({ text: 'B', quiz: quiz._id, order: 1, createdBy: user._id });
      const obj3 = await LearningObjective.create({ text: 'C', quiz: quiz._id, order: 2, createdBy: user._id });

      const res = await request(app)
        .put('/api/objectives/reorder')
        .send({
          quizId: quiz._id.toString(),
          objectiveIds: [obj3._id.toString(), obj1._id.toString(), obj2._id.toString()]
        });

      expect(res.status).toBe(200);
      expect(res.body.data.objectives[0].text).toBe('C');
      expect(res.body.data.objectives[1].text).toBe('A');
      expect(res.body.data.objectives[2].text).toBe('B');
    });

    test('should reject missing fields', async () => {
      const res = await request(app)
        .put('/api/objectives/reorder')
        .send({});

      expect(res.status).toBe(400);
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put('/api/objectives/reorder')
        .send({ quizId: fakeId.toString(), objectiveIds: [] });

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/objectives/quiz/:quizId/all ──

  describe('DELETE /api/objectives/quiz/:quizId/all', () => {
    test('should delete all objectives for a quiz', async () => {
      await LearningObjective.create([
        { text: 'A', quiz: quiz._id, order: 0, createdBy: user._id },
        { text: 'B', quiz: quiz._id, order: 1, createdBy: user._id }
      ]);

      const res = await request(app).delete(`/api/objectives/quiz/${quiz._id}/all`);
      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBe(2);
    });

    test('should clear quiz learningObjectives array', async () => {
      const obj = await LearningObjective.create({
        text: 'A', quiz: quiz._id, order: 0, createdBy: user._id
      });
      quiz.learningObjectives = [obj._id];
      await quiz.save();

      await request(app).delete(`/api/objectives/quiz/${quiz._id}/all`);

      const updatedQuiz = await Quiz.findById(quiz._id);
      expect(updatedQuiz.learningObjectives).toHaveLength(0);
    });

    test('should return 0 for empty quiz', async () => {
      const res = await request(app).delete(`/api/objectives/quiz/${quiz._id}/all`);
      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBe(0);
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).delete(`/api/objectives/quiz/${fakeId}/all`);
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/objectives/:id ──

  describe('DELETE /api/objectives/:id', () => {
    test('should delete objective with no questions', async () => {
      const objective = await LearningObjective.create({
        text: 'Delete me', quiz: quiz._id, order: 0, createdBy: user._id
      });

      const res = await request(app)
        .delete(`/api/objectives/${objective._id}?confirmed=true`);

      expect(res.status).toBe(200);
      const deleted = await LearningObjective.findById(objective._id);
      expect(deleted).toBeNull();
    });

    test('should require confirmation when questions exist', async () => {
      const objective = await LearningObjective.create({
        text: 'Has questions', quiz: quiz._id, order: 0, createdBy: user._id
      });
      await Question.create({
        quiz: quiz._id,
        learningObjective: objective._id,
        type: 'multiple-choice',
        difficulty: 'moderate',
        questionText: 'Test Q?',
        content: { options: [] },
        order: 0,
        createdBy: user._id
      });

      const res = await request(app)
        .delete(`/api/objectives/${objective._id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.requiresConfirmation).toBe(true);
      expect(res.body.data.questionCount).toBe(1);

      // Objective should NOT be deleted yet
      const stillExists = await LearningObjective.findById(objective._id);
      expect(stillExists).not.toBeNull();
    });

    test('should cascade delete questions when confirmed', async () => {
      const objective = await LearningObjective.create({
        text: 'Has questions', quiz: quiz._id, order: 0, createdBy: user._id
      });
      await Question.create({
        quiz: quiz._id,
        learningObjective: objective._id,
        type: 'multiple-choice',
        difficulty: 'moderate',
        questionText: 'Test Q?',
        content: { options: [] },
        order: 0,
        createdBy: user._id
      });

      const res = await request(app)
        .delete(`/api/objectives/${objective._id}?confirmed=true`);

      expect(res.status).toBe(200);
      expect(res.body.data.deletedQuestions).toBe(1);

      const remainingQuestions = await Question.find({ learningObjective: objective._id });
      expect(remainingQuestions).toHaveLength(0);
    });

    test('should return 404 for non-existent objective', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .delete(`/api/objectives/${fakeId}?confirmed=true`);

      expect(res.status).toBe(404);
    });

    test('should return 404 for objective owned by another user', async () => {
      const otherObj = await LearningObjective.create({
        text: 'Other', quiz: quiz._id, order: 0, createdBy: otherUser._id
      });

      const res = await request(app)
        .delete(`/api/objectives/${otherObj._id}?confirmed=true`);

      expect(res.status).toBe(404);
    });
  });

  // ── Authentication ──

  describe('Authentication', () => {
    test('should reject unauthenticated GET request', async () => {
      const res = await request(unauthApp).get(`/api/objectives/quiz/${quiz._id}`);
      expect(res.status).toBe(401);
    });

    test('should reject unauthenticated POST request', async () => {
      const res = await request(unauthApp)
        .post('/api/objectives')
        .send({ text: 'Test', quizId: quiz._id.toString() });
      expect(res.status).toBe(401);
    });
  });
});
