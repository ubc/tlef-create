import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Quiz from '../../models/Quiz.js';
import Question from '../../models/Question.js';
import LearningObjective from '../../models/LearningObjective.js';
import questionController from '../../controllers/questionController.js';

// Create test app with auth middleware bypass
function createTestApp(userDoc) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userDoc;
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/api/questions', questionController);
  return app;
}

// Create unauthenticated app for 401 tests
function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/questions', questionController);
  return app;
}

describe('Questions API Integration Tests', () => {
  let app;
  let unauthApp;
  let user;
  let otherUser;
  let folder;
  let quiz;
  let lo;

  beforeEach(async () => {
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Quiz.deleteMany({});
    await Question.deleteMany({});
    await LearningObjective.deleteMany({});

    user = await User.create({ cwlId: 'questiontest', password: 'TestPass123' });
    otherUser = await User.create({ cwlId: 'otheruser', password: 'TestPass456' });

    app = createTestApp(user);
    unauthApp = createUnauthApp();

    folder = await Folder.create({ name: 'Test Folder', instructor: user._id });
    quiz = await Quiz.create({
      name: 'Test Quiz',
      folder: folder._id,
      createdBy: user._id,
      status: 'draft'
    });
    lo = await LearningObjective.create({
      text: 'Understand basic concepts',
      quiz: quiz._id,
      order: 0,
      createdBy: user._id
    });

    quiz.learningObjectives = [lo._id];
    await quiz.save();
  });

  // ---- GET /api/questions/quiz/:quizId ----
  describe('GET /api/questions/quiz/:quizId', () => {
    test('should return questions sorted by order', async () => {
      const q1 = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'multiple-choice', difficulty: 'moderate',
        questionText: 'Question B', order: 1
      });
      const q0 = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'true-false', difficulty: 'easy',
        questionText: 'Question A', order: 0
      });

      const res = await request(app).get(`/api/questions/quiz/${quiz._id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.questions).toHaveLength(2);
      expect(res.body.data.questions[0].questionText).toBe('Question A');
      expect(res.body.data.questions[1].questionText).toBe('Question B');
    });

    test('should return empty array for quiz with no questions', async () => {
      const res = await request(app).get(`/api/questions/quiz/${quiz._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.questions).toHaveLength(0);
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).get(`/api/questions/quiz/${fakeId}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('should return 404 for quiz owned by another user', async () => {
      const otherQuiz = await Quiz.create({
        name: 'Other Quiz', folder: folder._id, createdBy: otherUser._id
      });
      const res = await request(app).get(`/api/questions/quiz/${otherQuiz._id}`);
      expect(res.status).toBe(404);
    });
  });

  // ---- POST /api/questions/generate-from-plan (deprecated) ----
  describe('POST /api/questions/generate-from-plan', () => {
    test('should return 410 Gone', async () => {
      const res = await request(app)
        .post('/api/questions/generate-from-plan')
        .send({ quizId: quiz._id.toString() });
      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DEPRECATED_ENDPOINT');
    });
  });

  // ---- POST /api/questions/generate-from-plan-stream (deprecated) ----
  describe('POST /api/questions/generate-from-plan-stream', () => {
    test('should return 410 Gone', async () => {
      const res = await request(app)
        .post('/api/questions/generate-from-plan-stream')
        .send({ quizId: quiz._id.toString() });
      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DEPRECATED_ENDPOINT');
    });
  });

  // ---- POST /api/questions (create) ----
  describe('POST /api/questions', () => {
    const makeBody = (overrides = {}) => ({
      quizId: quiz._id.toString(),
      learningObjectiveId: lo._id.toString(),
      type: 'multiple-choice',
      difficulty: 'moderate',
      questionText: 'What is 2+2?',
      content: {
        options: [
          { text: '3', isCorrect: false },
          { text: '4', isCorrect: true }
        ]
      },
      correctAnswer: '4',
      ...overrides
    });

    test('should create a multiple-choice question', async () => {
      const res = await request(app).post('/api/questions').send(makeBody());
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.question.type).toBe('multiple-choice');
      expect(res.body.data.question.questionText).toBe('What is 2+2?');
      expect(res.body.data.question.order).toBe(0);
    });

    test('should create a flashcard question', async () => {
      const res = await request(app).post('/api/questions').send(makeBody({
        type: 'flashcard',
        difficulty: 'easy',
        questionText: 'What is DNA?',
        content: { front: 'What is DNA?', back: 'Deoxyribonucleic acid' },
        correctAnswer: 'Deoxyribonucleic acid'
      }));
      expect(res.status).toBe(201);
      expect(res.body.data.question.type).toBe('flashcard');
      expect(res.body.data.question.content.front).toBe('What is DNA?');
    });

    test('should auto-increment order', async () => {
      await request(app).post('/api/questions').send(makeBody());
      const res2 = await request(app).post('/api/questions').send(makeBody({
        questionText: 'Second question'
      }));
      expect(res2.status).toBe(201);
      expect(res2.body.data.question.order).toBe(1);
    });

    test('should add question to quiz.questions array', async () => {
      const res = await request(app).post('/api/questions').send(makeBody());
      const updatedQuiz = await Quiz.findById(quiz._id);
      expect(updatedQuiz.questions).toHaveLength(1);
      expect(updatedQuiz.questions[0].toString()).toBe(res.body.data.question._id);
    });

    test('should return 400 for missing required fields', async () => {
      const res = await request(app).post('/api/questions').send({
        quizId: quiz._id.toString()
        // missing learningObjectiveId, type, difficulty, questionText
      });
      expect(res.status).toBe(400);
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).post('/api/questions').send(makeBody({
        quizId: fakeId.toString()
      }));
      expect(res.status).toBe(404);
    });

    test('should return 404 for non-existent learning objective', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).post('/api/questions').send(makeBody({
        learningObjectiveId: fakeId.toString()
      }));
      expect(res.status).toBe(404);
    });

    test('should return 404 when quiz belongs to another user', async () => {
      const otherQuiz = await Quiz.create({
        name: 'Other Quiz', folder: folder._id, createdBy: otherUser._id
      });
      const res = await request(app).post('/api/questions').send(makeBody({
        quizId: otherQuiz._id.toString()
      }));
      expect(res.status).toBe(404);
    });
  });

  // ---- PUT /api/questions/:id (update) ----
  describe('PUT /api/questions/:id', () => {
    let question;

    beforeEach(async () => {
      question = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'multiple-choice', difficulty: 'moderate',
        questionText: 'Original text', correctAnswer: 'A', order: 0
      });
    });

    test('should update questionText', async () => {
      const res = await request(app)
        .put(`/api/questions/${question._id}`)
        .send({ questionText: 'Updated text' });
      expect(res.status).toBe(200);
      expect(res.body.data.question.questionText).toBe('Updated text');
    });

    test('should update multiple fields', async () => {
      const res = await request(app)
        .put(`/api/questions/${question._id}`)
        .send({ questionText: 'New text', difficulty: 'hard', explanation: 'Because...' });
      expect(res.status).toBe(200);
      expect(res.body.data.question.difficulty).toBe('hard');
      expect(res.body.data.question.explanation).toBe('Because...');
    });

    test('should track edit history', async () => {
      await request(app)
        .put(`/api/questions/${question._id}`)
        .send({ questionText: 'Changed' });

      const updated = await Question.findById(question._id);
      expect(updated.editHistory).toHaveLength(1);
      expect(updated.editHistory[0].changes).toBe('Manual update');
      expect(updated.editHistory[0].previousVersion.questionText).toBe('Original text');
    });

    test('should return 404 for non-existent question', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put(`/api/questions/${fakeId}`)
        .send({ questionText: 'New' });
      expect(res.status).toBe(404);
    });

    test('should return 404 for question owned by another user', async () => {
      const otherQ = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: otherUser._id,
        type: 'true-false', difficulty: 'easy',
        questionText: 'Other question', order: 1
      });
      const res = await request(app)
        .put(`/api/questions/${otherQ._id}`)
        .send({ questionText: 'Hijacked' });
      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /api/questions/:id ----
  describe('DELETE /api/questions/:id', () => {
    let question;

    beforeEach(async () => {
      question = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'multiple-choice', difficulty: 'moderate',
        questionText: 'To be deleted', order: 0
      });
      await quiz.addQuestion(question._id);
    });

    test('should delete the question', async () => {
      const res = await request(app).delete(`/api/questions/${question._id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const found = await Question.findById(question._id);
      expect(found).toBeNull();
    });

    test('should remove question from quiz.questions', async () => {
      await request(app).delete(`/api/questions/${question._id}`);
      const updatedQuiz = await Quiz.findById(quiz._id);
      expect(updatedQuiz.questions.map(q => q.toString())).not.toContain(question._id.toString());
    });

    test('should return 404 for non-existent question', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).delete(`/api/questions/${fakeId}`);
      expect(res.status).toBe(404);
    });

    test('should return 404 for question owned by another user', async () => {
      const otherQ = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: otherUser._id,
        type: 'true-false', difficulty: 'easy',
        questionText: 'Not yours', order: 1
      });
      const res = await request(app).delete(`/api/questions/${otherQ._id}`);
      expect(res.status).toBe(404);
    });
  });

  // ---- PUT /api/questions/reorder ----
  describe('PUT /api/questions/reorder', () => {
    let q0, q1, q2;

    beforeEach(async () => {
      q0 = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'multiple-choice', difficulty: 'moderate',
        questionText: 'First', order: 0
      });
      q1 = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'true-false', difficulty: 'easy',
        questionText: 'Second', order: 1
      });
      q2 = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'flashcard', difficulty: 'easy',
        questionText: 'Third', order: 2
      });
    });

    test('should reorder questions correctly', async () => {
      // Reverse order: q2, q1, q0
      const res = await request(app)
        .put('/api/questions/reorder')
        .send({
          quizId: quiz._id.toString(),
          questionIds: [q2._id.toString(), q1._id.toString(), q0._id.toString()]
        });
      expect(res.status).toBe(200);
      expect(res.body.data.questions[0].questionText).toBe('Third');
      expect(res.body.data.questions[1].questionText).toBe('Second');
      expect(res.body.data.questions[2].questionText).toBe('First');
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put('/api/questions/reorder')
        .send({
          quizId: fakeId.toString(),
          questionIds: [q0._id.toString()]
        });
      expect(res.status).toBe(404);
    });

    test('should return 400 when questionIds mismatch', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put('/api/questions/reorder')
        .send({
          quizId: quiz._id.toString(),
          questionIds: [q0._id.toString(), fakeId.toString()]
        });
      expect(res.status).toBe(400);
    });
  });

  // ---- PUT /api/questions/:id/review ----
  describe('PUT /api/questions/:id/review', () => {
    let question;

    beforeEach(async () => {
      question = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'multiple-choice', difficulty: 'moderate',
        questionText: 'Review me', order: 0, reviewStatus: 'pending'
      });
    });

    test('should set status to approved', async () => {
      const res = await request(app)
        .put(`/api/questions/${question._id}/review`)
        .send({ status: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body.data.question.reviewStatus).toBe('approved');
    });

    test('should set status to rejected', async () => {
      const res = await request(app)
        .put(`/api/questions/${question._id}/review`)
        .send({ status: 'rejected' });
      expect(res.status).toBe(200);
      expect(res.body.data.question.reviewStatus).toBe('rejected');
    });

    test('should reject invalid review status', async () => {
      const res = await request(app)
        .put(`/api/questions/${question._id}/review`)
        .send({ status: 'super-approved' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 404 for question owned by another user', async () => {
      const otherQ = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: otherUser._id,
        type: 'true-false', difficulty: 'easy',
        questionText: 'Not yours', order: 1
      });
      const res = await request(app)
        .put(`/api/questions/${otherQ._id}/review`)
        .send({ status: 'approved' });
      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /api/questions/quiz/:quizId (delete all) ----
  describe('DELETE /api/questions/quiz/:quizId', () => {
    test('should delete all questions for a quiz', async () => {
      await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'multiple-choice', difficulty: 'moderate',
        questionText: 'Q1', order: 0
      });
      await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'true-false', difficulty: 'easy',
        questionText: 'Q2', order: 1
      });

      const res = await request(app).delete(`/api/questions/quiz/${quiz._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBe(2);

      const remaining = await Question.find({ quiz: quiz._id });
      expect(remaining).toHaveLength(0);
    });

    test('should return deletedCount 0 for quiz with no questions', async () => {
      const res = await request(app).delete(`/api/questions/quiz/${quiz._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBe(0);
    });

    test('should clear quiz.questions array', async () => {
      const q = await Question.create({
        quiz: quiz._id, learningObjective: lo._id, createdBy: user._id,
        type: 'multiple-choice', difficulty: 'moderate',
        questionText: 'Q1', order: 0
      });
      quiz.questions = [q._id];
      await quiz.save();

      await request(app).delete(`/api/questions/quiz/${quiz._id}`);
      const updatedQuiz = await Quiz.findById(quiz._id);
      expect(updatedQuiz.questions).toHaveLength(0);
    });

    test('should return 404 for non-existent quiz', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).delete(`/api/questions/quiz/${fakeId}`);
      expect(res.status).toBe(404);
    });

    test('should return 404 for quiz owned by another user', async () => {
      const otherQuiz = await Quiz.create({
        name: 'Other Quiz', folder: folder._id, createdBy: otherUser._id
      });
      const res = await request(app).delete(`/api/questions/quiz/${otherQuiz._id}`);
      expect(res.status).toBe(404);
    });
  });
});
