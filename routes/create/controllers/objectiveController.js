import express from 'express';
import LearningObjective from '../models/LearningObjective.js';
import Quiz from '../models/Quiz.js';
import Material from '../models/Material.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateCreateObjective, validateGenerateObjectives, validateClassifyObjectives, validateMongoId, validateQuizId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';
import llmService from '../services/llmService.js';
import coursePromptService from '../services/coursePromptService.js';
import sseService from '../services/sseService.js';
import {
  buildInstructorMetadata,
  mergeInstructorProtectedMetadata,
  validateInstructorMetadata
} from '../utils/learningObjectiveMetadata.js';

const router = express.Router();

/**
 * GET /api/objectives/quiz/:quizId
 * Get quiz objectives
 */
router.get('/quiz/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const objectives = await LearningObjective.find({ quiz: quizId })
    .populate('generatedFrom', 'name type')
    .populate('createdBy', 'cwlId')
    .sort({ order: 1 });

  return successResponse(res, { objectives }, 'Learning objectives retrieved successfully');
}));

/**
 * POST /api/objectives/generate
 * AI generate from materials
 */
router.post('/generate', authenticateToken, validateGenerateObjectives, asyncHandler(async (req, res) => {
  const { quizId, materialIds, targetCount, customPrompt, replaceExisting = false, sessionId } = req.body;
  const userId = req.user.id;
  const progressQuestionId = 'learning-objectives';
  const streamProgress = (status, message, metadata = {}) => {
    if (!sessionId) return;
    sseService.streamQuestionProgress(sessionId, progressQuestionId, {
      type: 'learning-objectives',
      status,
      message,
      metadata
    });
  };

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify materials exist and are in the same folder
  const materials = await Material.find({ 
    _id: { $in: materialIds },
    folder: quiz.folder 
  });

  if (materials.length !== materialIds.length) {
    return errorResponse(
      res, 
      'Some materials not found or not in the same folder', 
      'INVALID_MATERIALS', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Check if materials are processed
  const unprocessedMaterials = materials.filter(m => m.processingStatus !== 'completed');
  if (unprocessedMaterials.length > 0) {
    return errorResponse(
      res, 
      'Some materials are not yet processed. Please wait for processing to complete.', 
      'MATERIALS_NOT_READY', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  try {
    const startTime = Date.now();
    if (sessionId) {
      sseService.notifyBatchStarted(sessionId, {
        totalQuestions: 1,
        workflow: 'learning-objectives',
        message: 'Learning objective generation started'
      });
    }
    streamProgress('started', 'Resolving course prompt and model settings...');
    
    // Get user preferences for AI model selection
    const { default: User } = await import('../models/User.js');
    const user = await User.findById(userId).select('preferences');
    const userPreferences = user?.preferences || null;
    const [coursePrompt, coveragePrompt] = await Promise.all([
      coursePromptService.buildCoursePromptInstructions({
        folderId: quiz.folder,
        userId,
        promptType: 'learning-objectives',
        userInstructions: customPrompt
      }),
      coursePromptService.buildCoursePromptInstructions({
        folderId: quiz.folder,
        userId,
        promptType: 'coverage-map'
      })
    ]);
    const effectiveObjectivePrompt = coursePromptService.mergePromptParts(
      coursePrompt.prompt,
      coveragePrompt.prompt
    );
    console.log(`🎛️ LO generation prompt | source=${coursePrompt.source} | version=${coursePrompt.version || 'default'} | requestInstructions=${customPrompt?.trim() ? 'yes' : 'no'}`);
    
    // Generate learning objectives using user's preferred LLM
    const forwardWorkflowProgress = event => {
      if (!event || typeof event !== 'object') return;
      streamProgress(event.status || 'progress', event.message || 'Working...', event.metadata || {});
    };
    const streamObjectiveOutput = (textChunk, metadata = {}) => {
      if (!sessionId) return;
      if (metadata.reset) {
        sseService.streamTextReset(sessionId, progressQuestionId, {
          reason: metadata.reason || 'workflow-retry'
        });
        return;
      }
      if (!metadata.partial || !textChunk) return;
      sseService.streamTextChunk(sessionId, progressQuestionId, textChunk, {
        contentType: 'learning-objectives-json',
        model: metadata.model,
        totalLength: metadata.totalLength,
        isPartial: true
      });
    };

    const generationResult = await llmService.generateLearningObjectives(
      materials,
      `Quiz: ${quiz.name}`, // Add context about the quiz
      targetCount, // Pass target count if provided
      userPreferences, // Pass user preferences
      effectiveObjectivePrompt || null,
      customPrompt?.trim() || null, // Request-specific retrieval focus
      userId,
      forwardWorkflowProgress,
      streamObjectiveOutput
    );
    const generatedObjectives = Array.isArray(generationResult)
      ? generationResult
      : generationResult.objectives;

    if (!Array.isArray(generatedObjectives) || generatedObjectives.length === 0) {
      throw new Error('The model did not return any valid learning objectives. Existing objectives were preserved.');
    }
    
    const processingTime = Date.now() - startTime;

    let replacementMetadata = null;
    if (replaceExisting) {
      const Question = (await import('../models/Question.js')).default;
      const [objectiveResult, questionResult] = await Promise.all([
        LearningObjective.deleteMany({ quiz: quizId }),
        Question.deleteMany({ quiz: quizId })
      ]);
      quiz.learningObjectives = [];
      quiz.questions = [];
      await quiz.save();
      replacementMetadata = {
        replacedObjectives: objectiveResult.deletedCount,
        removedQuestions: questionResult.deletedCount
      };
    }

    const objectives = [];
    for (let i = 0; i < generatedObjectives.length; i++) {
      const generatedObjective = generatedObjectives[i];
      const objectiveText = typeof generatedObjective === 'string'
        ? generatedObjective
        : generatedObjective.text;
      const objectiveMetadata = typeof generatedObjective === 'object' && generatedObjective !== null
        ? generatedObjective
        : {};

      if (!objectiveText || !objectiveText.trim()) {
        continue;
      }

      const objective = new LearningObjective({
        text: objectiveText.trim(),
        quiz: quizId,
        order: objectives.length,
        generatedFrom: materialIds,
        generationMetadata: {
          isAIGenerated: true,
          llmModel: generationResult.llmModel || userPreferences?.llmModel || process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'unknown',
          generationPrompt: `Generate learning objectives from provided materials (${coursePrompt.source} prompt)`,
          sourceReferences: objectiveMetadata.sourceReferences || [],
          title: objectiveMetadata.title || '',
          topic: objectiveMetadata.topic || '',
          subtopic: objectiveMetadata.subtopic || '',
          sourceOutlineSection: objectiveMetadata.sourceOutlineSection || '',
          sourceSectionIds: Array.isArray(objectiveMetadata.sourceSectionIds) ? objectiveMetadata.sourceSectionIds : [],
          subpoints: Array.isArray(objectiveMetadata.subpoints) ? objectiveMetadata.subpoints : [],
          bloomLevel: objectiveMetadata.bloomLevel || '',
          rationale: objectiveMetadata.rationale || '',
          promptSource: coursePrompt.source,
          promptVersion: coursePrompt.version || undefined,
          coverageDiagnostics: generationResult.coverageDiagnostics || undefined,
          inventoryDiagnostics: generationResult.inventoryDiagnostics || undefined,
          confidence: 0.85,
          processingTime: processingTime
        },
        createdBy: userId
      });

      await objective.save();
      objectives.push(objective);

      // Add to quiz
      await quiz.addLearningObjective(objective._id);
    }

    streamProgress('saved', `Saved ${objectives.length} learning objective${objectives.length === 1 ? '' : 's'}.`);
    if (sessionId) {
      sseService.notifyQuestionComplete(sessionId, progressQuestionId, {
        objectiveCount: objectives.length,
        metadata: {
          materialsUsed: materials.length,
          generationModel: generationResult.llmModel || userPreferences?.llmModel || process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'unknown'
        }
      });
      sseService.notifyBatchComplete(sessionId, {
        totalGenerated: objectives.length,
        totalFailed: 0,
        workflow: 'learning-objectives'
      });
    }

    return successResponse(res, { 
      objectives,
      metadata: {
        generatedCount: objectives.length,
        materialsUsed: materials.length,
        generationModel: generationResult.llmModel || userPreferences?.llmModel || process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'unknown',
        replacement: replacementMetadata
      }
    }, 'Learning objectives generated successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('AI generation error:', error);
    if (sessionId) {
      sseService.emitError(sessionId, progressQuestionId, error.message, 'learning-objectives-error');
      sseService.notifyBatchComplete(sessionId, {
        totalGenerated: 0,
        totalFailed: 1,
        workflow: 'learning-objectives'
      });
    }
    return errorResponse(
      res, 
      'Failed to generate learning objectives', 
      'AI_GENERATION_ERROR', 
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

/**
 * POST /api/objectives/classify
 * AI classify user text into LOs
 */
router.post('/classify', authenticateToken, validateClassifyObjectives, asyncHandler(async (req, res) => {
  const { quizId, text } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    const startTime = Date.now();
    
    // Classify learning objectives using user's preferred LLM
    const activeLLMConfig = await llmService.resolveUserLLMConfig(userId);
    const classifiedObjectives = await llmService.classifyLearningObjectives(text, activeLLMConfig);
    
    const processingTime = Date.now() - startTime;

    if (classifiedObjectives.length === 0) {
      return errorResponse(
        res, 
        'No learning objectives could be identified in the provided text', 
        'NO_OBJECTIVES_FOUND', 
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const objectives = [];
    for (let i = 0; i < classifiedObjectives.length; i++) {
      const objective = new LearningObjective({
        text: classifiedObjectives[i],
        quiz: quizId,
        order: i,
        generationMetadata: {
          isAIGenerated: true,
          llmModel: activeLLMConfig.model,
          generationPrompt: 'Classify text into learning objectives',
          confidence: 0.75,
          processingTime: processingTime
        },
        createdBy: userId
      });

      await objective.save();
      objectives.push(objective);

      // Add to quiz
      await quiz.addLearningObjective(objective._id);
    }

    return successResponse(res, { 
      objectives,
      metadata: {
        originalText: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        classifiedCount: objectives.length,
        processingTime: processingTime,
        llmModel: userPreferences?.llmModel || 'llama3.1:8b'
      }
    }, 'Text classified into learning objectives successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('Classification error:', error);
    return errorResponse(
      res, 
      'Failed to classify text into learning objectives', 
      'AI_CLASSIFICATION_ERROR', 
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

/**
 * POST /api/objectives/enrich
 * Add subpoints and material references to existing instructor-authored LOs
 */
router.post('/enrich', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, objectiveIds } = req.body;
  const userId = req.user.id;

  if (!quizId) {
    return errorResponse(res, 'QuizId is required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const objectiveQuery = {
    quiz: quizId,
    createdBy: userId
  };

  if (Array.isArray(objectiveIds) && objectiveIds.length > 0) {
    objectiveQuery._id = { $in: objectiveIds };
  }

  const objectives = await LearningObjective.find(objectiveQuery).sort({ order: 1 });
  if (objectives.length === 0) {
    return errorResponse(res, 'No learning objectives found to enrich', 'NO_OBJECTIVES', HTTP_STATUS.BAD_REQUEST);
  }

  const materials = await Material.find({
    _id: { $in: quiz.materials },
    processingStatus: 'completed'
  });

  if (materials.length === 0) {
    return errorResponse(
      res,
      'No processed materials found for this quiz. Please assign and process materials first.',
      'NO_MATERIALS',
      HTTP_STATUS.BAD_REQUEST
    );
  }

  try {
    const startTime = Date.now();
    const [objectivePrompt, coveragePrompt] = await Promise.all([
      coursePromptService.buildCoursePromptInstructions({
        folderId: quiz.folder,
        userId,
        promptType: 'learning-objectives'
      }),
      coursePromptService.buildCoursePromptInstructions({
        folderId: quiz.folder,
        userId,
        promptType: 'coverage-map'
      })
    ]);
    const effectivePrompt = coursePromptService.mergePromptParts(
      objectivePrompt.prompt,
      coveragePrompt.prompt
    );

    const enrichmentResult = await llmService.enrichLearningObjectives(
      objectives,
      materials,
      `Quiz: ${quiz.name}`,
      effectivePrompt || null,
      userId
    );
    const enrichmentById = new Map(
      enrichmentResult.objectives.map(enrichment => [enrichment.objectiveId, enrichment])
    );
    const processingTime = Date.now() - startTime;
    const updatedObjectives = [];

    for (const objective of objectives) {
      const enrichment = enrichmentById.get(objective._id.toString());
      if (!enrichment) {
        continue;
      }

      const existingMetadata = typeof objective.generationMetadata?.toObject === 'function'
        ? objective.generationMetadata.toObject()
        : (objective.generationMetadata || {});
      const nextSourceReferences = Array.isArray(enrichment.sourceReferences) && enrichment.sourceReferences.length > 0
        ? enrichment.sourceReferences
        : (existingMetadata.sourceReferences || []);
      const nextSourceSectionIds = Array.isArray(enrichment.sourceSectionIds) && enrichment.sourceSectionIds.length > 0
        ? enrichment.sourceSectionIds
        : (existingMetadata.sourceSectionIds || []);
      const protectedMetadata = mergeInstructorProtectedMetadata(existingMetadata, enrichment);
      const nextSubpoints = protectedMetadata.subpoints;
      const hasUsefulEnrichment = nextSourceReferences.length > 0
        || nextSourceSectionIds.length > 0
        || nextSubpoints.length > 0;

      if (!hasUsefulEnrichment) {
        console.warn(`⚠️ Skipping empty enrichment for LO ${objective._id}; existing metadata is preserved.`);
        continue;
      }

      objective.generatedFrom = materials.map(material => material._id);
      objective.generationMetadata = {
        ...existingMetadata,
        isAIGenerated: existingMetadata.isAIGenerated || false,
        aiEnriched: true,
        llmModel: enrichmentResult.llmModel || existingMetadata.llmModel || 'unknown',
        generationPrompt: `Enrich existing learning objective with material alignment (${objectivePrompt.source} prompt)`,
        sourceReferences: nextSourceReferences,
        title: enrichment.title || existingMetadata.title || '',
        topic: enrichment.topic || existingMetadata.topic || '',
        subtopic: enrichment.subtopic || existingMetadata.subtopic || '',
        sourceOutlineSection: enrichment.sourceOutlineSection || existingMetadata.sourceOutlineSection || '',
        sourceSectionIds: nextSourceSectionIds,
        subpoints: nextSubpoints,
        bloomLevel: protectedMetadata.bloomLevel,
        rationale: enrichment.rationale || existingMetadata.rationale || '',
        promptSource: objectivePrompt.source,
        promptVersion: objectivePrompt.version || undefined,
        enrichmentDiagnostics: enrichmentResult.enrichmentDiagnostics,
        confidence: 0.78,
        processingTime
      };

      await objective.save();
      updatedObjectives.push(objective);
    }

    if (updatedObjectives.length === 0) {
      return errorResponse(
        res,
        'CREATE could not retrieve source evidence from the assigned materials. Reprocess any completed materials with empty previews, then retry AI Link Missing.',
        'NO_SOURCE_EVIDENCE',
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        {
          requestedObjectiveCount: objectives.length,
          inventorySectionCount: enrichmentResult.enrichmentDiagnostics?.inventorySectionCount || 0,
          modelError: enrichmentResult.enrichmentDiagnostics?.modelError || undefined
        }
      );
    }

    return successResponse(res, {
      objectives: updatedObjectives,
      metadata: {
        enrichedCount: updatedObjectives.length,
        skippedCount: objectives.length - updatedObjectives.length,
        materialsUsed: materials.length,
        generationModel: enrichmentResult.llmModel || 'unknown',
        modelAssistedCount: enrichmentResult.enrichmentDiagnostics?.modelAssistedCount || 0,
        fallbackCount: enrichmentResult.enrichmentDiagnostics?.fallbackCount || 0,
        usedSourceGroundedFallback: Boolean(enrichmentResult.enrichmentDiagnostics?.fallbackCount)
      }
    }, enrichmentResult.enrichmentDiagnostics?.modelError
      ? 'Learning objectives linked using the source-grounded fallback'
      : 'Learning objectives enriched successfully');
  } catch (error) {
    console.error('Objective enrichment error:', error);
    return errorResponse(
      res,
      'Failed to enrich learning objectives',
      'AI_ENRICHMENT_ERROR',
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

/**
 * POST /api/objectives
 * Add single LO or save batch
 */
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Handle batch creation/replacement
  if (Array.isArray(req.body)) {
    const objectivesData = req.body;
    const objectives = [];
    const errors = [];
    const appendMode = req.query.mode === 'append';

    // Handle empty array (delete all)
    if (objectivesData.length === 0) {
      return errorResponse(res, 'Cannot determine quiz ID from empty objectives array. Use DELETE endpoint or provide quizId.', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
    }

    // Get the quizId from the first objective (all should have the same quizId)
    const quizId = objectivesData[0]?.quizId;
    if (!quizId) {
      return errorResponse(res, 'QuizId is required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
    }

    // Verify quiz exists and user owns it
    const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
    if (!quiz) {
      return notFoundResponse(res, 'Quiz');
    }

    let nextOrder = 0;
    let existingTexts = new Set();

    if (appendMode) {
      const existingObjectives = await LearningObjective.find({ quiz: quizId })
        .select('text order')
        .sort({ order: -1 })
        .lean();
      nextOrder = existingObjectives.length > 0
        ? Math.max(...existingObjectives.map(objective => objective.order ?? 0)) + 1
        : 0;
      existingTexts = new Set(existingObjectives.map(objective => objective.text.trim().toLowerCase()));
    } else {
      await LearningObjective.deleteMany({ quiz: quizId });
      quiz.learningObjectives = [];
      await quiz.save();
    }

    for (const objData of objectivesData) {
      try {
        if (!objData.text || !objData.quizId) {
          errors.push({ data: objData, error: 'Text and quizId are required' });
          continue;
        }

        const normalizedText = objData.text.trim().toLowerCase();
        if (appendMode && existingTexts.has(normalizedText)) {
          errors.push({ data: objData, error: 'An identical learning objective already exists' });
          continue;
        }

        const instructorMetadata = validateInstructorMetadata(objData);
        if (instructorMetadata.error) {
          errors.push({ data: objData, error: instructorMetadata.error });
          continue;
        }

        const objective = new LearningObjective({
          text: objData.text.trim(),
          quiz: objData.quizId,
          order: appendMode ? nextOrder + objectives.length : (objData.order ?? objectives.length),
          generationMetadata: buildInstructorMetadata(instructorMetadata),
          createdBy: userId
        });

        await objective.save();
        await quiz.addLearningObjective(objective._id);
        objectives.push(objective);
        existingTexts.add(normalizedText);

      } catch (error) {
        errors.push({ data: objData, error: error.message });
      }
    }

    const response = {
      objectives,
      summary: {
        total: objectivesData.length,
        successful: objectives.length,
        failed: errors.length
      }
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    const statusCode = objectives.length > 0 ? HTTP_STATUS.CREATED : HTTP_STATUS.BAD_REQUEST;
    const message = objectives.length > 0 ?
      `${objectives.length} learning objectives ${appendMode ? 'added' : 'created'} successfully` :
      'No learning objectives were created';

    return successResponse(res, response, message, statusCode);
  }

  // Handle single creation
  const { text, quizId, order } = req.body;

  if (!text || !quizId) {
    return errorResponse(res, 'Text and quizId are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }


  const instructorMetadata = validateInstructorMetadata(req.body);
  if (instructorMetadata.error) {
    return errorResponse(res, instructorMetadata.error, 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const objective = new LearningObjective({
    text: text.trim(),
    quiz: quizId,
    order: order || 0,
    generationMetadata: buildInstructorMetadata(instructorMetadata),
    createdBy: userId
  });

  await objective.save();
  await quiz.addLearningObjective(objective._id);

  return successResponse(res, { objective }, 'Learning objective created successfully', HTTP_STATUS.CREATED);
}));

/**
 * PUT /api/objectives/reorder
 * Reorder objectives
 * NOTE: Must be registered before /:id routes to avoid matching "reorder" as :id
 */
router.put('/reorder', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, objectiveIds } = req.body;
  const userId = req.user.id;

  if (!quizId || !Array.isArray(objectiveIds)) {
    return errorResponse(res, 'QuizId and objectiveIds array are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify all objectives belong to this quiz and user
  const objectives = await LearningObjective.find({ 
    _id: { $in: objectiveIds },
    quiz: quizId,
    createdBy: userId 
  });

  if (objectives.length !== objectiveIds.length) {
    return errorResponse(
      res, 
      'Some objectives not found or not owned by user', 
      'INVALID_OBJECTIVES', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Update order
  await LearningObjective.reorderObjectives(quizId, objectiveIds);

  const reorderedObjectives = await LearningObjective.find({ quiz: quizId })
    .sort({ order: 1 });

  return successResponse(res, { objectives: reorderedObjectives }, 'Learning objectives reordered successfully');
}));

/**
 * PUT /api/objectives/:id
 * Update objective
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const objectiveId = req.params.id;
  const userId = req.user.id;
  const { text, order, bloomLevel, subpoints } = req.body;

  const objective = await LearningObjective.findOne({ _id: objectiveId, createdBy: userId });
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }


  const instructorMetadata = validateInstructorMetadata({ bloomLevel, subpoints });
  if (instructorMetadata.error) {
    return errorResponse(res, instructorMetadata.error, 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  if (text && text.trim() !== objective.text) {
    await objective.updateText(text.trim(), userId);
  }

  if (order !== undefined && order !== objective.order) {
    await objective.reorder(order);
  }

  if (bloomLevel !== undefined || subpoints !== undefined) {
    const existingMetadata = typeof objective.generationMetadata?.toObject === 'function'
      ? objective.generationMetadata.toObject()
      : (objective.generationMetadata || {});
    const instructorAuthoredFields = new Set(existingMetadata.instructorAuthoredFields || []);

    if (bloomLevel !== undefined) {
      if (instructorMetadata.bloomLevel) instructorAuthoredFields.add('bloomLevel');
      else instructorAuthoredFields.delete('bloomLevel');
    }
    if (subpoints !== undefined) {
      if (instructorMetadata.subpoints?.length) instructorAuthoredFields.add('subpoints');
      else instructorAuthoredFields.delete('subpoints');
    }

    objective.generationMetadata = {
      ...existingMetadata,
      ...(bloomLevel !== undefined && { bloomLevel: instructorMetadata.bloomLevel || '' }),
      ...(subpoints !== undefined && { subpoints: instructorMetadata.subpoints || [] }),
      instructorAuthoredFields: Array.from(instructorAuthoredFields)
    };
    await objective.save();
  }

  return successResponse(res, { objective }, 'Learning objective updated successfully');
}));

/**
 * DELETE /api/objectives/quiz/:quizId/all
 * Delete all learning objectives for a quiz
 */
router.delete('/quiz/:quizId/all', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const Question = (await import('../models/Question.js')).default;

  // Get all objective IDs for this quiz before deleting
  const objectives = await LearningObjective.find({ quiz: quizId }).select('_id');
  const objectiveIds = objectives.map(o => o._id);

  // Delete all questions linked to these objectives
  const questionResult = await Question.deleteMany({ learningObjective: { $in: objectiveIds } });

  // Delete all objectives
  const result = await LearningObjective.deleteMany({ quiz: quizId });

  // Clear arrays on quiz document
  quiz.learningObjectives = [];
  quiz.questions = [];
  await quiz.save();

  return successResponse(res, {
    deletedCount: result.deletedCount,
    deletedQuestions: questionResult.deletedCount,
    quizId: quizId
  }, `${result.deletedCount} learning objectives and ${questionResult.deletedCount} question(s) deleted successfully`);
}));

/**
 * DELETE /api/objectives/:id
 * Delete objective
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const objectiveId = req.params.id;
  const userId = req.user.id;
  const { confirmed } = req.query;

  const objective = await LearningObjective.findOne({ _id: objectiveId, createdBy: userId });
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  // Check how many questions will be deleted
  const Question = (await import('../models/Question.js')).default;
  const questionCount = await Question.countDocuments({ learningObjective: objectiveId });

  // If there are questions and user hasn't confirmed, return warning
  if (questionCount > 0 && confirmed !== 'true') {
    return successResponse(res, {
      requiresConfirmation: true,
      questionCount,
      objectiveId,
      message: `This Learning Objective has ${questionCount} question(s). Deleting it will also delete all these questions.`
    }, 'Confirmation required');
  }

  // Get all question IDs before deleting
  const questions = await Question.find({ learningObjective: objectiveId }).select('_id');
  const questionIds = questions.map(q => q._id);

  // Remove from quiz
  const quiz = await Quiz.findById(objective.quiz);
  if (quiz) {
    // Remove all questions from quiz.questions array
    for (const questionId of questionIds) {
      await quiz.removeQuestion(questionId);
    }
    await quiz.removeLearningObjective(objectiveId);
  }

  // Delete associated questions from database
  await Question.deleteMany({ learningObjective: objectiveId });

  // Delete objective
  await LearningObjective.findByIdAndDelete(objectiveId);

  return successResponse(res, {
    deletedQuestions: questionCount
  }, `Learning objective and ${questionCount} question(s) deleted successfully`);
}));

/**
 * POST /api/objectives/:id/regenerate
 * Regenerate a single learning objective
 */
router.post('/:id/regenerate', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const objectiveId = req.params.id;
  const userId = req.user.id;
  const { customPrompt } = req.body; // Get custom prompt from request body

  // Find the objective and verify user owns it
  const objective = await LearningObjective.findById(objectiveId).populate('quiz');
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  if (objective.quiz.createdBy.toString() !== userId) {
    return errorResponse(res, 'Not authorized to regenerate this objective', 'UNAUTHORIZED', HTTP_STATUS.FORBIDDEN);
  }

  // Get materials assigned to the quiz
  const materials = await Material.find({ 
    _id: { $in: objective.quiz.materials },
    processingStatus: 'completed'
  });

  if (materials.length === 0) {
    return errorResponse(
      res, 
      'No processed materials found for this quiz. Please assign and process materials first.', 
      'NO_MATERIALS', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  try {
    const startTime = Date.now();
    
    // Get user preferences for AI model selection
    const { default: User } = await import('../models/User.js');
    const user = await User.findById(userId).select('preferences');
    const userPreferences = user?.preferences || null;
    const [coursePrompt, coveragePrompt] = await Promise.all([
      coursePromptService.buildCoursePromptInstructions({
        folderId: objective.quiz.folder,
        userId,
        promptType: 'learning-objectives',
        userInstructions: customPrompt
      }),
      coursePromptService.buildCoursePromptInstructions({
        folderId: objective.quiz.folder,
        userId,
        promptType: 'coverage-map'
      })
    ]);
    const effectiveObjectivePrompt = coursePromptService.mergePromptParts(
      coursePrompt.prompt,
      coveragePrompt.prompt
    );
    
    // Regenerate the single objective using user's preferred LLM
    const activeLLMConfig = await llmService.resolveUserLLMConfig(userId);
    const regeneratedText = await llmService.regenerateSingleObjective(
      objective.text,
      materials,
      `Quiz: ${objective.quiz.name}`,
      userPreferences,
      effectiveObjectivePrompt || null,
      activeLLMConfig
    );

    // A rewritten objective must not retain subpoints and evidence for the old
    // wording. Refresh its structured metadata as part of the same operation.
    objective.text = regeneratedText;
    const enrichmentResult = await llmService.enrichLearningObjectives(
      [objective],
      materials,
      `Quiz: ${objective.quiz.name}`,
      effectiveObjectivePrompt || null,
      userId
    );
    const enrichment = enrichmentResult.objectives.find(entry => (
      entry.objectiveId === objective._id.toString()
    ));
    if (!enrichment) {
      throw new Error('The regenerated objective could not be aligned with its source materials');
    }

    const existingMetadata = typeof objective.generationMetadata?.toObject === 'function'
      ? objective.generationMetadata.toObject()
      : (objective.generationMetadata || {});
    const protectedMetadata = mergeInstructorProtectedMetadata(existingMetadata, enrichment);
    const nextSourceReferences = Array.isArray(enrichment.sourceReferences)
      ? enrichment.sourceReferences
      : [];
    if (nextSourceReferences.length === 0) {
      throw new Error('No source evidence could be retrieved for the regenerated objective');
    }

    const processingTime = Date.now() - startTime;
    objective.generatedFrom = materials.map(material => material._id);
    objective.generationMetadata = {
      ...existingMetadata,
      isAIGenerated: true,
      aiEnriched: true,
      llmModel: activeLLMConfig.model,
      generationPrompt: `Regenerate and realign single learning objective (${coursePrompt.source} prompt)`,
      sourceReferences: nextSourceReferences,
      title: enrichment.title || '',
      topic: enrichment.topic || '',
      subtopic: enrichment.subtopic || '',
      sourceOutlineSection: enrichment.sourceOutlineSection || '',
      sourceSectionIds: enrichment.sourceSectionIds || [],
      subpoints: protectedMetadata.subpoints,
      bloomLevel: protectedMetadata.bloomLevel,
      rationale: enrichment.rationale || '',
      promptSource: coursePrompt.source,
      promptVersion: coursePrompt.version || undefined,
      enrichmentDiagnostics: enrichmentResult.enrichmentDiagnostics,
      confidence: 0.8,
      processingTime
    };

    await objective.save();

    return successResponse(res, { 
      objective,
      metadata: {
        originalText: req.body.originalText || 'N/A',
        regeneratedText: regeneratedText,
        processingTime: processingTime,
        materialsUsed: materials.length,
        llmModel: activeLLMConfig.model
      }
    }, 'Learning objective regenerated successfully');

  } catch (error) {
    console.error('Single objective regeneration error:', error);
    const noApiKey = error.code === 'NO_API_KEY';
    return errorResponse(
      res, 
      noApiKey
        ? 'No AI API key is configured. Add a key in User Account, then retry.'
        : `Failed to regenerate learning objective: ${error.message}`,
      noApiKey ? 'NO_API_KEY' : 'AI_REGENERATION_ERROR',
      noApiKey ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

export default router;
