import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Quiz from '../../models/Quiz.js';
import Material from '../../models/Material.js';
import quizController from '../../controllers/quizController.js';
import authController from '../../controllers/authController.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authController);
app.use('/api/quizzes', quizController);

describe('Quiz Management API Integration Tests', () => {
  let authToken;
  let userId;
  let folderId;

  beforeEach(async () => {
    // Clean collections
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Quiz.deleteMany({});
    await Material.deleteMany({});

    // Create and authenticate test user
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        cwlId: 'quiztest',
        password: 'TestPass123'
      });

    authToken = registerResponse.body.data.accessToken;
    userId = registerResponse.body.data.user.id;

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
        .set('Authorization', `Bearer ${authToken}`)
        .send(quizData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.name).toBe(quizData.name);
      expect(response.body.data.quiz.folder).toBe(folderId);
      expect(response.body.data.quiz.instructor).toBe(userId);
      expect(response.body.data.quiz.status).toBe('DRAFT');
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
        .set('Authorization', `Bearer ${authToken}`)
        .send({ folderId: folderId })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('required');
    });

    test('should reject quiz creation for non-existent folder', async () => {
      const nonExistentFolderId = new mongoose.Types.ObjectId();
      
      const response = await request(app)
        .post('/api/quizzes')
        .set('Authorization', `Bearer ${authToken}`)
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

      const response = await request(app)
        .post('/api/quizzes')
        .send(quizData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/quizzes/folder/:folderId', () => {
    beforeEach(async () => {
      // Create test quizzes
      await Quiz.create([
        {
          name: 'Quiz 1',
          folder: folderId,
          instructor: userId,
          status: 'DRAFT'
        },
        {
          name: 'Quiz 2',
          folder: folderId,
          instructor: userId,
          status: 'PUBLISHED'
        }
      ]);

      // Create quiz in different folder (should not be returned)
      const otherFolder = await Folder.create({
        name: 'Other Folder',
        instructor: userId
      });

      await Quiz.create({
        name: 'Other Quiz',
        folder: otherFolder._id,
        instructor: userId,
        status: 'DRAFT'
      });
    });

    test('should get folder quizzes successfully', async () => {
      const response = await request(app)
        .get(`/api/quizzes/folder/${folderId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quizzes).toHaveLength(2);
      
      const quizNames = response.body.data.quizzes.map(q => q.name);
      expect(quizNames).toContain('Quiz 1');
      expect(quizNames).toContain('Quiz 2');
      expect(quizNames).not.toContain('Other Quiz');

      // Check quiz details
      const draftQuiz = response.body.data.quizzes.find(q => q.status === 'DRAFT');
      expect(draftQuiz.name).toBe('Quiz 1');
      expect(draftQuiz.folder).toBe(folderId);
    });

    test('should reject access to other user folder', async () => {
      const otherUserFolder = await Folder.create({
        name: 'Other User Folder',
        instructor: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .get(`/api/quizzes/folder/${otherUserFolder._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/quizzes/:id', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Test Quiz',
        folder: folderId,
        instructor: userId,
        status: 'DRAFT'
      });
      quizId = quiz._id.toString();
    });

    test('should get quiz by ID successfully', async () => {
      const response = await request(app)
        .get(`/api/quizzes/${quizId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.id).toBe(quizId);
      expect(response.body.data.quiz.name).toBe('Test Quiz');
      expect(response.body.data.quiz.folder).toBe(folderId);
      expect(response.body.data.quiz.instructor).toBe(userId);
    });

    test('should reject access to other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        instructor: new mongoose.Types.ObjectId(),
        status: 'DRAFT'
      });

      const response = await request(app)
        .get(`/api/quizzes/${otherUserQuiz._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should return 404 for non-existent quiz', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/quizzes/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/quizzes/:id', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Original Quiz Name',
        folder: folderId,
        instructor: userId,
        status: 'DRAFT'
      });
      quizId = quiz._id.toString();
    });

    test('should update quiz successfully', async () => {
      const updateData = {
        name: 'Updated Quiz Name',
        settings: {
          pedagogicalApproach: 'CONSTRUCTIVIST',
          questionsPerObjective: 3
        }
      };

      const response = await request(app)
        .put(`/api/quizzes/${quizId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.name).toBe(updateData.name);
      expect(response.body.data.quiz.settings.pedagogicalApproach).toBe('CONSTRUCTIVIST');
      expect(response.body.data.quiz.settings.questionsPerObjective).toBe(3);

      // Verify update in database
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.name).toBe(updateData.name);
      expect(quizInDb.settings.pedagogicalApproach).toBe('CONSTRUCTIVIST');
    });

    test('should reject update with empty name', async () => {
      const response = await request(app)
        .put(`/api/quizzes/${quizId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should reject update of other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        instructor: new mongoose.Types.ObjectId(),
        status: 'DRAFT'
      });

      const response = await request(app)
        .put(`/api/quizzes/${otherUserQuiz._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Hacked Name' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/quizzes/:id/materials', () => {
    let quizId;
    let materialIds;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Test Quiz',
        folder: folderId,
        instructor: userId,
        status: 'DRAFT'
      });
      quizId = quiz._id.toString();

      // Create test materials
      const materials = await Material.create([
        {
          name: 'Material 1',
          type: 'TEXT',
          content: 'Content 1',
          folder: folderId,
          uploadedBy: userId,
          processingStatus: 'COMPLETED'
        },
        {
          name: 'Material 2',
          type: 'TEXT',
          content: 'Content 2',
          folder: folderId,
          uploadedBy: userId,
          processingStatus: 'COMPLETED'
        }
      ]);

      materialIds = materials.map(m => m._id.toString());
    });

    test('should assign materials to quiz successfully', async () => {
      const response = await request(app)
        .post(`/api/quizzes/${quizId}/materials`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ materialIds })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.materials).toHaveLength(2);
      expect(response.body.data.quiz.materials).toEqual(
        expect.arrayContaining(materialIds)
      );

      // Verify assignment in database
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.materials).toHaveLength(2);
    });

    test('should reject assignment with empty materials array', async () => {
      const response = await request(app)
        .post(`/api/quizzes/${quizId}/materials`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ materialIds: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should reject assignment with non-existent materials', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .post(`/api/quizzes/${quizId}/materials`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ materialIds: [nonExistentId] })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });
  });

  describe('DELETE /api/quizzes/:id', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Quiz to Delete',
        folder: folderId,
        instructor: userId,
        status: 'DRAFT'
      });
      quizId = quiz._id.toString();
    });

    test('should delete quiz successfully', async () => {
      const response = await request(app)
        .delete(`/api/quizzes/${quizId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');

      // Verify deletion in database
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb).toBeNull();
    });

    test('should reject deletion of published quiz', async () => {
      // Update quiz to published status
      await Quiz.findByIdAndUpdate(quizId, { status: 'PUBLISHED' });

      const response = await request(app)
        .delete(`/api/quizzes/${quizId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('published');

      // Verify quiz still exists
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb).toBeTruthy();
    });

    test('should reject deletion of other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        instructor: new mongoose.Types.ObjectId(),
        status: 'DRAFT'
      });

      const response = await request(app)
        .delete(`/api/quizzes/${otherUserQuiz._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);

      // Verify quiz still exists
      const quizInDb = await Quiz.findById(otherUserQuiz._id);
      expect(quizInDb).toBeTruthy();
    });
  });

  describe('POST /api/quizzes/:id/publish', () => {
    let quizId;

    beforeEach(async () => {
      const quiz = await Quiz.create({
        name: 'Quiz to Publish',
        folder: folderId,
        instructor: userId,
        status: 'DRAFT'
      });
      quizId = quiz._id.toString();
    });

    test('should publish quiz successfully', async () => {
      const response = await request(app)
        .post(`/api/quizzes/${quizId}/publish`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.quiz.status).toBe('PUBLISHED');
      expect(response.body.data.quiz.publishedAt).toBeDefined();

      // Verify status update in database
      const quizInDb = await Quiz.findById(quizId);
      expect(quizInDb.status).toBe('PUBLISHED');
      expect(quizInDb.publishedAt).toBeDefined();
    });

    test('should reject publishing already published quiz', async () => {
      // First publish
      await request(app)
        .post(`/api/quizzes/${quizId}/publish`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Try to publish again
      const response = await request(app)
        .post(`/api/quizzes/${quizId}/publish`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already published');
    });

    test('should reject publishing other user quiz', async () => {
      const otherUserQuiz = await Quiz.create({
        name: 'Other User Quiz',
        folder: folderId,
        instructor: new mongoose.Types.ObjectId(),
        status: 'DRAFT'
      });

      const response = await request(app)
        .post(`/api/quizzes/${otherUserQuiz._id}/publish`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});