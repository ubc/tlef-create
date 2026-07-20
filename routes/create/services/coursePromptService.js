import CoursePromptOverride from '../models/CoursePromptOverride.js';
import SystemPromptTemplate from '../models/SystemPromptTemplate.js';
import UserPromptOverride from '../models/UserPromptOverride.js';
import { GENERAL_SYSTEM_PROMPTS } from './coursePromptDefaults.js';

const APPROACHES = ['support', 'assess', 'gamify'];
const APPROACH_DEPENDENT_PROMPT_TYPES = new Set([
  'quiz-blueprint',
  'question-generation'
]);

function normalizeApproach(approach, promptType, fallback = 'general') {
  if (!APPROACH_DEPENDENT_PROMPT_TYPES.has(promptType)) {
    return 'general';
  }

  return APPROACHES.includes(approach) ? approach : fallback;
}

function mergePromptParts(...parts) {
  return parts
    .map(part => part?.trim())
    .filter(Boolean)
    .join('\n\n');
}

function stripLockedTaskPrompt(basePrompt = '', promptType) {
  const taskPrompt = GENERAL_SYSTEM_PROMPTS[promptType] || '';
  return taskPrompt
    ? String(basePrompt).replace(taskPrompt, '').trim()
    : String(basePrompt).trim();
}

function mergeTaskPrompt(basePrompt, promptType) {
  const taskPrompt = GENERAL_SYSTEM_PROMPTS[promptType] || '';
  const editablePrompt = stripLockedTaskPrompt(basePrompt, promptType);
  return mergePromptParts(taskPrompt, editablePrompt);
}

async function resolveCoursePrompt({
  folderId,
  userId,
  promptType,
  approach = 'general'
}) {
  const normalizedApproach = normalizeApproach(approach, promptType);

  const courseOverride = await CoursePromptOverride.findOne({
    folder: folderId,
    user: userId,
    promptType,
    approach: normalizedApproach,
    isActive: true
  }).sort({ version: -1 }).lean();

  if (courseOverride?.customInnerPrompt) {
    return {
      source: 'course',
      innerPrompt: mergeTaskPrompt(courseOverride.customInnerPrompt, promptType),
      override: courseOverride
    };
  }

  if (APPROACH_DEPENDENT_PROMPT_TYPES.has(promptType) && APPROACHES.includes(normalizedApproach)) {
    const userOverride = await UserPromptOverride.findOne({
      user: userId,
      approach: normalizedApproach,
      isActive: true
    }).lean();

    if (userOverride?.customInnerPrompt) {
      return {
        source: 'user',
        innerPrompt: mergeTaskPrompt(userOverride.customInnerPrompt, promptType),
        override: userOverride
      };
    }

    const systemTemplate = await SystemPromptTemplate.findOne({
      approach: normalizedApproach,
      isActive: true
    }).lean();

    if (systemTemplate?.innerPrompt) {
      return {
        source: 'system',
        innerPrompt: mergeTaskPrompt(systemTemplate.innerPrompt, promptType),
        override: null
      };
    }
  }

  if (GENERAL_SYSTEM_PROMPTS[promptType]) {
    return {
      source: 'system',
      innerPrompt: GENERAL_SYSTEM_PROMPTS[promptType],
      override: null
    };
  }

  return {
    source: 'none',
    innerPrompt: '',
    override: null
  };
}

async function buildCoursePromptInstructions({
  folderId,
  userId,
  promptType,
  approach = 'general',
  userInstructions = ''
}) {
  const resolved = await resolveCoursePrompt({
    folderId,
    userId,
    promptType,
    approach
  });

  const labeledCoursePrompt = resolved.innerPrompt
    ? `COURSE-LEVEL PROMPT INSTRUCTIONS (${resolved.source}):\n${resolved.innerPrompt}`
    : '';

  const labeledUserInstructions = userInstructions?.trim()
    ? `REQUEST-SPECIFIC INSTRUCTOR INSTRUCTIONS:\n${userInstructions.trim()}`
    : '';

  const prompt = mergePromptParts(labeledCoursePrompt, labeledUserInstructions);
  const promptVersion = resolved.override?.version || null;
  console.log(`🧭 Prompt resolution | type=${promptType} | approach=${normalizeApproach(approach, promptType)} | source=${resolved.source} | version=${promptVersion || 'default'} | length=${prompt.length}`);

  return {
    source: resolved.source,
    prompt,
    version: promptVersion,
    override: resolved.override
  };
}

export default {
  resolveCoursePrompt,
  buildCoursePromptInstructions,
  mergePromptParts,
  stripLockedTaskPrompt
};
