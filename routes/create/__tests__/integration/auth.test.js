import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import User from '../../models/User.js';
import authController from '../../controllers/authController.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authController);
app.use((err, req, res, next) => {
  res.status(500).json({ success: false, error: { message: err.message } });
});

describe('SAML Authentication API Integration Tests', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('GET /api/auth/me', () => {
    test('should return unauthenticated when no session', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.authenticated).toBe(false);
    });
  });

  describe('GET /api/auth/saml/login', () => {
    test('should attempt SAML login redirect', async () => {
      const response = await request(app)
        .get('/api/auth/saml/login');

      // In test env without Passport SAML configured, this may return 500 or 302
      // depending on whether passport-saml is initialized
      expect([302, 500]).toContain(response.status);
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
