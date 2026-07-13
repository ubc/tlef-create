const COMPARISON_INTENTS = ['compare', 'distinguish', 'contrast'];

function normalizeWhitespace(text = '') {
  return text.replace(/\s+/g, ' ').trim();
}

function toId(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function splitEnumeratedItems(text = '') {
  const normalized = normalizeWhitespace(text)
    .replace(/\s+(and|or)\s+/gi, ', ')
    .replace(/,\s*,/g, ', ');

  return normalized
    .split(',')
    .map(item => normalizeWhitespace(item))
    .filter(Boolean);
}

function extractTailAfterKeyword(learningObjective) {
  const normalized = normalizeWhitespace(learningObjective);
  const patterns = [
    /\b(?:sources?|structure and function|functions? and structure|types?|forms?|roles?|components?|causes?|effects?|steps?|stages?|features?|characteristics?)\s+of\s+(.+?)(?:[.;]|$)/i,
    /\b(?:between|among|including)\s+(.+?)(?:[.;]|$)/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return '';
}

function detectBreadth(learningObjective, items) {
  const normalized = normalizeWhitespace(learningObjective).toLowerCase();
  const hasEnumeration = items.length >= 2;
  const hasListPunctuation = /,/.test(normalized) && /\band\b|\bor\b/.test(normalized);
  const hasComparisonVerb = COMPARISON_INTENTS.some(intent => normalized.includes(intent));

  if (hasEnumeration || hasListPunctuation || hasComparisonVerb) {
    return 'broad';
  }

  return 'narrow';
}

function buildComponentSlices(learningObjective, items) {
  const normalized = normalizeWhitespace(learningObjective);
  const lower = normalized.toLowerCase();
  const sourceContext = lower.includes('source') ? 'anthropogenic sources' : '';
  const structureFunctionContext = lower.includes('structure and function')
    ? 'structure and function'
    : '';

  return items.map(item => {
    let label = item;

    if (sourceContext) {
      label = `${item} ${sourceContext}`;
    } else if (structureFunctionContext) {
      label = `${item} ${structureFunctionContext}`;
    }

    return {
      id: toId(label),
      label,
      kind: 'component'
    };
  });
}

function buildComparisonSlices(componentSlices) {
  const comparisons = [];

  for (let i = 0; i < componentSlices.length; i++) {
    for (let j = i + 1; j < componentSlices.length; j++) {
      comparisons.push({
        id: toId(`${componentSlices[i].id}_${componentSlices[j].id}_comparison`),
        label: `Compare ${componentSlices[i].label} and ${componentSlices[j].label}`,
        kind: 'comparison'
      });
    }
  }

  return comparisons;
}

function buildMisconceptionSlices(componentSlices, learningObjective) {
  const lower = normalizeWhitespace(learningObjective).toLowerCase();
  const slices = [];

  if (lower.includes('source')) {
    slices.push({
      id: 'anthropogenic_vs_natural_sources',
      label: 'Distinguish anthropogenic sources from natural sources',
      kind: 'misconception'
    });
  }

  if (componentSlices.length >= 2) {
    slices.push({
      id: 'cross_component_source_confusion',
      label: `Distinguish the source patterns of ${componentSlices.map(slice => slice.label.split(' anthropogenic sources')[0]).join(', ')}`,
      kind: 'misconception'
    });
  }

  return slices;
}

function buildCandidateSlices(learningObjective) {
  const tail = extractTailAfterKeyword(learningObjective);
  const items = splitEnumeratedItems(tail);
  const breadth = detectBreadth(learningObjective, items);

  if (breadth === 'narrow' || items.length < 2) {
    return {
      breadth: 'narrow',
      candidateSlices: [{
        id: toId(learningObjective),
        label: normalizeWhitespace(learningObjective),
        kind: 'whole-lo'
      }]
    };
  }

  const componentSlices = buildComponentSlices(learningObjective, items);
  const comparisonSlices = buildComparisonSlices(componentSlices);
  const misconceptionSlices = buildMisconceptionSlices(componentSlices, learningObjective);

  return {
    breadth,
    candidateSlices: [
      ...componentSlices,
      ...comparisonSlices,
      ...misconceptionSlices
    ]
  };
}

function buildTaskIntent(slice, questionType) {
  if (slice.kind === 'comparison') {
    return questionType === 'multiple-choice' ? 'compare-and-contrast' : 'comparison';
  }

  if (slice.kind === 'misconception') {
    return questionType === 'multiple-choice' ? 'misconception-discrimination' : 'misconception-check';
  }

  return questionType === 'multiple-choice' ? 'source-identification' : 'concept-focus';
}

function selectTaskSequence(candidateSlices, requestedCount) {
  const ordered = [
    ...candidateSlices.filter(slice => slice.kind === 'component'),
    ...candidateSlices.filter(slice => slice.kind === 'comparison'),
    ...candidateSlices.filter(slice => slice.kind === 'misconception'),
    ...candidateSlices.filter(slice => slice.kind === 'whole-lo')
  ];

  const tasks = [];

  for (let index = 0; index < requestedCount; index++) {
    const slice = ordered[index % ordered.length];
    tasks.push(slice);
  }

  return tasks;
}

export function planLOSlices({ learningObjective, questionType, requestedCount }) {
  const normalizedLO = normalizeWhitespace(learningObjective);
  const { breadth, candidateSlices } = buildCandidateSlices(normalizedLO);
  const selectedSlices = selectTaskSequence(candidateSlices, requestedCount);

  return {
    originalLO: normalizedLO,
    breadth,
    candidateSlices,
    recommendedTasks: selectedSlices.map((slice, index) => ({
      index,
      sliceId: slice.id,
      sliceLabel: slice.label,
      sliceKind: slice.kind,
      questionIntent: buildTaskIntent(slice, questionType)
    }))
  };
}

export default {
  planLOSlices
};
