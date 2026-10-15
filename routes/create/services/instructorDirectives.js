import { QUESTION_TYPES } from '../config/constants.js';

// Deterministic reading of the instructor's free-text "Additional Instructions".
// Smaller models follow the approach templates over these instructions, so the
// parts we can recognise reliably are enforced in code as well as in the prompt.

// Phrases instructors use for each question type. Longer phrases are matched
// first so "single choice set" is not also counted as "single choice".
const TYPE_ALIASES = [
  [QUESTION_TYPES.SINGLE_CHOICE_SET, ['single-choice set', 'single choice set', 'single-choice-set']],
  [QUESTION_TYPES.MULTIPLE_CHOICE, ['multiple-choice', 'multiple choice', 'multi-choice', 'multi choice', 'mcqs', 'mcq']],
  [QUESTION_TYPES.TRUE_FALSE, ['true/false', 'true-false', 'true or false', 'true false', 't/f']],
  [QUESTION_TYPES.FLASHCARD, ['flashcards', 'flashcard', 'flash cards', 'flash card']],
  [QUESTION_TYPES.SUMMARY, ['summaries', 'summary']],
  [QUESTION_TYPES.DISCUSSION, ['discussion']],
  [QUESTION_TYPES.MATCHING, ['matching']],
  [QUESTION_TYPES.ORDERING, ['ordering']],
  [QUESTION_TYPES.CLOZE, ['fill-in-the-blanks', 'fill in the blanks', 'fill-in-the-blank', 'fill in the blank', 'cloze']],
  [QUESTION_TYPES.MARK_THE_WORDS, ['mark-the-words', 'mark the words']],
  [QUESTION_TYPES.ESSAY, ['essays', 'essay']],
  [QUESTION_TYPES.SORT_PARAGRAPHS, ['sort-paragraphs', 'sort paragraphs']],
  [QUESTION_TYPES.CROSSWORD, ['crosswords', 'crossword']]
];

const EXCLUSIVE_WORDS = /\b(all|only|every|each|exclusively|entirely|solely|just)\b/;
const NEGATION_BEFORE = /\b(no|not|don'?t|do not|without|avoid|never|except|excluding|besides|other than|skip)\b[^.;,!?\n]{0,25}$/;

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function scanQuestionTypes(instructions) {
  if (typeof instructions !== 'string' || !instructions.trim()) return [];
  let text = instructions.toLowerCase();
  const mentions = [];

  for (const [type, aliases] of TYPE_ALIASES) {
    for (const alias of aliases) {
      const pattern = new RegExp(`(^|[^a-z])${escapeRegex(alias)}(?=$|[^a-z])`, 'g');
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const before = text.slice(0, match.index + match[1].length);
        mentions.push({ type, negated: NEGATION_BEFORE.test(before) });
      }
      // Blank out matched phrases so shorter aliases cannot re-match them.
      text = text.replace(pattern, (_, lead) => `${lead}${' '.repeat(alias.length)}`);
    }
  }

  return mentions;
}

/**
 * Detect an instruction that asks for every question to be one type, e.g.
 * "make them all multiple choice please". Returns the canonical type, or null
 * when the instruction is ambiguous or names several types to use.
 */
export function detectRequiredQuestionType(instructions) {
  if (typeof instructions !== 'string' || !EXCLUSIVE_WORDS.test(instructions.toLowerCase())) return null;
  const wanted = new Set(scanQuestionTypes(instructions).filter(m => !m.negated).map(m => m.type));
  return wanted.size === 1 ? [...wanted][0] : null;
}

/**
 * Question types the instructor asked for without excluding everything else,
 * e.g. "include more matching questions".
 */
export function detectRequestedQuestionTypes(instructions) {
  return [...new Set(scanQuestionTypes(instructions).filter(m => !m.negated).map(m => m.type))];
}

/**
 * Question types the instructor asked to avoid, e.g. "avoid true/false".
 */
export function detectExcludedQuestionTypes(instructions) {
  return [...new Set(scanQuestionTypes(instructions).filter(m => m.negated).map(m => m.type))];
}

const LO_REFERENCE = /\b(?:los?|learning objectives?|objectives?)\s*#?\s*(\d+(?:\s*(?:,|&|\/|and|or)\s*#?\s*\d+)*)/g;
const EMPHASIS_WORDS = /\b(focus(?:es|ed|ing)?|concentrat(?:e|es|ed|ing)|emphasi[sz](?:e|es|ed|ing)|emphasis|more|prioriti[sz](?:e|ed)|priority|extra|heavier|heavily|mostly|majority|additional)\b/;
const DEEMPHASIS_WORDS = /\b(less|fewer|minimi[sz]e|de-?emphasi[sz]e|lighter|lightly|reduce)\b/;
// Commas followed by a number stay inside "LO 3, 4" lists.
const SEGMENT_BREAK = /[.;!?\n]|,(?!\s*#?\s*\d)|\bbut\b/;

/**
 * Learning objectives the instructor asked to cover exclusively ("make them
 * all about LO3"), emphasise ("focus more on LO3") or de-emphasise ("less on
 * LO 1"). Numbers are 1-based as shown in the UI; the result uses 0-based
 * learning objective indexes.
 */
export function detectLearningObjectiveEmphasis(instructions, learningObjectiveCount) {
  const emphasis = { only: [], emphasize: [], deemphasize: [] };
  if (typeof instructions !== 'string' || !instructions.trim()) return emphasis;

  for (const segment of instructions.toLowerCase().split(SEGMENT_BREAK)) {
    const indexes = [];
    for (const match of segment.matchAll(LO_REFERENCE)) {
      for (const number of match[1].match(/\d+/g)) {
        const index = Number(number) - 1;
        if (index >= 0 && index < learningObjectiveCount) indexes.push(index);
      }
    }
    if (!indexes.length) continue;

    const bucket = DEEMPHASIS_WORDS.test(segment)
      ? emphasis.deemphasize
      : EXCLUSIVE_WORDS.test(segment)
        ? emphasis.only
        : EMPHASIS_WORDS.test(segment) ? emphasis.emphasize : null;
    if (bucket) bucket.push(...indexes);
  }

  return normalizeLearningObjectiveFocus(emphasis);
}

/** Dedupe and resolve conflicts: "only" wins, then de-emphasis over emphasis. */
export function normalizeLearningObjectiveFocus({ only = [], emphasize = [], deemphasize = [] }) {
  const onlySet = new Set(only);
  if (onlySet.size) return { only: [...onlySet], emphasize: [], deemphasize: [] };
  const deemphasized = new Set(deemphasize);
  return {
    only: [],
    emphasize: [...new Set(emphasize)].filter(index => !deemphasized.has(index)),
    deemphasize: [...deemphasized]
  };
}

const DIFFICULTY_WORDS = [
  ['easy', /\b(easy|easier|simple|simpler|basic|introductory)\b/],
  ['moderate', /\b(moderate|medium|intermediate)\b/],
  ['hard', /\b(hard|harder|difficult|challenging|advanced|tough)\b/]
];
const DIFFICULTY_DIRECTIVE = /\b(all|only|every|each|make|keep|set)\b/;
const DIFFICULTY_NEGATION = /\b(not|no|don'?t|never|too)\s+(?:\w+\s+){0,2}$/;

/**
 * A single difficulty the instructor asked for, e.g. "make them all hard".
 */
export function detectDifficulty(instructions) {
  if (typeof instructions !== 'string' || !instructions.trim()) return null;
  const found = new Set();
  for (const segment of instructions.toLowerCase().split(SEGMENT_BREAK)) {
    if (!DIFFICULTY_DIRECTIVE.test(segment)) continue;
    for (const [difficulty, pattern] of DIFFICULTY_WORDS) {
      const match = segment.match(pattern);
      if (match && !DIFFICULTY_NEGATION.test(segment.slice(0, match.index))) found.add(difficulty);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

const REQUESTED_TYPE_SHARE = 0.5;

/**
 * Make sure types the instructor asked for ("include more matching") are a
 * visible part of the plan: convert rows, last first, until the requested
 * types cover at least half of the questions.
 */
export function ensureRequestedTypes(planItems, requestedTypes) {
  if (!requestedTypes.length) return planItems;
  const items = planItems.map(item => ({ ...item }));
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const target = Math.ceil(total * REQUESTED_TYPE_SHARE);
  const requestedCount = () => items
    .filter(item => requestedTypes.includes(item.type))
    .reduce((sum, item) => sum + item.count, 0);

  // Give each requested type at least one row before topping up the share.
  let next = 0;
  for (let index = items.length - 1; index >= 0; index--) {
    const missing = requestedTypes.filter(type => !items.some(item => item.type === type));
    if (!missing.length && requestedCount() >= target) break;
    if (requestedTypes.includes(items[index].type)) continue;
    items[index].type = missing[0] || requestedTypes[next++ % requestedTypes.length];
  }
  return items;
}

const typeLabel = type => (type === QUESTION_TYPES.TRUE_FALSE ? 'true/false' : type.replace(/-/g, ' '));
const countQuestions = (items, predicate) => items
  .filter(predicate)
  .reduce((sum, item) => sum + item.count, 0);

/**
 * Instructor-facing checklist of how the plan applied each instruction CREATE
 * recognised, so the effect of the instructions is visible in the Blueprint.
 */
export function summarizeInstructionOutcome({
  instructions,
  planItems,
  requiredType,
  requestedTypes,
  excludedTypes,
  emphasis,
  difficulty = null,
  otherGuidance = ''
}) {
  if (!instructions) return null;
  const total = countQuestions(planItems, () => true);
  const applied = [];

  if (requiredType) {
    applied.push(`All ${total} questions use ${typeLabel(requiredType)}.`);
  } else if (requestedTypes.length) {
    const parts = requestedTypes.map(type => `${countQuestions(planItems, item => item.type === type)} ${typeLabel(type)}`);
    applied.push(`Included requested question types: ${parts.join(', ')} (of ${total}).`);
  }
  if (excludedTypes.length) {
    applied.push(`No ${excludedTypes.map(typeLabel).join(' or ')} questions.`);
  }
  if (emphasis.only.length) {
    applied.push(`Every question covers ${emphasis.only.map(index => `LO ${index + 1}`).join(' or ')}.`);
  }
  for (const index of emphasis.emphasize) {
    applied.push(`LO ${index + 1} emphasized: ${countQuestions(planItems, item => item.learningObjectiveIndex === index)} of ${total} questions.`);
  }
  for (const index of emphasis.deemphasize) {
    applied.push(`LO ${index + 1} de-emphasized: ${countQuestions(planItems, item => item.learningObjectiveIndex === index)} of ${total} questions.`);
  }

  if (difficulty) {
    applied.push(`All ${total} questions are ${difficulty}.`);
  }

  return {
    instructions,
    applied,
    otherGuidance: otherGuidance || '',
    passedToQuestions: true
  };
}

export default {
  detectRequiredQuestionType,
  detectRequestedQuestionTypes,
  detectExcludedQuestionTypes,
  detectLearningObjectiveEmphasis,
  detectDifficulty,
  normalizeLearningObjectiveFocus,
  ensureRequestedTypes,
  summarizeInstructionOutcome
};
