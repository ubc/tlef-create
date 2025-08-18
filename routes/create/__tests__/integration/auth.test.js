import { describe, test, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import authController from '../../controllers/authController.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authController);

describe('SAML Authentication API Integration Tests', () => {
  beforeEach(async () => {
    // Clean users collection before each test
    await User.deleteMany({});
  });

  describe('GET /api/auth/me', () => {
    test('should return unauthenticated when no session', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(200);

      expect(response.body.authenticated).toBe(false);
    });
  });

  describe('GET /api/auth/saml/login', () => {
    test('should redirect to SAML IdP for login', async () => {
      const response = await request(app)
        .get('/api/auth/saml/login')
        .expect(302);

      // Should redirect to SAML IdP
      expect(response.header.location).toContain('simplesaml');
    });
  });

  describe('GET /api/auth/logout', () => {
    test('should redirect to login when not authenticated', async () => {
      const response = await request(app)
        .get('/api/auth/logout')
        .expect(302);

      expect(response.header.location).toContain('/login');
    });
  });

  describe('GET /api/auth/logout/callback', () => {
    test('should redirect to login after SAML logout callback', async () => {
      const response = await request(app)
        .get('/api/auth/logout/callback')
        .expect(302);

      expect(response.header.location).toContain('/login');
    });
  });
});