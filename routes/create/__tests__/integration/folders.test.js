import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import folderController from '../../controllers/folderController.js';
import authController from '../../controllers/authController.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authController);
app.use('/api/folders', folderController);

describe('Folder Management API Integration Tests', () => {
  let authToken;
  let userId;

  beforeEach(async () => {
    // Clean collections
    await User.deleteMany({});
    await Folder.deleteMany({});

    // Create and authenticate test user
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        cwlId: 'foldertest',
        password: 'TestPass123'
      });

    authToken = registerResponse.body.data.accessToken;
    userId = registerResponse.body.data.user.id;
  });

  describe('POST /api/folders', () => {
    test('should create a new folder successfully', async () => {
      const folderData = {
        name: 'Test Folder'
      };

      const response = await request(app)
        .post('/api/folders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(folderData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.folder.name).toBe(folderData.name);
      expect(response.body.data.folder.instructor).toBe(userId);
      expect(response.body.data.folder.materials).toEqual([]);

      // Verify folder was created in database
      const folderInDb = await Folder.findById(response.body.data.folder.id);
      expect(folderInDb).toBeTruthy();
      expect(folderInDb.name).toBe(folderData.name);
    });

    test('should reject folder creation with missing name', async () => {
      const response = await request(app)
        .post('/api/folders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('required');
    });

    test('should reject folder creation without authentication', async () => {
      const folderData = {
        name: 'Test Folder'
      };

      const response = await request(app)
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
        .set('Authorization', `Bearer ${authToken}`)
        .send(folderData)
        .expect(201);

      // Try to create duplicate
      const response = await request(app)
        .post('/api/folders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(folderData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });
  });

  describe('GET /api/folders', () => {
    beforeEach(async () => {
      // Create test folders
      await Folder.create([
        { name: 'Folder 1', instructor: userId },
        { name: 'Folder 2', instructor: userId },
        { name: 'Other User Folder', instructor: new mongoose.Types.ObjectId() }
      ]);
    });

    test('should get user folders successfully', async () => {
      const response = await request(app)
        .get('/api/folders')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.folders).toHaveLength(2);
      expect(response.body.data.folders[0].name).toBeDefined();
      expect(response.body.data.folders[0].instructor).toBe(userId);

      // Should not include other user's folder
      const folderNames = response.body.data.folders.map(f => f.name);
      expect(folderNames).not.toContain('Other User Folder');
    });

    test('should reject request without authentication', async () => {
      const response = await request(app)
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
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.folder.id).toBe(folderId);
      expect(response.body.data.folder.name).toBe('Test Folder');
      expect(response.body.data.folder.instructor).toBe(userId);
    });

    test('should reject access to other user folder', async () => {
      const otherUserFolder = await Folder.create({
        name: 'Other User Folder',
        instructor: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .get(`/api/folders/${otherUserFolder._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should return 404 for non-existent folder', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/folders/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should reject invalid folder ID format', async () => {
      const response = await request(app)
        .get('/api/folders/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Hacked Name' })
        .expect(404);

      expect(response.body.success).toBe(false);
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
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');

      // Verify deletion in database
      const folderInDb = await Folder.findById(folderId);
      expect(folderInDb).toBeNull();
    });

    test('should reject deletion of other user folder', async () => {
      const otherUserFolder = await Folder.create({
        name: 'Other User Folder',
        instructor: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .delete(`/api/folders/${otherUserFolder._id}`)
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});