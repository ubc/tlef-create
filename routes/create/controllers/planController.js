import express from 'express';
import GenerationPlan from '../models/GenerationPlan.js';
import Quiz from '../models/Quiz.js';
import LearningObjective from '../models/LearningObjective.js';
import Material from '../models/Material.js';
import SystemPromptTemplate from '../models/SystemPromptTemplate.js';
import UserPromptOverride from '../models/UserPromptOverride.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateGeneratePlan, validateMongoId, validateQuizId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, PEDAGOGICAL_APPROACHES, QUESTION_TYPES } from '../config/constants.js';
import llmService from '../services/llmService.js';

const router = express.Router();

/**
 * POST /api/plans/generate-ai
 * Generate AI-powered question distribution plan
 */
router.post('/generate-ai', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, totalQuestions, approach, additionalInstructions } = req.body;
  const userId = req.user.id;

  // Validate inputs
  if (!quizId || !totalQuestions || !approach) {
    return errorResponse(res, 'Missing required fields: quizId, totalQuestions, approach', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
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

  if (!quiz.learningObjectives || quiz.learningObjectives.length === 0) {
    return errorResponse(res, 'Quiz must have learning objectives', 'NO_OBJECTIVES', HTTP_STATUS.BAD_REQUEST);
  }

  // Validate totalQuestions based on number of LOs
  const minQuestions = quiz.learningObjectives.length; // At least 1 per LO
  const maxQuestions = 100;

  if (totalQuestions < minQuestions || totalQuestions > maxQuestions) {
    return errorResponse(res, `Total questions must be between ${minQuestions} and ${maxQuestions}`, 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    // Step 1: Get prompt template from database
    // First check if user has a custom override
    let promptTemplate = await UserPromptOverride.findOne({
      user: userId,
      approach,
      isActive: true
    });

    // If no user override, use system template
    if (!promptTemplate) {
      promptTemplate = await SystemPromptTemplate.findOne({
        approach,
        isActive: true
      });
    }

    if (!promptTemplate) {
      return errorResponse(res, `No prompt template found for approach: ${approach}`, 'TEMPLATE_NOT_FOUND', HTTP_STATUS.NOT_FOUND);
    }

    // Step 2: Build context variables
    const objectivesText = quiz.learningObjectives
      .map((lo, idx) => `${idx}: ${lo.text}`)
      .join('\n');

    const materialsContext = quiz.materials && quiz.materials.length > 0
      ? `Course materials: ${quiz.materials.map(m => m.title || 'Untitled').join(', ')}`
      : 'No course materials assigned.';

    const additionalContext = additionalInstructions
      ? `\n\nAdditional instructions from instructor: ${additionalInstructions}`
      : '';

    // Step 3: Build the complete prompt by replacing variables
    const innerPrompt = (promptTemplate.customInnerPrompt || promptTemplate.innerPrompt) + additionalContext;

    let prompt = promptTemplate.outerPrompt || promptTemplate.outerPrompt;
    prompt = prompt
      .replace('{{learningObjectives}}', objectivesText)
      .replace('{{materialsContext}}', materialsContext)
      .replace('{{totalQuestions}}', totalQuestions)
      .replace('{{innerPrompt}}', innerPrompt);

    console.log('📋 Using prompt template:', {
      approach,
      isCustom: !!promptTemplate.customInnerPrompt,
      userId: promptTemplate.user || 'system'
    });

    console.log('🤖 Generating AI plan with prompt:', prompt.substring(0, 200) + '...');

    // Call LLM
    if (!llmService || !llmService.llm) {
      return errorResponse(res, 'LLM service not available', 'AI_SERVICE_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }

    const options = llmService.getSendMessageOptions(0.7, 2000);
    const response = await llmService.llm.sendMessage(prompt, options);

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

    // Step 4: Validate each item
    const validTypes = Object.values(QUESTION_TYPES);
    const rules = promptTemplate.customQuestionTypeRules || promptTemplate.questionTypeRules;
    const allowedTypes = rules?.allowedTypes || validTypes;
    const maxPerLO = rules?.maxPerLO || new Map();

    let totalCount = 0;
    const countPerLO = {}; // Track count by type per LO

    for (const item of planData.planItems) {
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

    // Step 5: Ensure all LOs are covered
    const coveredLOs = new Set(planData.planItems.map(item => item.learningObjectiveIndex));
    const missingLOs = [];
    for (let i = 0; i < quiz.learningObjectives.length; i++) {
      if (!coveredLOs.has(i)) {
        missingLOs.push(i);
      }
    }

    if (missingLOs.length > 0) {
      console.warn(`⚠️ Missing LOs: ${missingLOs.join(', ')}. Adding them...`);
      const firstAllowedType = allowedTypes[0] || 'multiple-choice';
      for (const loIndex of missingLOs) {
        planData.planItems.push({
          type: firstAllowedType,
          learningObjectiveIndex: loIndex,
          count: 1
        });
        totalCount += 1;
      }
    }

    // Step 6: Adjust total count if it doesn't match exactly
    if (totalCount !== totalQuestions) {
      console.warn(`⚠️ AI generated ${totalCount} questions but requested ${totalQuestions}. Adjusting...`);

      const diff = totalQuestions - totalCount;

      if (diff > 0) {
        // Need to add more questions - distribute evenly across all items
        let remaining = diff;
        const itemsCount = planData.planItems.length;
        const addPerItem = Math.floor(diff / itemsCount);

        if (addPerItem > 0) {
          planData.planItems.forEach(item => {
            item.count += addPerItem;
            remaining -= addPerItem;
          });
        }

        // Add remaining to first items
        for (let i = 0; i < remaining; i++) {
          planData.planItems[i].count += 1;
        }

        console.log(`✅ Added ${diff} questions distributed across items`);
      } else if (diff < 0) {
        // Need to remove questions - remove from items with count > 1, starting from the end
        let toRemove = Math.abs(diff);
        for (let i = planData.planItems.length - 1; i >= 0 && toRemove > 0; i--) {
          const item = planData.planItems[i];
          const canRemove = Math.min(item.count - 1, toRemove); // Keep at least 1
          if (canRemove > 0) {
            item.count -= canRemove;
            toRemove -= canRemove;
          }
        }

        console.log(`✅ Removed ${Math.abs(diff)} questions to match total`);
      }
    }

    console.log('✅ AI plan validated and adjusted:', planData);

    return successResponse(res, planData, 'AI plan generated successfully', HTTP_STATUS.OK);

  } catch (error) {
    console.error('❌ AI plan generation error:', error);
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