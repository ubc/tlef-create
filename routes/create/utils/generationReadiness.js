import { getQuestionTypeAvailability } from './questionTypeAvailability.js';

// Run against the instructor's original config, before adding course/system prompts.
export function isCustomPromptOnly(config = {}) {
  const prompt = typeof config.customPrompt === 'string' ? config.customPrompt.trim() : '';
  const hasObjective = Boolean(config.learningObjective || config.learningObjectiveId)
    || Number.isInteger(config.learningObjectiveIndex);
  return Boolean(prompt) && (config.useCustomPromptOnly === true || !hasObjective);
}

export function isMaterialReady(material) {
  if (material?.processingStatus !== 'completed') return false;
  const metadata = material.processingMetadata || {};
  return !(metadata.failedChunkIndices?.length)
    && !(Number.isFinite(metadata.embeddedChunkCount)
      && Number.isFinite(metadata.chunkCount)
      && metadata.embeddedChunkCount < metadata.chunkCount);
}

export function getGenerationReadiness(quiz, questionConfigs) {
  if (!Array.isArray(questionConfigs) || questionConfigs.length === 0) {
    return { ready: false, status: 400, code: 'INVALID_GENERATION_CONFIG', message: 'Add at least one question to the blueprint.' };
  }
  if (questionConfigs.some(config => !config || (config.useCustomPromptOnly === true && !isCustomPromptOnly(config)))) {
    return { ready: false, status: 400, code: 'INVALID_GENERATION_CONFIG', message: 'Custom-prompt-only questions require non-empty teaching instructions.' };
  }
  for (const config of questionConfigs) {
    const availability = getQuestionTypeAvailability(config.questionType || config.type);
    if (!availability.available) return { ready: false, ...availability };
  }
  const processedMaterialIds = (quiz.materials || []).filter(isMaterialReady).map(material => material._id.toString());
  if (questionConfigs.some(config => !isCustomPromptOnly(config)) && processedMaterialIds.length === 0) {
    return {
      ready: false,
      status: 409,
      code: 'MATERIALS_NOT_READY',
      message: 'Add at least one fully processed material before generating questions from learning objectives. Retry failed materials or wait for processing to finish. To work without materials, use a custom-prompt-only blueprint row with teaching instructions.'
    };
  }
  return { ready: true, processedMaterialIds };
}
