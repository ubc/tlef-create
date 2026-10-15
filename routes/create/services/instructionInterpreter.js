import { QUESTION_TYPES } from '../config/constants.js';
import { extractBalancedJson } from '../utils/openAIRequestUtils.js';
import {
  detectDifficulty,
  detectExcludedQuestionTypes,
  detectLearningObjectiveEmphasis,
  detectRequestedQuestionTypes,
  detectRequiredQuestionType,
  normalizeLearningObjectiveFocus
} from './instructorDirectives.js';

// Turns the instructor's free-text "Additional Instructions" into directives
// the Blueprint enforces in code. The model reads the wording (so phrasing we
// never anticipated still works); keyword detection fills any gaps and is the
// fallback when the model call fails.

const VALID_TYPES = Object.values(QUESTION_TYPES);
const VALID_DIFFICULTIES = ['easy', 'moderate', 'hard'];

const EMPTY_DIRECTIVES = Object.freeze({
  loFocus: { only: [], emphasize: [], deemphasize: [] },
  types: { only: null, include: [], exclude: [] },
  difficulty: null,
  otherGuidance: ''
});

export function buildInterpretationPrompt(instructions, learningObjectives) {
  const objectives = learningObjectives
    .map((lo, index) => `LO ${index + 1}: ${lo.text}`)
    .join('\n');
  return `An instructor wrote instructions for an AI quiz generator. Convert them into structured settings.

Learning objectives (numbered as the instructor sees them):
${objectives}

Valid question types: ${VALID_TYPES.join(', ')}

Instructor instructions:
"""
${instructions}
"""

Return ONLY this JSON object:
{
  "onlyLearningObjectives": [],
  "emphasizeLearningObjectives": [],
  "deemphasizeLearningObjectives": [],
  "onlyQuestionType": null,
  "includeQuestionTypes": [],
  "excludeQuestionTypes": [],
  "difficulty": null,
  "otherGuidance": ""
}

Rules:
- Learning objective fields hold LO numbers (1 = LO 1).
- "onlyLearningObjectives": the instructor wants every question to cover only these LOs ("all on LO3", "only LO 2").
- "emphasizeLearningObjectives": more questions on these LOs, while still covering the others ("focus more on LO3").
- "deemphasizeLearningObjectives": fewer questions on these LOs.
- "onlyQuestionType": one valid type when every question must be that type, otherwise null.
- "includeQuestionTypes" / "excludeQuestionTypes": valid types the instructor asked to use or avoid.
- "difficulty": "easy", "moderate" or "hard" when every question should have that difficulty, otherwise null.
- "otherGuidance": everything else the instructor asked for (topics, examples, tone, wording), restated briefly. Empty string if nothing else.
- Leave a field empty or null when the instructions do not mention it. Do not guess.`;
}

function toLOIndexes(values, count) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(value => Number.parseInt(String(value).replace(/\D/g, ''), 10) - 1)
    .filter(index => Number.isInteger(index) && index >= 0 && index < count))];
}

function toTypes(values) {
  return Array.isArray(values) ? [...new Set(values.filter(type => VALID_TYPES.includes(type)))] : [];
}

/** Validate a model response against the quiz; anything malformed is dropped. */
export function parseInterpretation(responseText, learningObjectiveCount) {
  const objectStart = typeof responseText === 'string' ? responseText.indexOf('{') : -1;
  if (objectStart < 0) throw new Error('No JSON object in instruction interpretation');
  const parsed = JSON.parse(extractBalancedJson(responseText.slice(objectStart)));
  const exclude = toTypes(parsed.excludeQuestionTypes);
  const onlyType = VALID_TYPES.includes(parsed.onlyQuestionType) && !exclude.includes(parsed.onlyQuestionType)
    ? parsed.onlyQuestionType
    : null;
  return {
    loFocus: normalizeLearningObjectiveFocus({
      only: toLOIndexes(parsed.onlyLearningObjectives, learningObjectiveCount),
      emphasize: toLOIndexes(parsed.emphasizeLearningObjectives, learningObjectiveCount),
      deemphasize: toLOIndexes(parsed.deemphasizeLearningObjectives, learningObjectiveCount)
    }),
    types: {
      only: onlyType,
      include: onlyType ? [] : toTypes(parsed.includeQuestionTypes).filter(type => !exclude.includes(type)),
      exclude
    },
    difficulty: VALID_DIFFICULTIES.includes(parsed.difficulty) ? parsed.difficulty : null,
    otherGuidance: typeof parsed.otherGuidance === 'string' ? parsed.otherGuidance.trim().slice(0, 1000) : ''
  };
}

export function detectDirectivesFromKeywords(instructions, learningObjectiveCount) {
  const only = detectRequiredQuestionType(instructions);
  const exclude = detectExcludedQuestionTypes(instructions);
  return {
    loFocus: detectLearningObjectiveEmphasis(instructions, learningObjectiveCount),
    types: {
      only,
      include: only ? [] : detectRequestedQuestionTypes(instructions).filter(type => !exclude.includes(type)),
      exclude
    },
    difficulty: detectDifficulty(instructions),
    otherGuidance: ''
  };
}

const hasLOFocus = focus => focus.only.length || focus.emphasize.length || focus.deemphasize.length;

/** Model directives win field by field; keywords fill whatever the model left empty. */
export function mergeDirectives(model, keywords) {
  const typesFromModel = model.types.only || model.types.include.length || model.types.exclude.length;
  return {
    loFocus: hasLOFocus(model.loFocus) ? model.loFocus : keywords.loFocus,
    types: typesFromModel ? model.types : keywords.types,
    difficulty: model.difficulty || keywords.difficulty,
    otherGuidance: model.otherGuidance
  };
}

/**
 * @param {Object} options
 * @param {string} options.instructions
 * @param {Array} options.learningObjectives
 * @param {(prompt: string) => Promise<string>} options.complete - model call returning text
 * @returns {Promise<{directives: Object, interpretedBy: 'model' | 'keywords' | 'none'}>}
 */
export async function interpretInstructions({ instructions, learningObjectives, complete }) {
  if (!instructions) return { directives: EMPTY_DIRECTIVES, interpretedBy: 'none' };
  const count = learningObjectives.length;
  const keywords = detectDirectivesFromKeywords(instructions, count);
  try {
    const responseText = await complete(buildInterpretationPrompt(instructions, learningObjectives));
    return {
      directives: mergeDirectives(parseInterpretation(responseText, count), keywords),
      interpretedBy: 'model'
    };
  } catch (error) {
    console.warn('⚠️ Instruction interpretation fell back to keyword detection:', error.message);
    return { directives: keywords, interpretedBy: 'keywords' };
  }
}

export default { interpretInstructions };
