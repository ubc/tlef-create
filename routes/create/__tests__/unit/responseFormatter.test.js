import { describe, test, expect, jest } from '@jest/globals';
import { successResponse, errorResponse, notFoundResponse, unauthorizedResponse } from '../../utils/responseFormatter.js';

describe('Response Formatter Utils', () => {
  let mockRes;

  beforeEach(() => {
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  describe('successResponse', () => {
    test('should return success response with default status 200', () => {
      const data = { user: { id: 1, name: 'Test' } };
      const message = 'Success';

      successResponse(mockRes, data, message);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data,
        message,
        timestamp: expect.any(String)
      });
    });

    test('should return success response with custom status', () => {
      const data = { user: { id: 1 } };
      const message = 'Created';
      const status = 201;

      successResponse(mockRes, data, message, status);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data,
        message,
        timestamp: expect.any(String)
      });
    });

    test('should handle null data', () => {
      successResponse(mockRes, null, 'Success');

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: null,
        message: 'Success',
        timestamp: expect.any(String)
      });
    });
  });

  describe('errorResponse', () => {
    test('should return error response with default values', () => {
      const message = 'Something went wrong';

      errorResponse(mockRes, message);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message,
          timestamp: expect.any(String)
        }
      });
    });

    test('should return error response with custom values', () => {
      const message = 'Validation failed';
      const code = 'VALIDATION_ERROR';
      const status = 400;
      const details = [{ field: 'email', message: 'Required' }];

      errorResponse(mockRes, message, code, status, details);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code,
          message,
          details,
          timestamp: expect.any(String)
        }
      });
    });
  });

  describe('notFoundResponse', () => {
    test('should return 404 not found response', () => {
      const resource = 'User';

      notFoundResponse(mockRes, resource);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
          timestamp: expect.any(String)
        }
      });
    });
  });

  describe('unauthorizedResponse', () => {
    test('should return 401 unauthorized response', () => {
      const message = 'Invalid credentials';

      unauthorizedResponse(mockRes, message);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message,
          timestamp: expect.any(String)
        }
      });
    });

    test('should use default message when none provided', () => {
      unauthorizedResponse(mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Unauthorized',
          timestamp: expect.any(String)
        }
      });
    });
  });
});