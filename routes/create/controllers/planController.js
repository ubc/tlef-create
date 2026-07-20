import express from 'express';
import GenerationPlan from '../models/GenerationPlan.js';
import Quiz from '../models/Quiz.js';
import LearningObjective from '../models/LearningObjective.js';
import Material from '../models/Material.js';
import Question from '../models/Question.js';
import SystemPromptTemplate from '../models/SystemPromptTemplate.js';
import UserPromptOverride from '../models/UserPromptOverride.js';
import CoursePromptOverride from '../models/CoursePromptOverride.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateGeneratePlan, validateMongoId, validateQuizId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, PEDAGOGICAL_APPROACHES, QUESTION_TYPES } from '../config/constants.js';
import llmService from '../services/llmService.js';
import sseService from '../services/sseService.js';
import coursePromptService from '../services/coursePromptService.js';
import {
  alignPlanItemsToSubpoints,
  buildQuestionBudget,
  discardPlanItemsOutsideBudget,
  rebalancePlanToBudget
} from '../services/questionBudgetService.js';

const router = express.Router();

const VALID_BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
const VALID_DIFFICULTIES = ['easy', 'moderate', 'hard'];

function normalizeBloomLevel(value) {
  if (!value || typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.toLowerCase().trim();
  return VALID_BLOOM_LEVELS.includes(normalized) ? normalized : undefined;
}

function normalizeDifficulty(value, bloomLevel) {
  if (value && typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    if (VALID_DIFFICULTIES.includes(normalized)) {
      return normalized;
    }
  }

  if (['remember'].includes(bloomLevel)) {
    return 'easy';
  }

  if (['apply', 'analyze', 'evaluate', 'create'].includes(bloomLevel)) {
    return 'hard';
  }

  return 'moderate';
}

function buildCompactPlanningHistory(existingQuestions = []) {
  if (!existingQuestions.length) {
    return '';
  }

  const summarizedQuestions = existingQuestions.slice(0, 20).map((question, index) => {
    const metadata = question.generationMetadata || {};
    const focus = metadata.focusArea || metadata.plannedSlice || metadata.subObjective || 'general focus';
    const bloom = metadata.bloomLevel ? `Bloom: ${metadata.bloomLevel}` : '';

    return [
      `${index + 1}. [${question.type}] ${question.questionText}`,
      `Focus: ${focus}`,
      bloom
    ].filter(Boolean).join(' | ');
  });

  const coveredFocusAreas = [...new Set(existingQuestions
    .map(question => question.generationMetadata?.focusArea || question.generationMetadata?.plannedSlice)
    .filter(Boolean))]
    .slice(0, 12);

  return [
    'EXISTING QUIZ HISTORY:',
    'The quiz already contains these questions or assessed focus areas:',
    summarizedQuestions.join('\n'),
    coveredFocusAreas.length ? `Already covered focus areas: ${coveredFocusAreas.join('; ')}` : '',
    'When creating the blueprint, avoid over-recommending the same focus areas, stems, scenarios, misconception targets, or answer patterns. Prefer uncovered LOs and uncovered slices unless the instructor explicitly asks to replace existing coverage.'
  ].filter(Boolean).join('\n');
}

/**
 * POST /api/plans/generate-ai
 * Generate AI-powered question distribution plan
 */
router.post('/generate-ai', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, totalQuestions, approach, additionalInstructions, sessionId } = req.body;
  const userId = req.user.id;
  const progressQuestionId = 'quiz-blueprint';
  const streamProgress = (status, message, metadata = {}) => {
    if (!sessionId) return;
    sseService.streamQuestionProgress(sessionId, progressQuestionId, {
      type: 'quiz-blueprint',
      status,
      message,
      metadata
    });
  };
  const requestedTotalQuestions = totalQuestions === undefined || totalQuestions === null || totalQuestions === ''
    ? null
    : Number(totalQuestions);

  // Validate inputs
  if (!quizId || !approach) {
    return errorResponse(res, 'Missing required fields: quizId, approach', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  if (!['support', 'assess', 'gamify'].includes(approach)) {
    return errorResponse(res, 'Invalid approach. Must be: support, assess, or gamify', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate('learningObjectives')
    .populate('materials');

  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Validate totalQuestions
  const minQuestions = Math.max(1, quiz.learningObjectives?.length || 0);
  const maxQuestions = 100;

  if (!quiz.learningObjectives?.length) {
    return errorResponse(
      res,
      'Quiz must have learning objectives before generating a plan',
      'NO_OBJECTIVES',
      HTTP_STATUS.BAD_REQUEST
    );
  }

  if (quiz.learningObjectives.length > maxQuestions) {
    return errorResponse(
      res,
      `This quiz has ${quiz.learningObjectives.length} learning objectives. Reduce the number of objectives before generating a plan with a ${maxQuestions}-question limit.`,
      'TOO_MANY_OBJECTIVES',
      HTTP_STATUS.BAD_REQUEST
    );
  }

  if (
    requestedTotalQuestions !== null &&
    (
      !Number.isInteger(requestedTotalQuestions) ||
      requestedTotalQuestions < minQuestions ||
      requestedTotalQuestions > maxQuestions
    )
  ) {
    return errorResponse(res, `Total questions must be a whole number between ${minQuestions} and ${maxQuestions}`, 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    if (sessionId) {
      sseService.notifyBatchStarted(sessionId, {
        totalQuestions: 1,
        workflow: 'quiz-blueprint',
        message: 'Quiz blueprint generation started'
      });
    }
    streamProgress('started', 'Resolving prompt strategy and quiz context...');
    // Step 1: Resolve prompt template from database.
    // Priority: course override > user override > system default.
    // The system outer prompt remains authoritative so user edits cannot break JSON shape.
    const systemTemplate = await SystemPromptTemplate.findOne({
      approach,
      isActive: true
    });

    if (!systemTemplate) {
      return errorResponse(res, `No prompt template found for approach: ${approach}`, 'TEMPLATE_NOT_FOUND', HTTP_STATUS.NOT_FOUND);
    }

    const [courseOverride, userOverride, resolvedBlueprintPrompt] = await Promise.all([
      CoursePromptOverride.findOne({
        folder: quiz.folder,
        user: userId,
        promptType: 'quiz-blueprint',
        approach,
        isActive: true
      }).sort({ version: -1 }),
      UserPromptOverride.findOne({
        user: userId,
        approach,
        isActive: true
      }),
      coursePromptService.resolveCoursePrompt({
        folderId: quiz.folder,
        userId,
        promptType: 'quiz-blueprint',
        approach
      })
    ]);

    const resolvedInnerPrompt = resolvedBlueprintPrompt.innerPrompt;

    const resolvedRules =
      courseOverride?.customQuestionTypeRules ||
      userOverride?.customQuestionTypeRules ||
      systemTemplate.questionTypeRules;

    const questionBudget = buildQuestionBudget(quiz.learningObjectives, {
      approach,
      requestedTotal: requestedTotalQuestions,
      maxQuestions
    });
    const effectiveTotalQuestions = questionBudget.total;
    streamProgress('budget-complete', `Calculated a ${effectiveTotalQuestions}-question coverage budget.`, {
      total: effectiveTotalQuestions,
      method: questionBudget.method,
      allocations: questionBudget.allocations.length
    });

    console.log('🧮 Deterministic question budget:', {
      method: questionBudget.method,
      approach,
      requestedTotalQuestions,
      total: questionBudget.total,
      allocations: questionBudget.allocations.map(allocation => ({
        learningObjectiveIndex: allocation.learningObjectiveIndex,
        count: allocation.count,
        subpointCount: allocation.subpointCount,
        bloomLevel: allocation.bloomLevel,
        rationale: allocation.rationale
      }))
    });

    // Step 2: Build context variables
    const objectivesText = quiz.learningObjectives
      .map((lo, idx) => {
        const metadata = lo.generationMetadata || {};
        const details = [
          metadata.topic ? `Topic: ${metadata.topic}` : '',
          metadata.subtopic ? `Subtopic: ${metadata.subtopic}` : '',
          Array.isArray(metadata.subpoints) && metadata.subpoints.length
            ? `Subpoints: ${metadata.subpoints.join('; ')}`
            : '',
          metadata.bloomLevel ? `Bloom: ${metadata.bloomLevel}` : '',
          metadata.rationale ? `Rationale: ${metadata.rationale}` : ''
        ].filter(Boolean).join(' | ');

        return `${idx}: ${lo.text}${details ? `\n   ${details}` : ''}`;
      })
      .join('\n');

    const materialsContext = quiz.materials && quiz.materials.length > 0
      ? `Course materials: ${quiz.materials.map(m => m.name || m.title || 'Untitled').join(', ')}`
      : 'No course materials assigned.';

    const existingQuestions = await Question.find({ quiz: quizId })
      .select('questionText type generationMetadata.focusArea generationMetadata.plannedSlice generationMetadata.subObjective generationMetadata.bloomLevel')
      .sort({ order: 1 })
      .lean();
    const planningHistoryContext = buildCompactPlanningHistory(existingQuestions);
    streamProgress('context-complete', 'Built LO, material, and question-history context.', {
      learningObjectives: quiz.learningObjectives.length,
      existingQuestions: existingQuestions.length
    });

    const additionalContext = additionalInstructions
      ? `\n\nAdditional instructions from instructor: ${additionalInstructions}`
      : '';

    // Step 3: Build the complete prompt by replacing variables
    const innerPrompt = resolvedInnerPrompt + additionalContext;

    const totalQuestionInstruction = effectiveTotalQuestions;

    let prompt = systemTemplate.outerPrompt;
    prompt = prompt
      .replace('{{learningObjectives}}', objectivesText)
      .replace('{{materialsContext}}', materialsContext)
      .replaceAll('{{totalQuestions}}', String(totalQuestionInstruction))
      .replace('{{innerPrompt}}', innerPrompt);

    prompt += `\n\nBLUEPRINT METADATA REQUIREMENTS:
At the beginning of the JSON response, include "generationSummary" as an array of 3-6 short, instructor-facing statements that explain the visible blueprint decisions. Summarize coverage, question-type mix, Bloom/difficulty balance, and use of subpoints or history. Do not include private chain-of-thought or hidden reasoning.

For every planItems entry, include:
- "difficulty": one of "easy", "moderate", "hard"
- "bloomLevel": one of "remember", "understand", "apply", "analyze", "evaluate", "create"
- "focusArea": a concise assessable slice, misconception, skill, process step, or application context
- "rationale": a short instructor-facing reason for this row

Use Bloom level to vary cognitive demand. Avoid assigning every row the same focusArea. If an LO is broad, split its coverage across different concrete focus areas.

SUBPOINT COVERAGE RULES:
- If a learning objective includes Subpoints, use them as the primary coverage checklist.
- Do not generate only broad all-in-one plan rows when subpoints are available.
- For multiple questions under the same LO, assign different focusArea values that map to different subpoints.
- If problem set materials are available, use them as style/difficulty signals, but keep conceptual grounding in the lecture/notes evidence.`;

    const budgetLines = questionBudget.allocations.map(allocation => {
      const subpointSummary = allocation.subpoints.length
        ? ` Subpoints: ${allocation.subpoints.join('; ')}`
        : '';
      return `- LO ${allocation.learningObjectiveIndex + 1}: EXACTLY ${allocation.count} question(s). ${allocation.rationale}.${subpointSummary}`;
    });

    prompt += `\n\nAUTHORITATIVE QUESTION BUDGET:
- The backend has already calculated the question count. Do not recommend or change it.
- The sum of every planItems count MUST equal EXACTLY ${effectiveTotalQuestions}.
- The sum for each learningObjectiveIndex MUST match its allocation below.
${budgetLines.join('\n')}
- You decide question types, difficulty, Bloom alignment, focus areas, and pedagogical rationale within this fixed budget.`;

    if (planningHistoryContext) {
      prompt += `\n\n${planningHistoryContext}`;
    }

    if (requestedTotalQuestions === null) {
      prompt += `\n\nAUTO QUESTION COUNT MODE:
- The instructor did not provide a fixed total question count.
- CREATE already calculated ${effectiveTotalQuestions} questions from LO breadth, subpoints, Bloom levels, and the selected pedagogical approach.
- Treat this total and every per-LO allocation as fixed constraints.
- Include "recommendedTotalQuestions" and "totalQuestionRationale" in the JSON response.
- Set "recommendedTotalQuestions" to ${effectiveTotalQuestions}.

Return ONLY this JSON shape:
{
  "generationSummary": [
    "Coverage decision stated in one short sentence",
    "Question-type or difficulty decision stated in one short sentence"
  ],
  "recommendedTotalQuestions": ${effectiveTotalQuestions},
  "totalQuestionRationale": "Short explanation of how the fixed coverage budget supports the quiz",
  "planItems": [
    { "type": "multiple-choice", "learningObjectiveIndex": 0, "count": 2, "difficulty": "moderate", "bloomLevel": "understand", "focusArea": "specific assessable slice", "rationale": "Short reason for this row" }
  ]
}`;
    }

    console.log('📋 Using prompt template:', {
      approach,
      source: resolvedBlueprintPrompt.source,
      promptType: 'quiz-blueprint',
      version: courseOverride?.version || 'default',
      folderId: quiz.folder?.toString(),
      userId
    });

    console.log('🤖 Generating AI plan with prompt:', prompt.substring(0, 200) + '...');

    // Call the active user's model rather than the server's startup default.
    if (!llmService) {
      return errorResponse(res, 'LLM service not available', 'AI_SERVICE_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }

    const llmConfig = await llmService.resolveUserLLMConfig(userId);
    console.log(`🤖 Generating AI plan with ${llmConfig.provider} model: ${llmConfig.model}`);
    streamProgress('llm-started', `Calling ${llmConfig.model} to draft the quiz blueprint...`);
    const response = await llmService.streamCompletion({
      prompt,
      userId,
      llmConfig,
      temperature: 0.3,
      maxTokens: 2400
    }, (textChunk, metadata) => {
      if (!sessionId || !metadata?.partial || !textChunk) return;
      sseService.streamTextChunk(sessionId, progressQuestionId, textChunk, {
        contentType: 'quiz-blueprint-json',
        model: llmConfig.model,
        totalLength: metadata.totalLength,
        isPartial: true
      });
    });
    streamProgress('llm-complete', 'Blueprint draft returned. Validating structure...');

    console.log('🤖 Raw LLM response:', response);

    // Parse response - extract content from response object
    let planData;
    try {
      // LLM returns an object with 'content' field
      const responseText = typeof response === 'string' ? response : response.content;
      if (!responseText) {
        throw new Error('No content in LLM response');
      }

      // Extract JSON from response (handle markdown code blocks)
      let jsonText = responseText.trim();

      // Try multiple extraction strategies
      if (jsonText.includes('```json')) {
        const parts = jsonText.split('```json');
        if (parts.length > 1) {
          jsonText = parts[1].split('```')[0].trim();
        }
      } else if (jsonText.includes('```')) {
        const parts = jsonText.split('```');
        if (parts.length > 1) {
          jsonText = parts[1].split('```')[0].trim();
        }
      }

      // Try to find JSON object in text
      const jsonMatch = jsonText.match(/\{[\s\S]*"planItems"[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }

      console.log('📝 Extracted JSON text:', jsonText);
      planData = JSON.parse(jsonText);
      streamProgress('parse-complete', 'Blueprint JSON parsed successfully.');
    } catch (parseError) {
      console.error('❌ Failed to parse LLM response:', parseError);
      const responseText = typeof response === 'string' ? response : response.content || JSON.stringify(response);
      console.error('❌ Response text:', responseText.substring(0, 500));
      return errorResponse(res, `Failed to parse AI response: ${parseError.message}`, 'AI_PARSE_ERROR', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }

    // Validate plan
    if (!planData.planItems || !Array.isArray(planData.planItems)) {
      return errorResponse(res, 'Invalid AI response format', 'AI_INVALID_FORMAT', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }

    // LLMs can occasionally return an obsolete or one-based LO index. Treat it
    // as recoverable model output: remove the bad row and let the fixed budget
    // restore coverage for that objective below.
    const sanitizedPlan = discardPlanItemsOutsideBudget(planData.planItems, questionBudget);
    if (sanitizedPlan.discardedIndexes.length) {
      console.warn('⚠️ Discarded AI plan rows with invalid learning objective indexes:', {
        discardedIndexes: sanitizedPlan.discardedIndexes,
        validIndexes: questionBudget.allocations.map(allocation => allocation.learningObjectiveIndex)
      });
    }
    planData.planItems = sanitizedPlan.items;

    const beforeCountSanitization = planData.planItems.length;
    planData.planItems = planData.planItems
      .map(item => ({
        ...item,
        count: Number.parseInt(item.count, 10)
      }))
      .filter(item => Number.isInteger(item.count) && item.count >= 1);

    if (planData.planItems.length !== beforeCountSanitization) {
      console.warn('⚠️ Discarded AI plan rows with invalid question counts before budget rebalance:', {
        discardedRows: beforeCountSanitization - planData.planItems.length
      });
      streamProgress('count-sanitized', 'Removed invalid zero-count blueprint rows before budget alignment.', {
        discardedRows: beforeCountSanitization - planData.planItems.length
      });
    }

    // Step 4: Validate each item
    const validTypes = Object.values(QUESTION_TYPES);
    const rules = resolvedRules;
    const allowedTypes = rules?.allowedTypes || validTypes;
    const maxPerLO = rules?.maxPerLO || new Map();

    let totalCount = 0;
    const countPerLO = {}; // Track count by type per LO

    for (const item of planData.planItems) {
      item.bloomLevel = normalizeBloomLevel(item.bloomLevel);
      item.difficulty = normalizeDifficulty(item.difficulty, item.bloomLevel);
      item.pedagogicalIntent = ['support', 'assess', 'gamify'].includes(item.pedagogicalIntent)
        ? item.pedagogicalIntent
        : approach;
      item.focusArea = typeof item.focusArea === 'string' && item.focusArea.trim()
        ? item.focusArea.trim().slice(0, 300)
        : `LO ${item.learningObjectiveIndex + 1} ${item.type} focus`;
      item.rationale = typeof item.rationale === 'string' && item.rationale.trim()
        ? item.rationale.trim().slice(0, 1000)
        : `Uses ${item.type} to support the ${approach} teaching purpose for this learning objective.`;

      // Check if type is valid
      if (!validTypes.includes(item.type)) {
        return errorResponse(res, `Invalid question type: ${item.type}`, 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
      }

      // Check if type is allowed by template rules
      if (allowedTypes.length > 0 && !allowedTypes.includes(item.type)) {
        console.warn(`⚠️ Question type ${item.type} not in allowed list for ${approach} approach. Allowed: ${allowedTypes.join(', ')}`);
        // Don't reject - just warn, as LLM might have a good reason
      }

      // Check LO index
      if (item.learningObjectiveIndex < 0 || item.learningObjectiveIndex >= quiz.learningObjectives.length) {
        return errorResponse(res, `Invalid learning objective index: ${item.learningObjectiveIndex}`, 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
      }

      // Check count
      if (!item.count || item.count < 1) {
        return errorResponse(res, 'Each plan item must have count >= 1', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
      }

      // Track count per LO per type
      const key = `${item.learningObjectiveIndex}-${item.type}`;
      countPerLO[key] = (countPerLO[key] || 0) + item.count;

      totalCount += item.count;
    }

    // Validate maxPerLO constraints
    for (const [key, count] of Object.entries(countPerLO)) {
      const [loIndex, type] = key.split('-');
      const maxAllowed = maxPerLO.get(type);
      if (maxAllowed && count > maxAllowed) {
        console.warn(`⚠️ LO ${loIndex} has ${count} ${type} questions, but max is ${maxAllowed}. Will adjust.`);
        // Could auto-fix here if needed
      }
    }

    // Step 5: Treat the deterministic budget as authoritative even if the LLM
    // returns a different total or omits a learning objective.
    const fallbackType = allowedTypes[0] || 'multiple-choice';
    planData.planItems = rebalancePlanToBudget(
      planData.planItems,
      questionBudget,
      fallbackType,
      approach
    );
    planData.planItems = alignPlanItemsToSubpoints(
      planData.planItems,
      quiz.learningObjectives
    );
    streamProgress('budget-aligned', 'Aligned blueprint rows to LO subpoints and the fixed question budget.');

    totalCount = planData.planItems.reduce((sum, item) => sum + item.count, 0);
    const finalCountsByLO = planData.planItems.reduce((counts, item) => {
      counts[item.learningObjectiveIndex] = (counts[item.learningObjectiveIndex] || 0) + item.count;
      return counts;
    }, {});

    const mismatchedAllocation = questionBudget.allocations.find(allocation => (
      finalCountsByLO[allocation.learningObjectiveIndex] !== allocation.count
    ));

    if (totalCount !== questionBudget.total || mismatchedAllocation) {
      console.error('❌ Failed to enforce deterministic question budget:', {
        expectedTotal: questionBudget.total,
        actualTotal: totalCount,
        expectedAllocations: questionBudget.allocations,
        actualCountsByLO: finalCountsByLO
      });
      return errorResponse(
        res,
        'Failed to align the generated plan with the learning-objective budget',
        'PLAN_BUDGET_ERROR',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    planData.recommendedTotalQuestions = questionBudget.total;
    planData.totalQuestionStrategy = requestedTotalQuestions === null
      ? 'ai-recommended'
      : 'user-specified';
    planData.totalQuestionRationale = questionBudget.rationale;
    planData.questionBudget = {
      method: questionBudget.method,
      approach,
      total: questionBudget.total,
      allocations: questionBudget.allocations.map(allocation => ({
        learningObjectiveIndex: allocation.learningObjectiveIndex,
        count: allocation.count,
        subpointCount: allocation.subpointCount,
        bloomLevel: allocation.bloomLevel,
        rationale: allocation.rationale
      }))
    };
    planData.promptProvenance = {
      promptType: 'quiz-blueprint',
      source: courseOverride ? 'course' : userOverride ? 'user' : 'system',
      version: courseOverride?.version || null,
      approach
    };

    console.log('✅ AI plan validated and adjusted:', planData);
    if (sessionId) {
      sseService.notifyQuestionComplete(sessionId, progressQuestionId, {
        planItems: planData.planItems.length,
        totalQuestions: planData.recommendedTotalQuestions || effectiveTotalQuestions,
        promptProvenance: planData.promptProvenance
      });
      sseService.notifyBatchComplete(sessionId, {
        totalGenerated: 1,
        totalFailed: 0,
        workflow: 'quiz-blueprint'
      });
    }

    return successResponse(res, planData, 'AI plan generated successfully', HTTP_STATUS.OK);

  } catch (error) {
    console.error('❌ AI plan generation error:', error);
    if (sessionId) {
      sseService.emitError(sessionId, progressQuestionId, error.message, 'quiz-blueprint-error');
      sseService.notifyBatchComplete(sessionId, {
        totalGenerated: 0,
        totalFailed: 1,
        workflow: 'quiz-blueprint'
      });
    }
    return errorResponse(res, 'Failed to generate AI plan', 'AI_SERVICE_ERROR', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}));

/**
 * POST /api/plans/generate
 * Generate AI plan for quiz
 */
router.post('/generate', authenticateToken, validateGeneratePlan, asyncHandler(async (req, res) => {
  const { quizId, approach, questionsPerLO = 3, customFormula } = req.body;
  const userId = req.user.id;
  
  console.log('🔍 Plan generation request received:', {
    quizId,
    approach,
    questionsPerLO,
    hasCustomFormula: !!customFormula,
    customFormula: customFormula ? JSON.stringify(customFormula, null, 2) : 'none'
  });

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Get learning objectives
  const objectives = await LearningObjective.find({ quiz: quizId }).sort({ order: 1 });
  if (objectives.length === 0) {
    return errorResponse(res, 'Quiz must have learning objectives before generating a plan', 'NO_OBJECTIVES', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    // Get user preferences for metadata
    const { default: User } = await import('../models/User.js');
    const user = await User.findById(userId).select('preferences');
    const userPreferences = user?.preferences || null;
    
    // Generate plan based on pedagogical approach or custom formula
    const breakdown = [];
    let totalQuestions;
    let actualQuestionsPerLO = questionsPerLO;

    if (customFormula && customFormula.questionTypes) {
      // Use custom formula
      console.log('🎯 Using custom formula:', customFormula);
      
      // Filter question types by scope
      const perLOTypes = customFormula.questionTypes.filter(qt => qt.scope === 'per-lo');
      const wholeQuizTypes = customFormula.questionTypes.filter(qt => qt.scope === 'whole-quiz');
      
      actualQuestionsPerLO = customFormula.totalPerLO || questionsPerLO;
      totalQuestions = customFormula.totalQuestions || (objectives.length * actualQuestionsPerLO);

      // Generate breakdown for each learning objective using per-LO question types
      for (const objective of objectives) {
        const questionTypes = [];
        
        for (const customType of perLOTypes) {
          if (customType.count > 0) {
            questionTypes.push({
              type: customType.type,
              count: customType.count,
              reasoning: `Custom formula: ${customType.count} ${customType.type} questions (${customType.percentage}%)`
            });
          }
        }

        breakdown.push({
          learningObjective: objective._id,
          questionTypes
        });
      }

      // Add whole-quiz questions to the breakdown (they go to the last objective for simplicity)
      if (wholeQuizTypes.length > 0 && breakdown.length > 0) {
        const wholeQuizQuestionTypes = wholeQuizTypes.map(customType => ({
          type: customType.type,
          count: customType.count,
          reasoning: `Whole quiz: ${customType.count} ${customType.type} questions`
        }));
        
        // Add to the last learning objective with a note
        breakdown[breakdown.length - 1].questionTypes.push(...wholeQuizQuestionTypes);
      }
    } else {
      // Use default pedagogical approach
      const questionTypeDistribution = getQuestionTypeDistribution(approach);

      for (const objective of objectives) {
        const questionTypes = [];
        
        // Distribute question types for this objective
        for (const [type, percentage] of Object.entries(questionTypeDistribution)) {
          const count = Math.round((percentage / 100) * actualQuestionsPerLO);
          if (count > 0) {
            questionTypes.push({
              type,
              count,
              reasoning: getReasoningForQuestionType(type, approach)
            });
          }
        }

        breakdown.push({
          learningObjective: objective._id,
          questionTypes
        });
      }

      totalQuestions = objectives.length * actualQuestionsPerLO;
    }

    // Calculate overall distribution
    const distribution = [];
    const typeCounts = {};

    breakdown.forEach(lo => {
      lo.questionTypes.forEach(qt => {
        typeCounts[qt.type] = (typeCounts[qt.type] || 0) + qt.count;
      });
    });

    Object.entries(typeCounts).forEach(([type, count]) => {
      distribution.push({
        type,
        totalCount: count,
        percentage: Math.round((count / totalQuestions) * 100)
      });
    });

    const planData = {
      quiz: quizId,
      approach,
      questionsPerLO: actualQuestionsPerLO,
      totalQuestions,
      breakdown,
      distribution,
      generationMetadata: {
        llmModel: userPreferences?.llmModel || 'llama3.1:8b',
        generationPrompt: customFormula ? 'Generate custom formula plan' : `Generate ${approach} pedagogy plan`,
        processingTime: 1500,
        confidence: 0.9,
        reasoning: `Generated plan using ${approach} pedagogical approach with ${actualQuestionsPerLO} questions per learning objective`
      },
      createdBy: userId
    };

    // Add custom formula if provided
    if (customFormula) {
      planData.customFormula = customFormula;
      console.log('💾 Saving custom formula to database:', customFormula);
    }

    const plan = new GenerationPlan(planData);
    
    // Manually update distribution since pre-save middleware is disabled
    try {
      if (typeof plan.updateDistribution === 'function') {
        console.log('📋 Manually updating distribution for new plan');
        plan.updateDistribution();
      }
    } catch (error) {
      console.error('❌ Error updating distribution for new plan:', error);
    }

    await plan.save();
    console.log('✅ Plan saved successfully with ID:', plan._id);
    console.log('📋 Saved plan data:', {
      approach: plan.approach,
      questionsPerLO: plan.questionsPerLO,
      totalQuestions: plan.totalQuestions,
      hasCustomFormula: !!plan.customFormula,
      customFormula: plan.customFormula
    });
    
    // Add plan to quiz
    if (quiz.generationPlans) {
      quiz.generationPlans.push(plan._id);
    } else {
      quiz.generationPlans = [plan._id];
    }
    await quiz.save();

    return successResponse(res, { plan }, 'Generation plan created successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('Plan generation error:', error);
    return errorResponse(res, 'Failed to generate plan', 'PLAN_GENERATION_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * GET /api/plans/quiz/:quizId
 * Get plans for quiz
 */
router.get('/quiz/:quizId', authenticateToken, validateQuizId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const plans = await GenerationPlan.find({ quiz: quizId })
    .populate({
      path: 'breakdown.learningObjective',
      select: 'text order'
    })
    .sort({ createdAt: -1 });

  return successResponse(res, { plans }, 'Generation plans retrieved successfully');
}));

/**
 * GET /api/plans/:id
 * Get specific plan details
 */
router.get('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const userId = req.user.id;

  const plan = await GenerationPlan.findOne({ _id: planId, createdBy: userId })
    .populate({
      path: 'quiz',
      select: 'name status'
    })
    .populate({
      path: 'breakdown.learningObjective',
      select: 'text order'
    });

  if (!plan) {
    return notFoundResponse(res, 'Generation plan');
  }

  return successResponse(res, { plan }, 'Generation plan retrieved successfully');
}));

/**
 * PUT /api/plans/:id
 * Modify plan breakdown
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const userId = req.user.id;
  const { breakdown } = req.body;

  const plan = await GenerationPlan.findOne({ _id: planId, createdBy: userId });
  if (!plan) {
    return notFoundResponse(res, 'Generation plan');
  }

  if (breakdown) {
    await plan.updateBreakdown(breakdown, userId);
  }

  const updatedPlan = await GenerationPlan.findById(planId)
    .populate({
      path: 'breakdown.learningObjective',
      select: 'text order'
    });

  return successResponse(res, { plan: updatedPlan }, 'Generation plan updated successfully');
}));

/**
 * POST /api/plans/:id/approve
 * Approve plan (set as active)
 */
router.post('/:id/approve', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const userId = req.user.id;

  const plan = await GenerationPlan.findOne({ _id: planId, createdBy: userId });
  if (!plan) {
    return notFoundResponse(res, 'Generation plan');
  }

  console.log('📋 About to approve plan:', planId, 'plan type:', plan.constructor.name);
  console.log('📋 Plan has approve method:', typeof plan.approve);
  console.log('📋 Plan has isModified method:', typeof plan.isModified);

  await plan.approve();

  // Set as active plan in quiz
  const quiz = await Quiz.findById(plan.quiz);
  if (quiz) {
    await quiz.setActivePlan(planId);
  }

  return successResponse(res, { plan }, 'Generation plan approved successfully');
}));

/**
 * DELETE /api/plans/:id
 * Delete plan
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const userId = req.user.id;

  const plan = await GenerationPlan.findOne({ _id: planId, createdBy: userId });
  if (!plan) {
    return notFoundResponse(res, 'Generation plan');
  }

  // Check if plan is active
  const quiz = await Quiz.findById(plan.quiz);
  if (quiz && quiz.activePlan && quiz.activePlan.equals(planId)) {
    return errorResponse(res, 'Cannot delete active plan', 'ACTIVE_PLAN_DELETE', HTTP_STATUS.BAD_REQUEST);
  }

  await GenerationPlan.findByIdAndDelete(planId);

  return successResponse(res, null, 'Generation plan deleted successfully');
}));

// Helper functions
function getQuestionTypeDistribution(approach) {
  const distributions = {
    [PEDAGOGICAL_APPROACHES.SUPPORT]: {
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 40,
      [QUESTION_TYPES.TRUE_FALSE]: 20,
      [QUESTION_TYPES.FLASHCARD]: 30,
      [QUESTION_TYPES.SUMMARY]: 10
    },
    [PEDAGOGICAL_APPROACHES.ASSESS]: {
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 50,
      [QUESTION_TYPES.TRUE_FALSE]: 20,
      [QUESTION_TYPES.DISCUSSION]: 20,
      [QUESTION_TYPES.SUMMARY]: 10
    },
    [PEDAGOGICAL_APPROACHES.GAMIFY]: {
      [QUESTION_TYPES.MATCHING]: 30,
      [QUESTION_TYPES.ORDERING]: 25,
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 25,
      [QUESTION_TYPES.FLASHCARD]: 20
    },
    [PEDAGOGICAL_APPROACHES.CUSTOM]: {
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 35,
      [QUESTION_TYPES.TRUE_FALSE]: 15,
      [QUESTION_TYPES.FLASHCARD]: 15,
      [QUESTION_TYPES.DISCUSSION]: 15,
      [QUESTION_TYPES.SUMMARY]: 10,
      [QUESTION_TYPES.MATCHING]: 10
    }
  };

  return distributions[approach] || distributions[PEDAGOGICAL_APPROACHES.SUPPORT];
}

function getReasoningForQuestionType(type, approach) {
  const reasonings = {
    [QUESTION_TYPES.MULTIPLE_CHOICE]: `Multiple choice questions provide clear assessment with immediate feedback, suitable for ${approach} approach`,
    [QUESTION_TYPES.TRUE_FALSE]: `True/false questions test basic understanding and work well for quick comprehension checks`,
    [QUESTION_TYPES.FLASHCARD]: `Flashcards support active recall and spaced repetition learning`,
    [QUESTION_TYPES.SUMMARY]: `Summary questions encourage synthesis and deeper understanding`,
    [QUESTION_TYPES.DISCUSSION]: `Discussion prompts foster critical thinking and analysis`,
    [QUESTION_TYPES.MATCHING]: `Matching exercises help connect related concepts in an engaging way`,
    [QUESTION_TYPES.ORDERING]: `Ordering questions test understanding of sequences and relationships`,
    [QUESTION_TYPES.CLOZE]: `Fill-in-the-blank questions test specific knowledge retention`
  };

  return reasonings[type] || 'Selected to support learning objectives';
}

export default router;
