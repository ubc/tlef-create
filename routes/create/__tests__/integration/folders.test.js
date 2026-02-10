import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Quiz from '../../models/Quiz.js';
import Question from '../../models/Question.js';
import folderController from '../../controllers/folderController.js';

// Create test app with auth middleware bypass
// userDoc should be a Mongoose User document (like Passport deserializeUser provides)
function createTestApp(userDoc) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    // Set req.user to the Mongoose document, same as Passport would
    req.user = userDoc;
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/api/folders', folderController);
  app.use((err, req, res, next) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

// Create unauthenticated app for 401 tests
function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/folders', folderController);
  app.use((err, req, res, next) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe('Folder Management API Integration Tests', () => {
  let app;
  let unauthApp;
  let userId;

  beforeEach(async () => {
    // Clean collections
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Quiz.deleteMany({});
    await Question.deleteMany({});

    // Create test user directly in DB
    const user = await User.create({ cwlId: 'foldertest', password: 'TestPass123' });
    userId = user._id.toString();

    // Create apps - pass Mongoose user document so authenticateToken sets fullUser correctly
    app = createTestApp(user);
    unauthApp = createUnauthApp();
  });

  describe('POST /api/folders', () => {
    test('should create a new folder with auto-generated quizzes', async () => {
      const folderData = {
        name: 'Test Folder'
      };

      const response = await request(app)
        .post('/api/folders')
        .send(folderData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Folder created successfully with quizzes');
      expect(response.body.data.folder.name).toBe(folderData.name);
      expect(response.body.data.folder.instructor.toString()).toBe(userId);

      // Default quizCount is 1, so there should be 1 auto-generated quiz
      expect(response.body.data.folder.quizzes).toHaveLength(1);
      expect(response.body.data.folder.quizzes[0].name).toBe('Quiz 1');
      expect(response.body.data.folder.quizzes[0].status).toBe('draft');

      // Verify folder was created in database
      const folderInDb = await Folder.findById(response.body.data.folder._id);
      expect(folderInDb).toBeTruthy();
      expect(folderInDb.name).toBe(folderData.name);
      expect(folderInDb.quizzes).toHaveLength(1);

      // Verify quiz was created in database
      const quizInDb = await Quiz.findById(folderInDb.quizzes[0]);
      expect(quizInDb).toBeTruthy();
      expect(quizInDb.name).toBe('Quiz 1');
      expect(quizInDb.folder.toString()).toBe(folderInDb._id.toString());
      expect(quizInDb.createdBy.toString()).toBe(userId);
    });

    test('should create folder with multiple quizzes when quizCount specified', async () => {
      const folderData = {
        name: 'Multi Quiz Folder',
        quizCount: 3
      };

      const response = await request(app)
        .post('/api/folders')
        .send(folderData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.folder.quizzes).toHaveLength(3);
      expect(response.body.data.folder.quizzes[0].name).toBe('Quiz 1');
      expect(response.body.data.folder.quizzes[1].name).toBe('Quiz 2');
      expect(response.body.data.folder.quizzes[2].name).toBe('Quiz 3');
    });

    test('should reject folder creation with missing name', async () => {
      const response = await request(app)
        .post('/api/folders')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
      expect(response.body.error.details).toBeDefined();
      expect(response.body.error.details.length).toBeGreaterThan(0);
    });

    test('should reject folder creation without authentication', async () => {
      const folderData = {
        name: 'Test Folder'
      };

      const response = await request(unauthApp)
        .post('/api/folders')
        .send(folderData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should reject folder creation with duplicate name for same user', async () => {
      const folderData = {
        name: 'Duplicate Folder'
      };

      // Create first folder
      await request(app)
        .post('/api/folders')
        .send(folderData)
        .expect(201);

      // Try to create duplicate
      const response = await request(app)
        .post('/api/folders')
        .send(folderData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });
  });

  describe('GET /api/folders', () => {
    beforeEach(async () => {
      // Create test folders directly in DB
      await Folder.create([
        { name: 'Folder 1', instructor: userId },
        { name: 'Folder 2', instructor: userId },
        { name: 'Other User Folder', instructor: new mongoose.Types.ObjectId() }
      ]);
    });

    test('should get user folders successfully', async () => {
      const response = await request(app)
        .get('/api/folders')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.folders).toHaveLength(2);
      expect(response.body.data.folders[0].name).toBeDefined();

      // Should not include other user's folder
      const folderNames = response.body.data.folders.map(f => f.name);
      expect(folderNames).not.toContain('Other User Folder');
    });

    test('should reject request without authentication', async () => {
      const response = await request(unauthApp)
        .get('/api/folders')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/folders/:id', () => {
    let folderId;

    beforeEach(async () => {
      const folder = await Folder.create({
        name: 'Test Folder',
        instructor: userId
      });
      folderId = folder._id.toString();
    });

    test('should get folder by ID successfully', async () => {
      const response = await request(app)
        .get(`/api/folders/${folderId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.folder._id).toBe(folderId);
      expect(response.body.data.folder.name).toBe('Test Folder');
    });

    test('should reject access to other user folder', async () => {
      const otherUserFolder = await Folder.create({
        name: 'Other User Folder',
        instructor: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .get(`/api/folders/${otherUserFolder._id}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should return 404 for non-existent folder', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/folders/${nonExistentId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should reject invalid folder ID format', async () => {
      const response = await request(app)
        .get('/api/folders/invalid-id')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/folders/:id', () => {
    let folderId;

    beforeEach(async () => {
      const folder = await Folder.create({
        name: 'Original Name',
        instructor: userId
      });
      folderId = folder._id.toString();
    });

    test('should update folder name successfully', async () => {
      const updateData = {
        name: 'Updated Name'
      };

      const response = await request(app)
        .put(`/api/folders/${folderId}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.folder.name).toBe(updateData.name);

      // Verify update in database
      const folderInDb = await Folder.findById(folderId);
      expect(folderInDb.name).toBe(updateData.name);
    });

    test('should reject update with empty name', async () => {
      const response = await request(app)
        .put(`/api/folders/${folderId}`)
        .send({ name: '' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should reject update of other user folder', async () => {
      const otherUserFolder = await Folder.create({
        name: 'Other User Folder',
        instructor: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .put(`/api/folders/${otherUserFolder._id}`)
        .send({ name: 'Hacked Name' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should reject update with duplicate name for same user', async () => {
      // Create a second folder
      await Folder.create({
        name: 'Existing Folder',
        instructor: userId
      });

      // Try to rename first folder to the same name as second
      const response = await request(app)
        .put(`/api/folders/${folderId}`)
        .send({ name: 'Existing Folder' })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });
  });

  describe('DELETE /api/folders/:id', () => {
    let folderId;

    beforeEach(async () => {
      const folder = await Folder.create({
        name: 'To Delete',
        instructor: userId
      });
      folderId = folder._id.toString();
    });

    test('should delete folder successfully', async () => {
      const response = await request(app)
        .delete(`/api/folders/${folderId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');
      expect(response.body.data.folderId).toBe(folderId);
      expect(response.body.data.folderName).toBe('To Delete');
      expect(response.body.data.deletedCounts).toBeDefined();

      // Verify deletion in database
      const folderInDb = await Folder.findById(folderId);
      expect(folderInDb).toBeNull();
    });

    test('should cascade delete quizzes when deleting folder', async () => {
      // Create a folder with quizzes via the API
      const createResponse = await request(app)
        .post('/api/folders')
        .send({ name: 'Folder With Quizzes', quizCount: 2 })
        .expect(201);

      const folderWithQuizzesId = createResponse.body.data.folder._id;
      const quizIds = createResponse.body.data.folder.quizzes.map(q => q._id);

      // Verify quizzes exist
      expect(await Quiz.countDocuments({ _id: { $in: quizIds } })).toBe(2);

      // Delete the folder
      const deleteResponse = await request(app)
        .delete(`/api/folders/${folderWithQuizzesId}`)
        .expect(200);

      expect(deleteResponse.body.success).toBe(true);

      // Verify folder and quizzes are deleted
      expect(await Folder.findById(folderWithQuizzesId)).toBeNull();
      expect(await Quiz.countDocuments({ _id: { $in: quizIds } })).toBe(0);
    });

    test('should reject deletion of other user folder', async () => {
      const otherUserFolder = await Folder.create({
        name: 'Other User Folder',
        instructor: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .delete(`/api/folders/${otherUserFolder._id}`)
        .expect(404);

      expect(response.body.success).toBe(false);

      // Verify folder still exists
      const folderInDb = await Folder.findById(otherUserFolder._id);
      expect(folderInDb).toBeTruthy();
    });

    test('should return 404 for non-existent folder', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .delete(`/api/folders/${nonExistentId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
