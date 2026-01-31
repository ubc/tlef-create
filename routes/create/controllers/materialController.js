import express from 'express';
import Material from '../models/Material.js';
import Folder from '../models/Folder.js';
import FileService from '../services/fileService.js';
import processingJobService from '../services/processingJobService.js';
import { authenticateToken, attachUser } from '../middleware/auth.js';
import { validateCreateMaterial, validateMongoId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, MATERIAL_TYPES, PROCESSING_STATUS } from '../config/constants.js';

const router = express.Router();

// Configure multer for file uploads
const upload = FileService.configureUpload();

/**
 * POST /api/materials/upload
 * Upload files (PDF, DOCX)
 */
router.post('/upload', authenticateToken, upload.array('files', 10), asyncHandler(async (req, res) => {
  console.log('📤 Upload request received:', {
    authenticated: !!req.user,
    userId: req.user?.id,
    filesCount: req.files?.length || 0,
    folderId: req.body.folderId,
    fileNames: req.files?.map(f => f.originalname) || []
  });
  
  const { folderId, names } = req.body;
  const files = req.files;
  const userId = req.user.id;

  if (!files || files.length === 0) {
    return errorResponse(res, 'No files uploaded', 'NO_FILES', HTTP_STATUS.BAD_REQUEST);
  }

  if (!folderId) {
    return errorResponse(res, 'Folder ID is required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify folder exists and user owns it
  console.log('🔍 Looking for folder:', { folderId, userId });
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  console.log('📁 Folder found:', !!folder);
  if (!folder) {
    console.log('❌ Folder not found or user does not own it');
    return notFoundResponse(res, 'Folder');
  }

  const materials = [];
  const errors = [];

  // Process each uploaded file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      // Use custom name if provided
      const customNames = Array.isArray(names) ? names : (names ? [names] : []);
      const customName = customNames[i];

      const fileData = await FileService.processUploadedFile(file, {
        name: customName,
        folder: folderId,
        uploadedBy: userId
      });
      
      console.log('📋 Processed file data:', {
        name: fileData.name,
        type: fileData.type,
        hasFolder: !!fileData.folder,
        hasUploadedBy: !!fileData.uploadedBy
      });

      // Check for duplicate files
      const existingMaterial = await Material.findOne({ 
        checksum: fileData.checksum, 
        folder: folderId 
      });

      if (existingMaterial) {
        console.log(`⚠️ Duplicate file detected: ${file.originalname} (checksum: ${fileData.checksum})`);
        console.log(`   Existing material: ${existingMaterial.name} (${existingMaterial._id})`);
        await FileService.deleteFile(file.path);
        errors.push({
          filename: file.originalname,
          error: 'File already exists in this folder'
        });
        continue;
      }

      const material = new Material(fileData);
      await material.save();
      console.log(`✅ Material saved to database: ${material.name} (${material._id})`);

      // Add to folder
      await folder.addMaterial(material._id);
      console.log(`📁 Material added to folder: ${folder.name}`);

      // Process material immediately (bypass broken job queue)
      await material.markAsProcessing();
      console.log(`🔄 Processing material immediately: ${material.name}`);

      // Process in background without blocking the response
      // Use IIFE to capture material in its own closure to avoid variable reference issues
      (async (materialToProcess) => {
        try {
          const ragService = (await import('../services/ragService.js')).default;

          // Wait for RAG service to be initialized (with timeout)
          const maxWaitTime = 30000; // 30 seconds
          const startTime = Date.now();
          while (!ragService.isInitialized && (Date.now() - startTime) < maxWaitTime) {
            console.log(`⏳ Waiting for RAG service to initialize... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          }

          if (!ragService.isInitialized) {
            throw new Error('RAG service initialization timeout after 30 seconds');
          }

          console.log(`🔄 Chunking and embedding material: ${materialToProcess.name} (ID: ${materialToProcess._id})`);
          const result = await ragService.processAndEmbedMaterial(materialToProcess);

          if (result.success) {
            const Material = (await import('../models/Material.js')).default;
            const updatedMaterial = await Material.findById(materialToProcess._id);
            if (updatedMaterial) {
              await updatedMaterial.markAsCompleted();
              console.log(`✅ Material processed and embedded: ${materialToProcess.name}`);
              console.log(`📊 Created ${result.chunksCount} chunks`);
            } else {
              console.error(`❌ Could not find material to mark as completed: ${materialToProcess._id}`);
            }
          } else {
            const Material = (await import('../models/Material.js')).default;
            const updatedMaterial = await Material.findById(materialToProcess._id);
            if (updatedMaterial) {
              await updatedMaterial.markAsFailed(result.error);
            }
            console.error(`❌ Failed to process material: ${result.error}`);
          }
        } catch (error) {
          console.error(`❌ Material processing failed: ${materialToProcess.name}`, error);
          console.error(`❌ Error stack:`, error.stack);
          try {
            const Material = (await import('../models/Material.js')).default;
            const updatedMaterial = await Material.findById(materialToProcess._id);
            if (updatedMaterial) {
              await updatedMaterial.markAsFailed(error);
            }
          } catch (updateError) {
            console.error('Failed to update material status:', updateError);
          }
        }
      })(material); // Pass material immediately to avoid closure issues

      materials.push(material);
    } catch (error) {
      console.error(`❌ Error processing file ${file.originalname}:`, error);
      errors.push({
        filename: file.originalname,
        error: error.message
      });
    }
  }

  const response = {
    materials,
    summary: {
      total: files.length,
      successful: materials.length,
      failed: errors.length
    }
  };

  if (errors.length > 0) {
    response.errors = errors;
    console.log(`⚠️ Upload errors:`, errors);
  }

  console.log(`📊 Upload summary: ${materials.length}/${files.length} files processed successfully`);
  console.log(`📝 Materials created:`, materials.map(m => ({
    id: m._id,
    name: m.name,
    processingStatus: m.processingStatus
  })));

  const statusCode = materials.length > 0 ? HTTP_STATUS.CREATED : HTTP_STATUS.BAD_REQUEST;
  const message = materials.length > 0 ?
    `${materials.length} materials uploaded successfully` :
    'No materials were uploaded';

  console.log(`📤 Sending response with ${materials.length} materials`);
  return successResponse(res, response, message, statusCode);
}));

/**
 * POST /api/materials/url
 * Add URL material
 */
router.post('/url', authenticateToken, asyncHandler(async (req, res) => {
  const { name, url, folderId } = req.body;
  const userId = req.user.id;

  console.log('📥 URL material request received:', {
    hasName: !!name,
    hasUrl: !!url,
    hasFolderId: !!folderId,
    name,
    url,
    folderId,
    userId,
    bodyKeys: Object.keys(req.body)
  });

  // Validate required fields
  if (!name || !url || !folderId) {
    console.error('❌ Validation failed - missing required fields:', {
      name: name || 'MISSING',
      url: url || 'MISSING',
      folderId: folderId || 'MISSING'
    });
    return errorResponse(res, 'Name, URL, and folder ID are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Validate URL format
  const urlValidation = FileService.validateUrl(url);
  if (!urlValidation.isValid) {
    return errorResponse(res, urlValidation.error, 'INVALID_URL', HTTP_STATUS.BAD_REQUEST);
  }

  // Validate URL content type (check if it's allowed content)
  console.log('🔍 Validating URL content type...');
  const contentValidation = await FileService.validateUrlContentType(urlValidation.normalizedUrl);

  if (!contentValidation.isValid) {
    console.log('❌ URL content validation failed:', contentValidation.reason);
    return errorResponse(res, contentValidation.error, 'BLOCKED_CONTENT_TYPE', HTTP_STATUS.FORBIDDEN);
  }

  if (contentValidation.warning) {
    console.warn('⚠️ URL content validation warning:', contentValidation.warning);
  } else {
    console.log('✅ URL content validated:', contentValidation.message);
  }

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  // Check for duplicate URL in folder
  const existingMaterial = await Material.findOne({ 
    url: urlValidation.normalizedUrl, 
    folder: folderId 
  });

  if (existingMaterial) {
    return errorResponse(res, 'URL already exists in this folder', 'DUPLICATE_URL', HTTP_STATUS.CONFLICT);
  }

  const material = new Material({
    name: name.trim(),
    type: MATERIAL_TYPES.URL,
    url: urlValidation.normalizedUrl,
    folder: folderId,
    uploadedBy: userId,
    processingStatus: PROCESSING_STATUS.PENDING
  });

  await material.save();
  await folder.addMaterial(material._id);

  // Enqueue for URL processing
  try {
    await processingJobService.enqueueProcessingJob(material._id, 'url');
    console.log(`📋 URL processing job enqueued for material: ${material._id}`);
  } catch (processingError) {
    console.error(`❌ Failed to enqueue URL processing job:`, processingError);
    // Don't fail the creation, just log the error
  }

  return successResponse(res, { material }, 'URL material created successfully', HTTP_STATUS.CREATED);
}));

/**
 * POST /api/materials/text
 * Add text material
 */
router.post('/text', authenticateToken, asyncHandler(async (req, res) => {
  const { name, content, folderId } = req.body;
  const userId = req.user.id;

  // Validate required fields
  if (!name || !content || !folderId) {
    return errorResponse(res, 'Name, content, and folder ID are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  // Generate checksum for text content
  const crypto = await import('crypto');
  const checksum = crypto.createHash('md5').update(content).digest('hex');

  // Check for duplicate content in folder
  const existingMaterial = await Material.findOne({ 
    checksum, 
    folder: folderId 
  });

  if (existingMaterial) {
    return errorResponse(res, 'Text content already exists in this folder', 'DUPLICATE_CONTENT', HTTP_STATUS.CONFLICT);
  }

  const material = new Material({
    name: name.trim(),
    type: MATERIAL_TYPES.TEXT,
    content: content.trim(),
    folder: folderId,
    uploadedBy: userId,
    fileSize: Buffer.byteLength(content, 'utf8'),
    checksum,
    processingStatus: PROCESSING_STATUS.PENDING // Will be processed for embeddings
  });

  await material.save();
  await folder.addMaterial(material._id);

  // Enqueue for text processing (embeddings generation)
  try {
    await processingJobService.enqueueProcessingJob(material._id, 'text');
    console.log(`📋 Text processing job enqueued for material: ${material._id}`);
  } catch (processingError) {
    console.error(`❌ Failed to enqueue text processing job:`, processingError);
    // Don't fail the creation, just log the error
  }

  return successResponse(res, { material }, 'Text material created successfully', HTTP_STATUS.CREATED);
}));

/**
 * GET /api/materials/folder/:folderId
 * Get folder's materials
 */
router.get('/folder/:folderId', authenticateToken, asyncHandler(async (req, res) => {
  const folderId = req.params.folderId;
  const userId = req.user.id;

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  const materials = await Material.find({ folder: folderId })
    .populate('uploadedBy', 'cwlId')
    .sort({ createdAt: -1 });

  return successResponse(res, { materials }, 'Materials retrieved successfully');
}));

/**
 * DELETE /api/materials/:id
 * Delete material
 */
router.delete('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const materialId = req.params.id;
  const userId = req.user.id;

  const material = await Material.findOne({ _id: materialId, uploadedBy: userId });
  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  // Delete file if it exists
  if (material.filePath) {
    await FileService.deleteFile(material.filePath);
  }

  // Remove from folder
  const folder = await Folder.findById(material.folder);
  if (folder) {
    await folder.removeMaterial(materialId);
  }

  // Delete material
  await Material.findByIdAndDelete(materialId);

  return successResponse(res, null, 'Material deleted successfully');
}));

/**
 * GET /api/materials/:id/status
 * Get processing status
 */
router.get('/:id/status', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const materialId = req.params.id;
  const userId = req.user.id;

  const material = await Material.findOne({ _id: materialId, uploadedBy: userId })
    .select('name processingStatus processingError createdAt updatedAt');

  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  return successResponse(res, { 
    material: {
      id: material._id,
      name: material.name,
      processingStatus: material.processingStatus,
      processingError: material.processingError,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt
    }
  }, 'Processing status retrieved');
}));

/**
 * PUT /api/materials/:id
 * Update material (name only)
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const materialId = req.params.id;
  const userId = req.user.id;
  const { name } = req.body;

  if (!name || name.trim().length === 0) {
    return errorResponse(res, 'Name is required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  const material = await Material.findOne({ _id: materialId, uploadedBy: userId });
  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  material.name = name.trim();
  await material.save();

  return successResponse(res, { material }, 'Material updated successfully');
}));

/**
 * POST /api/materials/:id/reprocess
 * Trigger reprocessing of material
 */
router.post('/:id/reprocess', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const materialId = req.params.id;
  const userId = req.user.id;

  const material = await Material.findOne({ _id: materialId, uploadedBy: userId });
  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  // Reset processing status
  await material.updateProcessingStatus(PROCESSING_STATUS.PENDING);

  // Here you would trigger the actual processing job
  // This could be a queue job, webhook, etc.

  return successResponse(res, { material }, 'Material reprocessing triggered');
}));

/**
 * GET /api/materials/processing/stats
 * Get processing statistics
 */
router.get('/processing/stats', authenticateToken, asyncHandler(async (req, res) => {
  const stats = processingJobService.getProcessingStats();
  return successResponse(res, { stats }, 'Processing statistics retrieved');
}));

/**
 * POST /api/materials/search
 * Search materials using RAG
 */
router.post('/search', authenticateToken, asyncHandler(async (req, res) => {
  const { query, folderId, limit = 5 } = req.body;
  const userId = req.user.id;

  if (!query || query.trim().length === 0) {
    return errorResponse(res, 'Search query is required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify folder access if specified
  if (folderId) {
    const folder = await Folder.findOne({ _id: folderId, instructor: userId });
    if (!folder) {
      return notFoundResponse(res, 'Folder');
    }
  }

  try {
    // Import document processing service dynamically to avoid initialization issues
    const { default: documentProcessingService } = await import('../services/documentProcessingService.js');
    
    const searchResults = await documentProcessingService.searchContent(
      query.trim(),
      folderId,
      Math.min(limit, 20) // Cap at 20 results
    );

    return successResponse(res, { 
      query: query.trim(),
      results: searchResults,
      folderId: folderId || null,
      limit: searchResults.length
    }, 'Search completed successfully');
    
  } catch (error) {
    console.error('❌ Material search failed:', error);
    return errorResponse(res, 'Search failed', 'SEARCH_ERROR', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}));

/**
 * POST /api/materials/processing/cleanup
 * Clean up old processing jobs (admin/maintenance endpoint)
 */
router.post('/processing/cleanup', authenticateToken, asyncHandler(async (req, res) => {
  const { maxAge = 3600000 } = req.body; // Default: 1 hour

  const cleanedCount = processingJobService.cleanupOldJobs(maxAge);

  return successResponse(res, {
    cleaned: cleanedCount,
    maxAge: maxAge
  }, `Cleaned up ${cleanedCount} old processing jobs`);
}));

/**
 * GET /api/materials/:materialId/preview
 * Get preview of material content by retrieving all chunks from Qdrant
 */
router.get('/:materialId/preview', authenticateToken, asyncHandler(async (req, res) => {
  const { materialId } = req.params;
  const userId = req.user.id;

  console.log(`👁️ Preview request for material: ${materialId}`);

  // Verify material exists and user owns it
  const material = await Material.findById(materialId);

  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  // Verify user owns the material (through folder)
  const folder = await Folder.findOne({ _id: material.folder, instructor: userId });
  if (!folder) {
    return errorResponse(res, 'Unauthorized', 'UNAUTHORIZED', HTTP_STATUS.FORBIDDEN);
  }

  try {
    // Import ragService to access Qdrant
    const { default: ragService } = await import('../services/ragService.js');
    await ragService.initialize();

    console.log(`🔍 Retrieving chunks for material: ${materialId}`);

    // Retrieve all chunks for this material using a broad query
    // We'll filter by materialId afterward
    const allChunks = await ragService.ragModule.retrieveContext('*', {
      limit: 1000, // Get a large number to ensure we get all chunks
      scoreThreshold: 0.0 // Include all chunks regardless of score
    });

    console.log(`📥 Retrieved ${allChunks.length} total chunks from Qdrant`);

    // Filter chunks by materialId
    const materialChunks = allChunks.filter(chunk => {
      const chunkMaterialId = chunk.metadata?.materialId;
      return chunkMaterialId === materialId;
    });

    console.log(`✅ Found ${materialChunks.length} chunks for material ${materialId}`);

    if (materialChunks.length === 0) {
      return successResponse(res, {
        content: 'No content available. This material may still be processing.',
        chunkCount: 0
      }, 'No chunks found for this material');
    }

    // Sort chunks by chunkIndex if available
    materialChunks.sort((a, b) => {
      const indexA = a.metadata?.chunkIndex ?? 0;
      const indexB = b.metadata?.chunkIndex ?? 0;
      return indexA - indexB;
    });

    // Combine all chunk texts into a single content string
    // Try different property names that RAG modules might use
    const content = materialChunks.map(chunk => {
      return chunk.text || chunk.content || chunk.pageContent || '';
    }).join('\n\n---\n\n');

    console.log(`📄 Preview content length: ${content.length} characters`);
    console.log(`📊 Sample chunk properties:`, materialChunks[0] ? Object.keys(materialChunks[0]) : 'none');

    return successResponse(res, {
      content,
      chunkCount: materialChunks.length,
      materialName: material.name,
      materialType: material.type
    }, 'Material preview retrieved successfully');

  } catch (error) {
    console.error('❌ Failed to retrieve material preview:', error);
    return errorResponse(res, 'Failed to retrieve preview', 'PREVIEW_ERROR', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}));

export default router;