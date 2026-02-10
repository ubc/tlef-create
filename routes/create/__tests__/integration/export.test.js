import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs/promises';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Quiz from '../../models/Quiz.js';
import Question from '../../models/Question.js';
import LearningObjective from '../../models/LearningObjective.js';
import exportController from '../../controllers/exportController.js';
import { testExportQuestions } from '../fixtures/testData.js';

// Create test app with auth middleware bypass
function createTestApp(userDoc) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userDoc;
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/api/export', exportController);
  return app;
}

// Create unauthenticated app for 401 tests
function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/export', exportController);
  return app;
}

describe('Export API Integration Tests', () => {
  let app;
  let unauthApp;
  let userId;
  let folderId;
  let quizId;
  let loId;
  const createdFiles = [];

  // Helper: create a quiz with questions and learning objectives
  async function createQuizWithQuestions(overrides = {}) {
    const folder = await Folder.create({
      name: 'Export Test Folder',
      instructor: userId
    });
    folderId = folder._id.toString();

    const quiz = await Quiz.create({
      name: overrides.name || 'Export Test Quiz',
      folder: folder._id,
      createdBy: userId,
      status: overrides.status || 'completed',
      ...overrides.quizFields
    });
    quizId = quiz._id.toString();

    const lo = await LearningObjective.create({
      text: 'Understand basic concepts',
      quiz: quiz._id,
      order: 0,
      createdBy: userId
    });
    loId = lo._id.toString();

    // Create questions from test fixtures
    const questionDocs = [];
    const questionFixtures = [
      testExportQuestions.multipleChoice,
      testExportQuestions.trueFalse,
      testExportQuestions.flashcard
    ];

    for (let i = 0; i < questionFixtures.length; i++) {
      const fixture = questionFixtures[i];
      const q = await Question.create({
        quiz: quiz._id,
        learningObjective: lo._id,
        createdBy: userId,
        type: fixture.type,
        difficulty: fixture.difficulty,
        questionText: fixture.questionText,
        content: fixture.content || {},
        correctAnswer: fixture.correctAnswer,
        reviewStatus: fixture.reviewStatus || 'approved',
        order: i
      });
      questionDocs.push(q);
    }

    // Update quiz with references
    quiz.questions = questionDocs.map(q => q._id);
    quiz.learningObjectives = [lo._id];
    await quiz.save();

    return { quiz, questions: questionDocs, lo };
  }

  beforeEach(async () => {
    // Clean collections
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Quiz.deleteMany({});
    await Question.deleteMany({});
    await LearningObjective.deleteMany({});

    // Create test user
    const user = await User.create({ cwlId: 'exporttest', password: 'TestPass123' });
    userId = user._id.toString();

    // Create apps - pass Mongoose user doc so authenticateToken sets fullUser correctly
    app = createTestApp(user);
    unauthApp = createUnauthApp();

    // Create quiz with questions by default
    await createQuizWithQuestions();
  });

  afterEach(async () => {
    // Clean up any created export files
    for (const filePath of createdFiles) {
      try {
        await fs.unlink(filePath);
      } catch {
        // File may already be deleted
      }
    }
    createdFiles.length = 0;
  });

  // Helper to track created files from response
  function trackExportFile(response) {
    if (response.body?.data?.filename) {
      // The controller uses ./routes/create/uploads/ relative to cwd
      const filePath = path.join('./routes/create/uploads/', response.body.data.filename);
      createdFiles.push(filePath);
    }
  }

  describe('POST /api/export/h5p/:quizId', () => {
    test('should generate H5P export successfully', async () => {
      const response = await request(app)
        .post(`/api/export/h5p/${quizId}`)
        .expect(201);

      trackExportFile(response);

      expect(response.body.success).toBe(true);
      expect(response.body.data.exportId).toBeDefined();
      expect(response.body.data.filename).toContain('.h5p');
      expect(response.body.data.downloadUrl).toContain('/download');
      expect(response.body.data.previewUrl).toContain('/preview');
      expect(response.body.data.metadata.questionCount).toBe(3);
      expect(response.body.data.metadata.exportFormat).toBe('h5p');
      expect(response.body.data.metadata.fileSize).toBeGreaterThan(0);

      // Verify export record was saved in quiz
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.exports).toHaveLength(1);
      expect(quizInDb.exports[0].format).toBe('h5p');
    });

    test('should return 404 for non-existent quiz', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post(`/api/export/h5p/${nonExistentId}`)
        .expect(404);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toContain('not found');
    });

    test('should return 400 for quiz with no questions', async () => {
      // Create quiz without questions
      const emptyQuiz = await Quiz.create({
        name: 'Empty Quiz',
        folder: folderId,
        createdBy: userId,
        status: 'draft'
      });

      const response = await request(app)
        .post(`/api/export/h5p/${emptyQuiz._id}`)
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toContain('questions');
    });

    test('should return 404 for other user quiz', async () => {
      const otherUserId = new mongoose.Types.ObjectId();
      const otherQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        createdBy: otherUserId,
        status: 'completed'
      });

      const response = await request(app)
        .post(`/api/export/h5p/${otherQuiz._id}`)
        .expect(404);

      expect(response.body.error).toBeDefined();
    });

    test('should return 400 for invalid quiz ID format', async () => {
      const response = await request(app)
        .post('/api/export/h5p/invalid-id')
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /api/export/pdf/:quizId', () => {
    test('should generate PDF with questions type', async () => {
      const response = await request(app)
        .post(`/api/export/pdf/${quizId}`)
        .send({ type: 'questions' })
        .expect(201);

      trackExportFile(response);

      expect(response.body.success).toBe(true);
      expect(response.body.data.filename).toContain('.pdf');
      expect(response.body.data.metadata.exportFormat).toBe('pdf');
      expect(response.body.data.metadata.exportType).toBe('questions');
      expect(response.body.data.metadata.fileSize).toBeGreaterThan(0);
    });

    test('should generate PDF with answers type', async () => {
      const response = await request(app)
        .post(`/api/export/pdf/${quizId}`)
        .send({ type: 'answers' })
        .expect(201);

      trackExportFile(response);

      expect(response.body.success).toBe(true);
      expect(response.body.data.metadata.exportType).toBe('answers');
    });

    test('should generate PDF with combined type', async () => {
      const response = await request(app)
        .post(`/api/export/pdf/${quizId}`)
        .send({ type: 'combined' })
        .expect(201);

      trackExportFile(response);

      expect(response.body.success).toBe(true);
      expect(response.body.data.metadata.exportType).toBe('combined');
    });

    test('should return 400 for invalid export type', async () => {
      const response = await request(app)
        .post(`/api/export/pdf/${quizId}`)
        .send({ type: 'invalid' })
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toContain('Invalid export type');
    });

    test('should return 404 for non-existent quiz', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post(`/api/export/pdf/${nonExistentId}`)
        .send({ type: 'questions' })
        .expect(404);

      expect(response.body.error).toBeDefined();
    });

    test('should return 400 for quiz with no questions', async () => {
      const emptyQuiz = await Quiz.create({
        name: 'Empty Quiz',
        folder: folderId,
        createdBy: userId,
        status: 'draft'
      });

      const response = await request(app)
        .post(`/api/export/pdf/${emptyQuiz._id}`)
        .send({ type: 'questions' })
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toContain('questions');
    });
  });

  describe('GET /api/export/:quizId/preview', () => {
    test('should return quiz preview successfully', async () => {
      const response = await request(app)
        .get(`/api/export/${quizId}/preview`)
        .expect(200);

      expect(response.body.success).toBe(true);

      const preview = response.body.data.preview;
      expect(preview.quiz.name).toBe('Export Test Quiz');
      expect(preview.structure.questionCount).toBe(3);
      expect(preview.structure.objectiveCount).toBe(1);
      expect(preview.structure.questionTypes).toBeDefined();
      expect(preview.structure.difficultyDistribution).toBeDefined();
      expect(preview.objectives).toHaveLength(1);
      expect(preview.objectives[0].text).toBe('Understand basic concepts');
      expect(preview.questions).toHaveLength(3);
      expect(preview.exportInfo.readyForExport).toBe(true);
      expect(preview.exportInfo.h5pCompatible).toBe(true);
      expect(preview.exportInfo.estimatedFileSize).toBeDefined();
    });

    test('should truncate long question text in preview', async () => {
      // Create a question with very long text
      const longText = 'A'.repeat(200);
      const lo = await LearningObjective.findById(loId);
      const longQ = await Question.create({
        quiz: quizId,
        learningObjective: lo._id,
        createdBy: userId,
        type: 'multiple-choice',
        difficulty: 'easy',
        questionText: longText,
        content: { options: [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: false }] },
        reviewStatus: 'approved',
        order: 10
      });

      const quiz = await Quiz.findById(quizId);
      quiz.questions.push(longQ._id);
      await quiz.save();

      const response = await request(app)
        .get(`/api/export/${quizId}/preview`)
        .expect(200);

      const longQuestion = response.body.data.preview.questions.find(
        q => q.questionText.length > 100
      );
      expect(longQuestion).toBeDefined();
      expect(longQuestion.questionText).toContain('...');
      expect(longQuestion.questionText.length).toBeLessThanOrEqual(103); // 100 + "..."
    });

    test('should return 404 for non-existent quiz', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/export/${nonExistentId}/preview`)
        .expect(404);

      expect(response.body.error).toBeDefined();
    });

    test('should return 404 for other user quiz', async () => {
      const otherQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        createdBy: new mongoose.Types.ObjectId(),
        status: 'completed'
      });

      const response = await request(app)
        .get(`/api/export/${otherQuiz._id}/preview`)
        .expect(404);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/export/:quizId/formats', () => {
    test('should return available export formats', async () => {
      const response = await request(app)
        .get(`/api/export/${quizId}/formats`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.formats).toBeInstanceOf(Array);
      expect(response.body.data.formats.length).toBeGreaterThan(0);

      // Check H5P format is included and supported
      const h5pFormat = response.body.data.formats.find(f => f.id === 'h5p');
      expect(h5pFormat).toBeDefined();
      expect(h5pFormat.supported).toBe(true);
      expect(h5pFormat.fileExtension).toBe('.h5p');
      expect(h5pFormat.features).toBeInstanceOf(Array);

      // Check JSON format is supported
      const jsonFormat = response.body.data.formats.find(f => f.id === 'json');
      expect(jsonFormat).toBeDefined();
      expect(jsonFormat.supported).toBe(true);

      // Check QTI format exists but not supported
      const qtiFormat = response.body.data.formats.find(f => f.id === 'qti');
      expect(qtiFormat).toBeDefined();
      expect(qtiFormat.supported).toBe(false);
    });

    test('should return 404 for non-existent quiz', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/export/${nonExistentId}/formats`)
        .expect(404);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('DELETE /api/export/:exportId', () => {
    let exportId;

    beforeEach(async () => {
      // Create an export first
      const response = await request(app)
        .post(`/api/export/h5p/${quizId}`)
        .expect(201);

      exportId = response.body.data.exportId;
      trackExportFile(response);
    });

    test('should delete export successfully', async () => {
      const response = await request(app)
        .delete(`/api/export/${exportId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');

      // Verify export record removed from quiz
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.exports).toHaveLength(0);
    });

    test('should return 404 for non-existent export', async () => {
      const fakeExportId = 'nonexistent123456789abcdef';

      const response = await request(app)
        .delete(`/api/export/${fakeExportId}`)
        .expect(404);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/export/:exportId/download', () => {
    let exportId;

    beforeEach(async () => {
      // Create an export first
      const response = await request(app)
        .post(`/api/export/h5p/${quizId}`)
        .expect(201);

      exportId = response.body.data.exportId;
      trackExportFile(response);
    });

    test('should download export file successfully', async () => {
      const response = await request(app)
        .get(`/api/export/${exportId}/download`)
        .expect(200);

      // Check headers
      expect(response.headers['content-type']).toContain('application/zip');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('.h5p');

      // Check that body has content
      expect(response.body).toBeDefined();

      // Verify download count was incremented
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.exports[0].downloadCount).toBe(1);
    });

    test('should return 404 for non-existent export', async () => {
      const fakeExportId = 'nonexistent123456789abcdef';

      const response = await request(app)
        .get(`/api/export/${fakeExportId}/download`)
        .expect(404);

      expect(response.body.error).toBeDefined();
    });

    test('should return 404 for other user export', async () => {
      // Create a different user's app
      const otherUser = await User.create({ cwlId: 'otherexportuser', password: 'TestPass123' });
      const otherApp = createTestApp(otherUser);

      // The export belongs to the original user, other user should not access
      const response = await request(otherApp)
        .get(`/api/export/${exportId}/download`)
        .expect(404);

      expect(response.body.error).toBeDefined();
    });
  });
});
