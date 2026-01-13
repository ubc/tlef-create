import { describe, test, expect, jest } from '@jest/globals';
import { asyncHandler } from '../../utils/asyncHandler.js';

describe('AsyncHandler Utility', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  test('should call next with error when async function throws', async () => {
    const error = new Error('Test error');
    const asyncFn = async () => {
      throw error;
    };

    const wrappedFn = asyncHandler(asyncFn);
    await wrappedFn(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  test('should not call next when async function succeeds', async () => {
    const asyncFn = async (req, res) => {
      res.json({ success: true });
    };

    const wrappedFn = asyncHandler(asyncFn);
    await wrappedFn(mockReq, mockRes, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.json).toHaveBeenCalledWith({ success: true });
  });

  test('should handle synchronous errors', async () => {
    const error = new Error('Sync error');
    const syncFn = () => {
      throw error;
    };

    const wrappedFn = asyncHandler(syncFn);
    await wrappedFn(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  test('should pass through request, response, and next parameters', async () => {
    const asyncFn = jest.fn().mockResolvedValue(undefined);

    const wrappedFn = asyncHandler(asyncFn);
    await wrappedFn(mockReq, mockRes, mockNext);

    expect(asyncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
  });
});