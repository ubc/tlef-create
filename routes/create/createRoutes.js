import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { RATE_LIMITS, HTTP_STATUS, ERROR_CODES } from './config/constants.js';
import { errorResponse } from './utils/responseFormatter.js';

// Import controllers
// NOTE: authController is mounted at root level in server.js for SAML compatibility
import folderController from './controllers/folderController.js';
import materialController from './controllers/materialController.js';
import quizController from './controllers/quizController.js';
import objectiveController from './controllers/objectiveController.js';
import planController from './controllers/planController.js';
import questionController from './controllers/questionController.js';
import exportController from './controllers/exportController.js';
import streamingController from './controllers/streamingController.js';
import searchController from './controllers/searchController.js';

const router = express.Router();

// Security middleware
router.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.AUTH.windowMs,
  max: RATE_LIMITS.AUTH.max,
  message: {
    error: {
      code: ERROR_CODES.AUTH_ERROR,
      message: 'Too many authentication attempts, please try again later',
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: RATE_LIMITS.API.windowMs,
  max: RATE_LIMITS.API.max,
  message: {
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Too many requests, please try again later',
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

const uploadLimiter = rateLimit({
  windowMs: RATE_LIMITS.UPLOAD.windowMs,
  max: RATE_LIMITS.UPLOAD.max,
  message: {
    error: {
      code: ERROR_CODES.FILE_UPLOAD_ERROR,
      message: 'Too many upload attempts, please try again later',
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiting
router.use('/auth/saml/login', authLimiter);
router.use('/materials/upload', uploadLimiter);
// Apply API rate limiting to all routes except config and streaming endpoints
router.use((req, res, next) => {
  if (req.path === '/auth/config' || req.path.startsWith('/streaming/')) {
    return next(); // Skip rate limiting for config and streaming endpoints
  }
  return apiLimiter(req, res, next);
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(HTTP_STATUS.OK).json({
    status: 'healthy',
    service: 'TLEF-CREATE API',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Mount route controllers
// NOTE: '/auth' is mounted at root level in server.js for SAML compatibility
router.use('/folders', folderController);
router.use('/materials', materialController);
router.use('/quizzes', quizController);
router.use('/objectives', objectiveController);
router.use('/plans', planController);
router.use('/questions', questionController);
router.use('/export', exportController);
router.use('/streaming', streamingController);
router.use('/search', searchController);

// DEBUG: Route to log all chunks in Qdrant (for debugging purposes)
router.get('/debug/qdrant-chunks', async (req, res) => {
  try {
    const { default: ragService } = await import('./services/ragService.js');
    const limit = parseInt(req.query.limit) || 50;

    console.log(`\n🔍 Debug request: Retrieving ${limit} chunks from Qdrant...\n`);

    const results = await ragService.debugLogAllChunks(limit);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      totalChunks: results?.length || 0,
      message: 'Check server console for detailed output',
      chunks: results ? results.map((r, idx) => ({
        index: idx + 1,
        metadata: r.metadata,
        contentLength: (r.content || r.pageContent || r.text || '').length,
        contentPreview: (r.content || r.pageContent || r.text || '').substring(0, 100)
      })) : []
    });
  } catch (error) {
    console.error('❌ Debug endpoint error:', error);
    return errorResponse(
      res,
      `Failed to retrieve chunks: ${error.message}`,
      ERROR_CODES.INTERNAL_SERVER_ERROR,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
});

// DEBUG: Route to clear all chunks from Qdrant (use with caution!)
router.post('/debug/qdrant-clear', async (req, res) => {
  try {
    console.log('\n🗑️ Clearing all chunks from Qdrant collection...\n');

    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    const qdrantApiKey = process.env.QDRANT_API_KEY;
    const collectionName = 'quiz-materials';

    const headers = {
      'Content-Type': 'application/json'
    };

    if (qdrantApiKey) {
      headers['api-key'] = qdrantApiKey;
    }

    // Delete the entire collection
    const deleteUrl = `${qdrantUrl}/collections/${collectionName}`;
    console.log(`🔄 Making DELETE request to: ${deleteUrl}`);

    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: headers
    });

    if (!deleteResponse.ok) {
      throw new Error(`Failed to delete collection: ${deleteResponse.statusText}`);
    }

    console.log('✅ Collection deleted successfully');

    // Recreate the collection
    const createUrl = `${qdrantUrl}/collections/${collectionName}`;
    console.log(`🔄 Recreating collection at: ${createUrl}`);

    const createResponse = await fetch(createUrl, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({
        vectors: {
          size: 384, // sentence-transformers/all-MiniLM-L6-v2 embedding size
          distance: 'Cosine'
        }
      })
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to recreate collection: ${createResponse.statusText}`);
    }

    console.log('✅ Collection recreated successfully');

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Qdrant collection cleared and recreated successfully. You can now re-upload your materials.'
    });
  } catch (error) {
    console.error('❌ Clear endpoint error:', error);
    return errorResponse(
      res,
      `Failed to clear Qdrant: ${error.message}`,
      ERROR_CODES.INTERNAL_SERVER_ERROR,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
});

// 404 handler for unknown API routes
router.use((req, res) => {
  return errorResponse(
    res,
    `Route ${req.originalUrl} not found`,
    ERROR_CODES.NOT_FOUND,
    HTTP_STATUS.NOT_FOUND
  );
});

// Global error handler
router.use((error, req, res, next) => {
  console.error('API Error:', error);

  // Mongoose validation error
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message
    }));
    return errorResponse(
      res,
      'Validation failed',
      ERROR_CODES.VALIDATION_ERROR,
      HTTP_STATUS.BAD_REQUEST,
      errors
    );
  }

  // Mongoose cast error (invalid ObjectId)
  if (error.name === 'CastError') {
    return errorResponse(
      res,
      'Invalid ID format',
      ERROR_CODES.VALIDATION_ERROR,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Duplicate key error
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    return errorResponse(
      res,
      `${field} already exists`,
      ERROR_CODES.DUPLICATE_RESOURCE,
      HTTP_STATUS.CONFLICT
    );
  }

  // Multer file upload errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return errorResponse(
      res,
      'File size too large',
      ERROR_CODES.FILE_UPLOAD_ERROR,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return errorResponse(
      res,
      'Unexpected file field',
      ERROR_CODES.FILE_UPLOAD_ERROR,
      HTTP_STATUS.BAD_REQUEST
    );
  }


  // Default server error
  return errorResponse(
    res,
    process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    ERROR_CODES.DATABASE_ERROR,
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    process.env.NODE_ENV === 'development' ? { stack: error.stack } : null
  );
});

export default router;