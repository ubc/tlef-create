import { planLOSlices } from './loSlicePlanner.js';
import coursePromptService from './coursePromptService.js';
import questionMemoryService, { buildQuestionMemory } from './questionMemoryService.js';
import sseService from './sseService.js';
import { isCustomPromptOnly } from '../utils/generationReadiness.js';
import { assertGenerationActive, runWithGenerationDeadline } from '../utils/generationDeadline.js';
import { safeQuestionJobFailure } from './questionGenerationJobs.js';
import { QUESTION_TYPES } from '../config/constants.js';
import Material from '../models/Material.js';

/**
 * Enrich question configs with learning objective ObjectIds from quiz.
 * Maps text or index-based LO references to actual Mongoose documents.
 */
function enrichQuestionConfigsWithObjectives(questionConfigs, quiz) {
  const hasLOs = quiz.learningObjectives && quiz.learningObjectives.length > 0;

  return questionConfigs.map((config, index) => {
    // If the config has no LO reference and uses a custom prompt, allow null LO
    if (!hasLOs || config.useCustomPromptOnly) {
      return { ...config, learningObjective: null };
    }

    let learningObjective;

    if (config.learningObjectiveId) {
      learningObjective = quiz.learningObjectives.find(lo => String(lo._id) === String(config.learningObjectiveId));
    } else if (config.learningObjectiveIndex !== undefined) {
      learningObjective = quiz.learningObjectives[config.learningObjectiveIndex];
    } else if (config.learningObjective) {
      learningObjective = quiz.learningObjectives.find(lo => lo.text === config.learningObjective);
    } else {
      learningObjective = quiz.learningObjectives[index % quiz.learningObjectives.length];
    }

    return {
      ...config,
      learningObjective: learningObjective || quiz.learningObjectives[0]
    };
  });
}

function getLearningObjectiveText(config) {
  if (typeof config.learningObjective === 'string') {
    return config.learningObjective;
  }

  return config.learningObjective?.text || '';
}

function buildPlanningGroupKey(config) {
  const loText = getLearningObjectiveText(config);
  return [
    config.learningObjective?._id?.toString?.() || config.learningObjectiveId || loText,
    config.questionType,
    config.selectionMode || 'single',
    config.customPrompt || ''
  ].join('::');
}

/**
 * Assign a distinct LO slice to each repeated config before parallel generation.
 * This prevents parallel LLM calls from independently choosing the same narrow focus.
 */
function attachPlannedTasksToQuestionConfigs(questionConfigs) {
  const groups = new Map();

  questionConfigs.forEach((config, index) => {
    const loText = getLearningObjectiveText(config);
    if (!loText || !config.questionType) {
      return;
    }

    const groupKey = buildPlanningGroupKey(config);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push({ config, index, loText });
  });

  const plannedConfigs = questionConfigs.map(config => ({ ...config }));

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const slicePlan = planLOSlices({
      learningObjective: group[0].loText,
      questionType: group[0].config.questionType,
      requestedCount: group.length,
      subpoints: group[0].config.learningObjective?.generationMetadata?.subpoints || []
    });

    console.log(
      `🧩 Streaming slice plan for ${group[0].config.questionType}:`,
      slicePlan.recommendedTasks.map(task => task.sliceLabel).join(' | ')
    );

    group.forEach(({ index }, taskIndex) => {
      plannedConfigs[index] = {
        ...plannedConfigs[index],
        plannedTask: slicePlan.recommendedTasks[taskIndex] || null,
        slicePlanBreadth: slicePlan.breadth
      };
    });
  }

  return plannedConfigs;
}

const generationConfigFields = [
  'questionType', 'difficulty', 'learningObjective', 'learningObjectiveId', 'learningObjectiveIndex',
  'customPrompt', 'useCustomPromptOnly', 'selectionMode', 'branchingLayers', 'branchingChoices',
  'pedagogicalIntent', 'bloomLevel', 'focusArea', 'planRationale'
];

export function normalizeGenerationConfigs(configs) {
  if (!Array.isArray(configs) || configs.length < 1 || configs.length > 100) {
    throw Object.assign(new Error('Choose between 1 and 100 questions.'), { status: 400, code: 'INVALID_GENERATION_REQUEST' });
  }
  return configs.map(config => {
    if (!config || typeof config !== 'object' || !Object.values(QUESTION_TYPES).includes(config.questionType)) {
      throw Object.assign(new Error('A supported question type is required for every row.'), { status: 400, code: 'INVALID_GENERATION_REQUEST' });
    }
    const normalized = Object.fromEntries(generationConfigFields.filter(key => config[key] !== undefined).map(key => [key, config[key]]));
    for (const [key, value] of Object.entries(normalized)) {
      if (['learningObjective', 'learningObjectiveId'].includes(key) && value === null) { delete normalized[key]; continue; }
      if (['learningObjectiveIndex', 'branchingLayers', 'branchingChoices'].includes(key)) {
        if (!Number.isInteger(value) || value < 0 || value > 100) throw Object.assign(new Error('Invalid numeric question setting.'), { status: 400, code: 'INVALID_GENERATION_REQUEST' });
      } else if (key === 'useCustomPromptOnly') {
        if (typeof value !== 'boolean') throw Object.assign(new Error('Invalid custom prompt setting.'), { status: 400, code: 'INVALID_GENERATION_REQUEST' });
      } else {
        if (typeof value !== 'string' || value.length > 30000) throw Object.assign(new Error('Question instructions must be text within the supported length.'), { status: 400, code: 'INVALID_GENERATION_REQUEST' });
        normalized[key] = value.trim();
      }
    }
    return normalized;
  });
}

// Shared by the existing Generate Questions endpoint and the Studio assistant.
// QuestionGenerationJob owns staged persistence and atomic publication.
export function createQuestionBatchWork({ quiz, questionConfigs, readiness, userId, mode = 'append',
  assertActive: assertContextActive = async () => {} }) {
  const quizId = String(quiz._id);
  return async function generateBatch({ job: receipt, assertActive: assertJobActive, updateItem, signal: jobSignal }) {
    const assertActive = async () => { await assertContextActive(); await assertJobActive(); };
    const finalSessionId = receipt.sessionId;
    const Question = (await import('../models/Question.js')).default;
    const existingQuestions = await Question.find({ quiz: quizId, _id: { $in: receipt.baseQuestionIds } })
      .select('questionText type explanation learningObjective generationMetadata.focusArea generationMetadata.plannedSlice generationMetadata.subObjective generationMetadata.sourceReferences')
      .sort({ order: 1 }).lean();
    const questionHistory = buildQuestionMemory(existingQuestions);
    const [coursePrompt, historyPrompt, validationPrompt] = await Promise.all([
      coursePromptService.buildCoursePromptInstructions({ folderId: quiz.folder, userId, promptType: 'question-generation', approach: quiz.settings?.pedagogicalApproach || 'support' }),
      coursePromptService.buildCoursePromptInstructions({ folderId: quiz.folder, userId, promptType: 'history-summary' }),
      coursePromptService.buildCoursePromptInstructions({ folderId: quiz.folder, userId, promptType: 'question-validation' })
    ]);
    const configs = attachPlannedTasksToQuestionConfigs(enrichQuestionConfigsWithObjectives(questionConfigs.map(config => ({
      ...config, useCustomPromptOnly: isCustomPromptOnly(config), instructorPrompt: config.customPrompt?.trim() || '',
      previousQuestions: mode === 'replace' ? [] : questionHistory.previousQuestions,
      duplicateCheckQuestions: mode === 'replace' ? [] : questionHistory.comparisonQuestions,
      customPrompt: coursePromptService.mergePromptParts(coursePrompt.prompt, historyPrompt.prompt, questionHistory.prompt, validationPrompt.prompt, config.customPrompt)
    })), quiz));
    const { default: questionStreamingService } = await import('../services/questionStreamingService.js');
    const { default: ragService } = await import('../services/ragService.js');
    sseService.notifyBatchStarted(finalSessionId, { quizId, totalQuestions: configs.length, questionTypes: configs.map(config => config.questionType), userId });
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < configs.length) {
        const index = nextIndex++;
        const config = configs[index];
        const questionId = receipt.items[index].questionId;
        await assertActive();
        await updateItem(index, { status: 'generating' });
        try {
          await runWithGenerationDeadline(async ({ signal: deadlineSignal, beginPersistence }) => {
            const signal = AbortSignal.any([deadlineSignal, jobSignal]);
            let relevantContent = [];
            if (!config.useCustomPromptOnly) {
              if (!ragService.isInitialized) throw new Error('Material retrieval is unavailable.');
              const retrievalQuery = [config.learningObjective?.text || config.learningObjective,
                ...(config.questionType === 'branching-scenario'
                  ? (config.supportingLearningObjectiveIds || [])
                    .map(id => quiz.learningObjectives?.find(lo => String(lo._id) === String(id))?.text)
                  : []),
                config.focusArea ? `Focus area: ${config.focusArea}` : '',
                config.bloomLevel ? `Bloom level: ${config.bloomLevel}` : '',
                config.plannedTask?.sliceLabel ? `Planned slice: ${config.plannedTask.sliceLabel}` : '',
                ...(config.learningObjective?.generationMetadata?.subpoints || [])].filter(Boolean).join('\n');
              // A complete scenario needs the source's later choices and outcomes,
              // which a five-chunk lookup can omit even when the first decision matches.
              const retrieved = await ragService.retrieveRelevantContent(retrievalQuery, config.questionType, {
                topK: config.questionType === 'branching-scenario' ? 20 : 5,
                materialIds: readiness.processedMaterialIds,
                minScore: 0.3
              });
              relevantContent = retrieved?.chunks || [];
              if (!relevantContent.length) throw new Error('No supporting material could be retrieved.');
              if (config.questionType === 'branching-scenario') {
                // Semantic search can find the first decision while omitting later
                // numbered choices. Include the selected source text before the
                // ranked excerpts so a complete scenario can preserve them.
                const materials = await Material.find({
                  _id: { $in: readiness.processedMaterialIds },
                  processingStatus: 'completed'
                }).select('name content').lean();
                const sourceChunks = materials
                  .filter(material => typeof material.content === 'string' && material.content.trim())
                  .map(material => ({ content: material.content.slice(0, 26000), metadata: {
                    materialId: String(material._id), materialName: material.name,
                    source: material.name, sourceFile: material.name
                  } }));
                relevantContent = [...sourceChunks, ...relevantContent];
              }
            }
            assertGenerationActive(signal);
            await assertActive();
            await questionStreamingService.generateQuestionWithStreaming({
              quizId, questionId, questionConfig: config, learningObjective: config.learningObjective,
              relevantContent, sessionId: finalSessionId, userId, signal, beginPersistence,
              generationContext: { jobId: receipt._id, savedQuestionId: receipt.items[index].savedQuestionId,
                order: (mode === 'append' ? receipt.baseQuestionIds.length : 0) + index, assertActive }
            });
          }, 120000);
          await updateItem(index, { status: 'ready' });
        } catch (error) {
          const failure = safeQuestionJobFailure(error);
          await updateItem(index, { status: 'failed', ...failure });
          sseService.emitError(finalSessionId, questionId, failure.message, failure.code);
          sseService.notifyQuestionComplete(finalSessionId, questionId, { error: true, errorMessage: failure.message, code: failure.code, questionId });
        }
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(3, configs.length) }, worker)); }
    finally { questionMemoryService.clearSession(finalSessionId); }
  };
}
