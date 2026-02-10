import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
// Import Question model so mongoose.model('Question') works inside Folder.updateStats
import '../../models/Question.js';
import materialController from '../../controllers/materialController.js';

// Create test app with auth middleware bypass
function createTestApp(userDoc) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userDoc;
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/api/materials', materialController);
  app.use((err, req, res, next) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

// Create unauthenticated app for 401 tests
function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/materials', materialController);
  app.use((err, req, res, next) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe('Material Management API Integration Tests', () => {
  let app;
  let unauthApp;
  let userId;
  let folderId;

  beforeEach(async () => {
    // Clean collections
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Material.deleteMany({});

    // Create test user directly in DB
    const user = await User.create({ cwlId: 'materialtest', password: 'TestPass123' });
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

  describe('POST /api/materials/text', () => {
    test('should create text material successfully', async () => {
      const materialData = {
        name: 'Test Text Material',
        content: 'This is test content for the material.',
        folderId: folderId
      };

      const response = await request(app)
        .post('/api/materials/text')
        .send(materialData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.material.name).toBe(materialData.name);
      expect(response.body.data.material.type).toBe('text');
      expect(response.body.data.material.content).toBe(materialData.content);
      expect(response.body.data.material.folder.toString()).toBe(folderId);
      expect(response.body.data.material.processingStatus).toBe('pending');

      // Verify material was created in database
      const materialInDb = await Material.findById(response.body.data.material._id);
      expect(materialInDb).toBeTruthy();
      expect(materialInDb.checksum).toBeDefined();
    });

    test('should reject text material with missing fields', async () => {
      const response = await request(app)
        .post('/api/materials/text')
        .send({
          name: 'Test Material'
          // Missing content and folderId
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Name, content, and folder ID are required');
    });

    test('should reject text material for non-existent folder', async () => {
      const nonExistentFolderId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post('/api/materials/text')
        .send({
          name: 'Test Material',
          content: 'Test content',
          folderId: nonExistentFolderId
        })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should reject duplicate text content in same folder', async () => {
      const materialData = {
        name: 'Original Material',
        content: 'Duplicate content test',
        folderId: folderId
      };

      // Create first material
      await request(app)
        .post('/api/materials/text')
        .send(materialData)
        .expect(201);

      // Try to create duplicate
      const duplicateData = {
        name: 'Duplicate Material',
        content: 'Duplicate content test', // Same content
        folderId: folderId
      };

      const response = await request(app)
        .post('/api/materials/text')
        .send(duplicateData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });
  });

  describe('POST /api/materials/url', () => {
    test('should create URL material successfully', async () => {
      const materialData = {
        name: 'Test URL Material',
        url: 'https://example.com/document.pdf',
        folderId: folderId
      };

      const response = await request(app)
        .post('/api/materials/url')
        .send(materialData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.material.name).toBe(materialData.name);
      expect(response.body.data.material.type).toBe('url');
      expect(response.body.data.material.url).toBeDefined();
      expect(response.body.data.material.folder.toString()).toBe(folderId);
      expect(response.body.data.material.processingStatus).toBe('pending');
    });

    test('should reject URL material with missing fields', async () => {
      const materialData = {
        name: 'Test Material'
        // Missing url and folderId
      };

      const response = await request(app)
        .post('/api/materials/url')
        .send(materialData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Name, URL, and folder ID are required');
    });

    test('should reject URL material with invalid URL', async () => {
      const materialData = {
        name: 'Test Material',
        url: 'not-a-valid-url',
        folderId: folderId
      };

      const response = await request(app)
        .post('/api/materials/url')
        .send(materialData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should reject duplicate URL in same folder', async () => {
      const materialData = {
        name: 'Original URL',
        url: 'https://example.com/same-document.pdf',
        folderId: folderId
      };

      // Create first material
      await request(app)
        .post('/api/materials/url')
        .send(materialData)
        .expect(201);

      // Try to create duplicate
      const duplicateData = {
        name: 'Duplicate URL',
        url: 'https://example.com/same-document.pdf', // Same URL
        folderId: folderId
      };

      const response = await request(app)
        .post('/api/materials/url')
        .send(duplicateData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });
  });

  describe('GET /api/materials/folder/:folderId', () => {
    beforeEach(async () => {
      // Create test materials
      await Material.create([
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
          type: 'url',
          url: 'https://example.com/doc.pdf',
          folder: folderId,
          uploadedBy: userId,
          processingStatus: 'pending'
        }
      ]);

      // Create material in different folder (should not be returned)
      const otherFolder = await Folder.create({
        name: 'Other Folder',
        instructor: userId
      });

      await Material.create({
        name: 'Other Material',
        type: 'text',
        content: 'Other content',
        folder: otherFolder._id,
        uploadedBy: userId,
        processingStatus: 'completed'
      });
    });

    test('should get folder materials successfully', async () => {
      const response = await request(app)
        .get(`/api/materials/folder/${folderId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.materials).toHaveLength(2);

      const materialNames = response.body.data.materials.map(m => m.name);
      expect(materialNames).toContain('Material 1');
      expect(materialNames).toContain('Material 2');
      expect(materialNames).not.toContain('Other Material');

      // Check material details
      const textMaterial = response.body.data.materials.find(m => m.type === 'text');
      expect(textMaterial.content).toBe('Content 1');
      expect(textMaterial.processingStatus).toBe('completed');
    });

    test('should reject access to other user folder', async () => {
      const otherUserFolder = await Folder.create({
        name: 'Other User Folder',
        instructor: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .get(`/api/materials/folder/${otherUserFolder._id}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/materials/:id', () => {
    let materialId;

    beforeEach(async () => {
      const material = await Material.create({
        name: 'Original Name',
        type: 'text',
        content: 'Test content',
        folder: folderId,
        uploadedBy: userId,
        processingStatus: 'completed'
      });
      materialId = material._id.toString();
    });

    test('should update material name successfully', async () => {
      const updateData = {
        name: 'Updated Name'
      };

      const response = await request(app)
        .put(`/api/materials/${materialId}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.material.name).toBe(updateData.name);

      // Verify update in database
      const materialInDb = await Material.findById(materialId);
      expect(materialInDb.name).toBe(updateData.name);
    });

    test('should reject update with empty name', async () => {
      const response = await request(app)
        .put(`/api/materials/${materialId}`)
        .send({ name: '' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should reject update of other user material', async () => {
      const otherUserMaterial = await Material.create({
        name: 'Other User Material',
        type: 'text',
        content: 'Other content',
        folder: folderId,
        uploadedBy: new mongoose.Types.ObjectId(),
        processingStatus: 'completed'
      });

      const response = await request(app)
        .put(`/api/materials/${otherUserMaterial._id}`)
        .send({ name: 'Hacked Name' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/materials/:id', () => {
    let materialId;

    beforeEach(async () => {
      const material = await Material.create({
        name: 'To Delete',
        type: 'text',
        content: 'Delete this content',
        folder: folderId,
        uploadedBy: userId,
        processingStatus: 'completed'
      });
      materialId = material._id.toString();
    });

    test('should delete material successfully', async () => {
      const response = await request(app)
        .delete(`/api/materials/${materialId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');

      // Verify deletion in database
      const materialInDb = await Material.findById(materialId);
      expect(materialInDb).toBeNull();
    });

    test('should reject deletion of other user material', async () => {
      const otherUserMaterial = await Material.create({
        name: 'Other User Material',
        type: 'text',
        content: 'Other content',
        folder: folderId,
        uploadedBy: new mongoose.Types.ObjectId(),
        processingStatus: 'completed'
      });

      const response = await request(app)
        .delete(`/api/materials/${otherUserMaterial._id}`)
        .expect(404);

      expect(response.body.success).toBe(false);

      // Verify material still exists
      const materialInDb = await Material.findById(otherUserMaterial._id);
      expect(materialInDb).toBeTruthy();
    });
  });

  describe('GET /api/materials/:id/status', () => {
    let materialId;

    beforeEach(async () => {
      const material = await Material.create({
        name: 'Status Test Material',
        type: 'text',
        content: 'Test content',
        folder: folderId,
        uploadedBy: userId,
        processingStatus: 'completed'
      });
      materialId = material._id.toString();
    });

    test('should get material processing status successfully', async () => {
      const response = await request(app)
        .get(`/api/materials/${materialId}/status`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.material.processingStatus).toBe('completed');
      expect(response.body.data.material.name).toBe('Status Test Material');
      expect(response.body.data.material.id).toBe(materialId);
    });

    test('should reject status check for other user material', async () => {
      const otherUserMaterial = await Material.create({
        name: 'Other User Material',
        type: 'text',
        content: 'Other content',
        folder: folderId,
        uploadedBy: new mongoose.Types.ObjectId(),
        processingStatus: 'completed'
      });

      const response = await request(app)
        .get(`/api/materials/${otherUserMaterial._id}/status`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should reject invalid ID format', async () => {
      const response = await request(app)
        .get('/api/materials/invalid-id/status')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
    });
  });

  describe('POST /api/materials/:id/reprocess', () => {
    let materialId;

    beforeEach(async () => {
      const material = await Material.create({
        name: 'Reprocess Test Material',
        type: 'text',
        content: 'Test content',
        folder: folderId,
        uploadedBy: userId,
        processingStatus: 'completed'
      });
      materialId = material._id.toString();
    });

    test('should trigger material reprocessing successfully', async () => {
      const response = await request(app)
        .post(`/api/materials/${materialId}/reprocess`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('reprocessing');

      // Verify status update in database
      const materialInDb = await Material.findById(materialId);
      expect(materialInDb.processingStatus).toBe('pending');
    });

    test('should reject reprocessing for other user material', async () => {
      const otherUserMaterial = await Material.create({
        name: 'Other User Material',
        type: 'text',
        content: 'Other content',
        folder: folderId,
        uploadedBy: new mongoose.Types.ObjectId(),
        processingStatus: 'completed'
      });

      const response = await request(app)
        .post(`/api/materials/${otherUserMaterial._id}/reprocess`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should reject invalid ID format', async () => {
      const response = await request(app)
        .post('/api/materials/invalid-id/reprocess')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Validation failed');
    });
  });

  describe('Authentication', () => {
    test('should reject unauthenticated request to POST /api/materials/text', async () => {
      const response = await request(unauthApp)
        .post('/api/materials/text')
        .send({
          name: 'Test',
          content: 'Test content',
          folderId: folderId
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should reject unauthenticated request to GET /api/materials/folder/:folderId', async () => {
      const response = await request(unauthApp)
        .get(`/api/materials/folder/${folderId}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/materials/processing/stats', () => {
    test('should return processing stats', async () => {
      const res = await request(app).get('/api/materials/processing/stats');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats).toBeDefined();
    });

    test('should reject unauthenticated request', async () => {
      const res = await request(unauthApp).get('/api/materials/processing/stats');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/materials/processing/cleanup', () => {
    test('should return cleanup count', async () => {
      const res = await request(app)
        .post('/api/materials/processing/cleanup')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.cleaned).toBe('number');
    });

    test('should reject unauthenticated request', async () => {
      const res = await request(unauthApp)
        .post('/api/materials/processing/cleanup')
        .send({});
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/materials/:materialId/preview', () => {
    test('should return 404 for non-existent material', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).get(`/api/materials/${fakeId}/preview`);
      expect(res.status).toBe(404);
    });

    test('should return 403 for material in folder owned by another user', async () => {
      // Create material in a folder owned by another user
      const otherUser = await User.create({ cwlId: 'otherpreview', password: 'TestPass123' });
      const otherFolder = await Folder.create({
        name: 'Other Folder', instructor: otherUser._id
      });
      const material = await Material.create({
        name: 'Other Material',
        type: 'text',
        content: 'Secret content',
        folder: otherFolder._id,
        uploadedBy: otherUser._id,
        processingStatus: 'completed'
      });

      const res = await request(app).get(`/api/materials/${material._id}/preview`);
      expect(res.status).toBe(403);
    });

    test('should reject unauthenticated request', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(unauthApp).get(`/api/materials/${fakeId}/preview`);
      expect(res.status).toBe(401);
    });
  });
});
