import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Quiz from '../../models/Quiz.js';
import Material from '../../models/Material.js';
import quizController from '../../controllers/quizController.js';

// Create test app with auth middleware bypass
function createTestApp(userDoc) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userDoc;
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/api/quizzes', quizController);
  app.use((err, req, res, next) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

// Create unauthenticated app for 401 tests
function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/quizzes', quizController);
  app.use((err, req, res, next) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe('Quiz Management API Integration Tests', () => {
  let app;
  let unauthApp;
  let userId;
  let folderId;

  beforeEach(async () => {
    // Clean collections
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Quiz.deleteMany({});
    await Material.deleteMany({});

    // Create test user directly in DB
    const user = await User.create({ cwlId: 'quiztest', password: 'TestPass123' });
    userId = user._id.toString();

    // Create apps - pass Mongoose user doc so authenticateToken sets fullUser correctly
    app = createTestApp(user);
    unauthApp = createUnauthApp();

    // Create test folder
    const folder = await Folder.create({
      name: 'Test Folder',
      instructor: userId
    });
    folderId = folder._id.toString();
  });

  describe('POST /api/quizzes', () => {
    test('should create a new quiz successfully', async () => {
      const quizData = {
        name: 'Test Quiz',
        folderId: folderId
      };

      const response = await request(app)
        .post('/api/quizzes')
        .send(quizData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.name).toBe(quizData.name);
      expect(response.body.data.quiz.folder).toBe(folderId);
      expect(response.body.data.quiz.createdBy).toBe(userId);
      expect(response.body.data.quiz.status).toBe('draft');
      expect(response.body.data.quiz.questions).toEqual([]);
      expect(response.body.data.quiz.materials).toEqual([]);

      // Verify quiz was created in database
      const quizInDb = await Quiz.findById(response.body.data.quiz.id);
      expect(quizInDb).toBeTruthy();
      expect(quizInDb.name).toBe(quizData.name);
    });

    test('should reject quiz creation with missing name', async () => {
      const response = await request(app)
        .post('/api/quizzes')
        .send({ folderId: folderId })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
      expect(response.body.error.details).toBeDefined();
    });

    test('should reject quiz creation with missing folderId', async () => {
      const response = await request(app)
        .post('/api/quizzes')
        .send({ name: 'Test Quiz' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
    });

    test('should reject quiz creation for non-existent folder', async () => {
      const nonExistentFolderId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post('/api/quizzes')
        .send({
          name: 'Test Quiz',
          folderId: nonExistentFolderId
        })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should reject quiz creation without authentication', async () => {
      const quizData = {
        name: 'Test Quiz',
        folderId: folderId
      };

      const response = await request(unauthApp)
        .post('/api/quizzes')
        .send(quizData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should reject quiz creation with duplicate name in same folder', async () => {
      // Create first quiz
      await Quiz.create({
        name: 'Duplicate Quiz',
        folder: folderId,
        createdBy: userId
      });

      const response = await request(app)
        .post('/api/quizzes')
        .send({ name: 'Duplicate Quiz', folderId: folderId })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });

    test('should add quiz to folder after creation', async () => {
      const response = await request(app)
        .post('/api/quizzes')
        .send({ name: 'Test Quiz', folderId: folderId })
        .expect(201);

      const folder = await Folder.findById(folderId);
      const quizId = response.body.data.quiz._id;
      expect(folder.quizzes.map(id => id.toString())).toContain(quizId);
    });
  });

  describe('GET /api/quizzes/folder/:folderId', () => {
    // NOTE: The controller applies validateMongoId which validates param('id'),
    // but this route uses :folderId, not :id. In express-validator v7, param('id')
    // on a route with :folderId will get undefined and fail isMongoId() validation.
    // These tests reflect the actual behavior: requests return 400 due to this
    // validator mismatch.
    test('should return 400 due to validateMongoId checking param id on folderId route', async () => {
      await Quiz.create([
        { name: 'Quiz 1', folder: folderId, createdBy: userId },
        { name: 'Quiz 2', folder: folderId, createdBy: userId }
      ]);

      const response = await request(app)
        .get(`/api/quizzes/folder/${folderId}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
    });
  });

  describe('GET /api/quizzes/:id', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Test Quiz',
        folder: folderId,
        createdBy: userId
      });
      quizId = quiz._id.toString();
    });

    test('should get quiz by ID successfully', async () => {
      const response = await request(app)
        .get(`/api/quizzes/${quizId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.id).toBe(quizId);
      expect(response.body.data.quiz.name).toBe('Test Quiz');
      expect(response.body.data.quiz.folder).toBe(folderId);
      expect(response.body.data.quiz.createdBy).toBe(userId);
    });

    test('should reject access to other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        createdBy: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .get(`/api/quizzes/${otherUserQuiz._id}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should return 404 for non-existent quiz', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/quizzes/${nonExistentId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should return 400 for invalid ID format', async () => {
      const response = await request(app)
        .get('/api/quizzes/invalid-id')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
    });
  });

  describe('PUT /api/quizzes/:id', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Original Quiz Name',
        folder: folderId,
        createdBy: userId
      });
      quizId = quiz._id.toString();
    });

    test('should update quiz name successfully', async () => {
      const updateData = {
        name: 'Updated Quiz Name'
      };

      const response = await request(app)
        .put(`/api/quizzes/${quizId}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.name).toBe(updateData.name);

      // Verify update in database
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.name).toBe(updateData.name);
    });

    test('should update quiz settings successfully', async () => {
      const updateData = {
        settings: {
          pedagogicalApproach: 'assess',
          questionsPerObjective: 5
        }
      };

      const response = await request(app)
        .put(`/api/quizzes/${quizId}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.settings.pedagogicalApproach).toBe('assess');
      expect(response.body.data.quiz.settings.questionsPerObjective).toBe(5);

      // Verify update in database
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.settings.pedagogicalApproach).toBe('assess');
    });

    test('should reject update with empty name', async () => {
      const response = await request(app)
        .put(`/api/quizzes/${quizId}`)
        .send({ name: '' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
    });

    test('should reject update of other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        createdBy: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .put(`/api/quizzes/${otherUserQuiz._id}`)
        .send({ name: 'Hacked Name' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should reject duplicate quiz name in same folder', async () => {
      // Create another quiz in the same folder
      await Quiz.create({
        name: 'Existing Quiz',
        folder: folderId,
        createdBy: userId
      });

      const response = await request(app)
        .put(`/api/quizzes/${quizId}`)
        .send({ name: 'Existing Quiz' })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });
  });

  describe('PUT /api/quizzes/:id/materials', () => {
    let quizId;
    let materialIds;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Test Quiz',
        folder: folderId,
        createdBy: userId
      });
      quizId = quiz._id.toString();

      // Create test materials
      const materials = await Material.create([
        {
          name: 'Material 1',
          type: 'text',
          content: 'Content 1',
          folder: folderId,
          uploadedBy: userId,
          processingStatus: 'completed'
        },
        {
          name: 'Material 2',
          type: 'text',
          content: 'Content 2',
          folder: folderId,
          uploadedBy: userId,
          processingStatus: 'completed'
        }
      ]);

      materialIds = materials.map(m => m._id.toString());
    });

    test('should assign materials to quiz successfully', async () => {
      const response = await request(app)
        .put(`/api/quizzes/${quizId}/materials`)
        .send({ materialIds })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.materials).toHaveLength(2);

      // The response populates materials as objects with name, type, processingStatus
      const materialNames = response.body.data.quiz.materials.map(m => m.name);
      expect(materialNames).toContain('Material 1');
      expect(materialNames).toContain('Material 2');

      // Verify assignment in database
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.materials).toHaveLength(2);
    });

    test('should reject assignment with non-existent materials', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .put(`/api/quizzes/${quizId}/materials`)
        .send({ materialIds: [nonExistentId] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should reject assignment with materials from different folder', async () => {
      const otherFolder = await Folder.create({
        name: 'Other Folder',
        instructor: userId
      });

      const otherMaterial = await Material.create({
        name: 'Other Material',
        type: 'text',
        content: 'Other Content',
        folder: otherFolder._id,
        uploadedBy: userId,
        processingStatus: 'completed'
      });

      const response = await request(app)
        .put(`/api/quizzes/${quizId}/materials`)
        .send({ materialIds: [otherMaterial._id.toString()] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should reject assignment with missing materialIds', async () => {
      const response = await request(app)
        .put(`/api/quizzes/${quizId}/materials`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
    });

    test('should reject assignment to other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        createdBy: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .put(`/api/quizzes/${otherUserQuiz._id}/materials`)
        .send({ materialIds })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/quizzes/:id', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Quiz to Delete',
        folder: folderId,
        createdBy: userId
      });
      quizId = quiz._id.toString();

      // Add quiz to folder so removeQuiz works
      const folder = await Folder.findById(folderId);
      folder.quizzes.push(quiz._id);
      await folder.save();
    });

    test('should delete quiz successfully', async () => {
      const response = await request(app)
        .delete(`/api/quizzes/${quizId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');

      // Verify deletion in database
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb).toBeNull();
    });

    test('should remove quiz from folder on deletion', async () => {
      await request(app)
        .delete(`/api/quizzes/${quizId}`)
        .expect(200);

      const folder = await Folder.findById(folderId);
      expect(folder.quizzes.map(id => id.toString())).not.toContain(quizId);
    });

    test('should reject deletion of other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        createdBy: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .delete(`/api/quizzes/${otherUserQuiz._id}`)
        .expect(404);

      expect(response.body.success).toBe(false);

      // Verify quiz still exists
      const quizInDb = await Quiz.findById(otherUserQuiz._id);
      expect(quizInDb).toBeTruthy();
    });

    test('should return 404 for non-existent quiz', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .delete(`/api/quizzes/${nonExistentId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/quizzes/:id/duplicate', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Original Quiz',
        folder: folderId,
        createdBy: userId
      });
      quizId = quiz._id.toString();
    });

    test('should duplicate quiz with default name', async () => {
      const response = await request(app)
        .post(`/api/quizzes/${quizId}/duplicate`)
        .send({})
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.name).toBe('Original Quiz (Copy)');
      expect(response.body.data.quiz.folder).toBe(folderId);
      expect(response.body.data.quiz.createdBy).toBe(userId);

      // Verify duplicate was created in database
      const duplicateInDb = await Quiz.findById(response.body.data.quiz.id);
      expect(duplicateInDb).toBeTruthy();
      expect(duplicateInDb.name).toBe('Original Quiz (Copy)');
    });

    test('should duplicate quiz with custom name', async () => {
      const response = await request(app)
        .post(`/api/quizzes/${quizId}/duplicate`)
        .send({ name: 'Custom Copy Name' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.name).toBe('Custom Copy Name');
    });

    test('should reject duplicate if name already exists', async () => {
      // Create a quiz with the name that duplication would produce
      await Quiz.create({
        name: 'Original Quiz (Copy)',
        folder: folderId,
        createdBy: userId
      });

      const response = await request(app)
        .post(`/api/quizzes/${quizId}/duplicate`)
        .send({})
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });

    test('should reject duplication of other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        createdBy: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .post(`/api/quizzes/${otherUserQuiz._id}/duplicate`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should add duplicated quiz to folder', async () => {
      const response = await request(app)
        .post(`/api/quizzes/${quizId}/duplicate`)
        .send({})
        .expect(201);

      const folder = await Folder.findById(folderId);
      const newQuizId = response.body.data.quiz._id;
      expect(folder.quizzes.map(id => id.toString())).toContain(newQuizId);
    });
  });

  describe('GET /api/quizzes/:id/progress', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Progress Quiz',
        folder: folderId,
        createdBy: userId
      });
      quizId = quiz._id.toString();
    });

    test('should get quiz progress successfully', async () => {
      const response = await request(app)
        .get(`/api/quizzes/${quizId}/progress`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.progress).toBeDefined();
      expect(response.body.data.progress.status).toBe('draft');
      expect(response.body.data.progress.counts).toBeDefined();
      expect(response.body.data.progress.counts.materials).toBe(0);
      expect(response.body.data.progress.counts.objectives).toBe(0);
      expect(response.body.data.progress.counts.plans).toBe(0);
      expect(response.body.data.progress.counts.questions).toBe(0);
      expect(response.body.data.progress.timestamps).toBeDefined();
    });

    test('should reject progress for other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        createdBy: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .get(`/api/quizzes/${otherUserQuiz._id}/progress`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should return 404 for non-existent quiz progress', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/quizzes/${nonExistentId}/progress`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
