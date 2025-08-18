import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import materialController from '../../controllers/materialController.js';
import authController from '../../controllers/authController.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authController);
app.use('/api/materials', materialController);

describe('Material Management API Integration Tests', () => {
  let authToken;
  let userId;
  let folderId;

  beforeEach(async () => {
    // Clean collections
    await User.deleteMany({});
    await Folder.deleteMany({});
    await Material.deleteMany({});

    // Create and authenticate test user
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        cwlId: 'materialtest',
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

  describe('POST /api/materials/text', () => {
    test('should create text material successfully', async () => {
      const materialData = {
        name: 'Test Text Material',
        content: 'This is test content for the material.',
        folderId: folderId
      };

      const response = await request(app)
        .post('/api/materials/text')
        .set('Authorization', `Bearer ${authToken}`)
        .send(materialData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.material.name).toBe(materialData.name);
      expect(response.body.data.material.type).toBe('TEXT');
      expect(response.body.data.material.content).toBe(materialData.content);
      expect(response.body.data.material.folder).toBe(folderId);
      expect(response.body.data.material.processingStatus).toBe('COMPLETED');

      // Verify material was created in database
      const materialInDb = await Material.findById(response.body.data.material.id);
      expect(materialInDb).toBeTruthy();
      expect(materialInDb.checksum).toBeDefined();
    });

    test('should reject text material with missing fields', async () => {
      const response = await request(app)
        .post('/api/materials/text')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Material'
          // Missing content and folderId
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('required');
    });

    test('should reject text material for non-existent folder', async () => {
      const nonExistentFolderId = new mongoose.Types.ObjectId();
      
      const response = await request(app)
        .post('/api/materials/text')
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
        .send(materialData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.material.name).toBe(materialData.name);
      expect(response.body.data.material.type).toBe('URL');
      expect(response.body.data.material.url).toBe(materialData.url);
      expect(response.body.data.material.folder).toBe(folderId);
      expect(response.body.data.material.processingStatus).toBe('PENDING');
    });

    test('should reject URL material with invalid URL', async () => {
      const materialData = {
        name: 'Test Material',
        url: 'not-a-valid-url',
        folderId: folderId
      };

      const response = await request(app)
        .post('/api/materials/url')
        .set('Authorization', `Bearer ${authToken}`)
        .send(materialData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Invalid');
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
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
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
          type: 'TEXT',
          content: 'Content 1',
          folder: folderId,
          uploadedBy: userId,
          processingStatus: 'COMPLETED'
        },
        {
          name: 'Material 2',
          type: 'URL',
          url: 'https://example.com/doc.pdf',
          folder: folderId,
          uploadedBy: userId,
          processingStatus: 'PENDING'
        }
      ]);

      // Create material in different folder (should not be returned)
      const otherFolder = await Folder.create({
        name: 'Other Folder',
        instructor: userId
      });

      await Material.create({
        name: 'Other Material',
        type: 'TEXT',
        content: 'Other content',
        folder: otherFolder._id,
        uploadedBy: userId,
        processingStatus: 'COMPLETED'
      });
    });

    test('should get folder materials successfully', async () => {
      const response = await request(app)
        .get(`/api/materials/folder/${folderId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.materials).toHaveLength(2);
      
      const materialNames = response.body.data.materials.map(m => m.name);
      expect(materialNames).toContain('Material 1');
      expect(materialNames).toContain('Material 2');
      expect(materialNames).not.toContain('Other Material');

      // Check material details
      const textMaterial = response.body.data.materials.find(m => m.type === 'TEXT');
      expect(textMaterial.content).toBe('Content 1');
      expect(textMaterial.processingStatus).toBe('COMPLETED');
    });

    test('should reject access to other user folder', async () => {
      const otherUserFolder = await Folder.create({
        name: 'Other User Folder',
        instructor: new mongoose.Types.ObjectId()
      });

      const response = await request(app)
        .get(`/api/materials/folder/${otherUserFolder._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/materials/:id', () => {
    let materialId;

    beforeEach(async () => {
      const material = await Material.create({
        name: 'Original Name',
        type: 'TEXT',
        content: 'Test content',
        folder: folderId,
        uploadedBy: userId,
        processingStatus: 'COMPLETED'
      });
      materialId = material._id.toString();
    });

    test('should update material name successfully', async () => {
      const updateData = {
        name: 'Updated Name'
      };

      const response = await request(app)
        .put(`/api/materials/${materialId}`)
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should reject update of other user material', async () => {
      const otherUserMaterial = await Material.create({
        name: 'Other User Material',
        type: 'TEXT',
        content: 'Other content',
        folder: folderId,
        uploadedBy: new mongoose.Types.ObjectId(),
        processingStatus: 'COMPLETED'
      });

      const response = await request(app)
        .put(`/api/materials/${otherUserMaterial._id}`)
        .set('Authorization', `Bearer ${authToken}`)
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
        type: 'TEXT',
        content: 'Delete this content',
        folder: folderId,
        uploadedBy: userId,
        processingStatus: 'COMPLETED'
      });
      materialId = material._id.toString();
    });

    test('should delete material successfully', async () => {
      const response = await request(app)
        .delete(`/api/materials/${materialId}`)
        .set('Authorization', `Bearer ${authToken}`)
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
        type: 'TEXT',
        content: 'Other content',
        folder: folderId,
        uploadedBy: new mongoose.Types.ObjectId(),
        processingStatus: 'COMPLETED'
      });

      const response = await request(app)
        .delete(`/api/materials/${otherUserMaterial._id}`)
        .set('Authorization', `Bearer ${authToken}`)
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
        type: 'TEXT',
        content: 'Test content',
        folder: folderId,
        uploadedBy: userId,
        processingStatus: 'COMPLETED'
      });
      materialId = material._id.toString();
    });

    test('should get material processing status successfully', async () => {
      const response = await request(app)
        .get(`/api/materials/${materialId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.material.processingStatus).toBe('COMPLETED');
      expect(response.body.data.material.name).toBe('Status Test Material');
      expect(response.body.data.material.id).toBe(materialId);
    });

    test('should reject status check for other user material', async () => {
      const otherUserMaterial = await Material.create({
        name: 'Other User Material',
        type: 'TEXT',
        content: 'Other content',
        folder: folderId,
        uploadedBy: new mongoose.Types.ObjectId(),
        processingStatus: 'COMPLETED'
      });

      const response = await request(app)
        .get(`/api/materials/${otherUserMaterial._id}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/materials/:id/reprocess', () => {
    let materialId;

    beforeEach(async () => {
      const material = await Material.create({
        name: 'Reprocess Test Material',
        type: 'TEXT',
        content: 'Test content',
        folder: folderId,
        uploadedBy: userId,
        processingStatus: 'COMPLETED'
      });
      materialId = material._id.toString();
    });

    test('should trigger material reprocessing successfully', async () => {
      const response = await request(app)
        .post(`/api/materials/${materialId}/reprocess`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('reprocessing triggered');
      expect(response.body.data.material.processingStatus).toBe('PENDING');

      // Verify status update in database
      const materialInDb = await Material.findById(materialId);
      expect(materialInDb.processingStatus).toBe('PENDING');
    });

    test('should reject reprocessing for other user material', async () => {
      const otherUserMaterial = await Material.create({
        name: 'Other User Material',
        type: 'TEXT',
        content: 'Other content',
        folder: folderId,
        uploadedBy: new mongoose.Types.ObjectId(),
        processingStatus: 'COMPLETED'
      });

      const response = await request(app)
        .post(`/api/materials/${otherUserMaterial._id}/reprocess`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});