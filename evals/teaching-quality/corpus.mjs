// Synthetic, public test data. Never replace these fixtures with course uploads.
export const corpusVersion = '1.0.1';

const rubric = [
  { id: 'alignment', question: 'Does the activity assess the stated objective and current instructor request?', anchors: ['0: different task', '1: partial match', '2: full match'] },
  { id: 'clarity', question: 'Can a first-year learner understand what to do without guessing?', anchors: ['0: ambiguous', '1: needs editing', '2: clear'] },
  { id: 'reasoning', question: 'Do explanations and distractors expose useful reasoning rather than repeat the answer?', anchors: ['0: misleading', '1: shallow', '2: useful'] },
  { id: 'grounding', question: 'Are all substantive claims supported by supplied facts or explicitly stated hypothetical premises?', anchors: ['0: invented/contradictory', '1: uncertain support', '2: fully supported'] }
];

function option(text, isCorrect, rationale) {
  return { text, isCorrect, tip: 'Use the supplied facts.',
    chosenFeedback: `${isCorrect ? 'Correct.' : 'This option is incorrect.'} ${rationale}`,
    notChosenFeedback: `${isCorrect ? 'This correct option was not selected.' : 'Correctly left unselected.'} ${rationale}` };
}
function question(stem, options, explanation, selectionMode = 'single') {
  const correct = options.filter(item => item.isCorrect).map(item => item.text);
  return { questionText: stem, content: { selectionMode, options },
    correctAnswer: selectionMode === 'multiple' ? correct : correct[0], explanation };
}
const native = (library, title, params) => ({ library, params, metadata: { title } });
const source = (id, content) => ({ content: `[${id}] ${content}`, score: 1, metadata: { source: id, materialId: `synthetic-${id}`, chunkIndex: 0, pageNumber: 1 } });

function mcq({ id, title, facts, instructions, stem, answers, correct, explanation, mode = 'single', extra = {}, counterexamples = [] }) {
  const options = answers.map(answer => option(answer, correct.includes(answer), answer === correct[0] ? explanation : `Apply the supplied rule; the supported answer${correct.length > 1 ? 's are' : ' is'} ${correct.join(' and ')}.`));
  const gold = question(stem, options, explanation, mode);
  const wrongKey = structuredClone(gold);
  wrongKey.content.options.forEach((item, index) => { item.isCorrect = index === answers.findIndex(answer => !correct.includes(answer)); });
  wrongKey.correctAnswer = wrongKey.content.options.find(item => item.isCorrect).text;
  return {
    id, title, surface: 'question', synthetic: true,
    request: { questionType: 'multiple-choice', selectionMode: mode, learningObjective: 'Apply the supplied facts to explain a specific situation.',
      relevantContent: [source('S1', facts)], customPrompt: `${instructions} Use these exact answer option texts: ${JSON.stringify(answers)}. Include explanatory chosenFeedback and notChosenFeedback for every option.`,
      previousQuestions: [], ...extra },
    expected: { optionTexts: answers, correctOptions: correct, selectionMode: mode },
    gold, counterexamples: [{ id: 'wrong-answer-key', fails: ['facts.answer-key'], output: wrongKey }, ...counterexamples], teacherRubric: rubric
  };
}

const single = mcq({ id: 'mcq-single', title: 'Single-choice phase change',
  facts: 'Evaporation is liquid water becoming water vapour. Condensation is water vapour becoming liquid water.',
  instructions: 'Ask which process turns water vapour into liquid water. Exactly one answer must be correct.',
  stem: 'Which process turns water vapour into liquid water?', answers: ['Condensation', 'Evaporation', 'Melting', 'Freezing'], correct: ['Condensation'],
  explanation: '[S1] Condensation changes water vapour into liquid water.' });

const multiple = mcq({ id: 'mcq-multiple', title: 'Multiple-choice answer mode',
  facts: 'Evaporation is liquid to gas; melting is solid to liquid; freezing is liquid to solid; condensation is gas to liquid.',
  instructions: 'Ask learners to select all changes that end in a liquid. Exactly two answers are correct.',
  stem: 'Select all changes that end in a liquid.', answers: ['Melting', 'Condensation', 'Freezing', 'Evaporation'], correct: ['Melting', 'Condensation'], mode: 'multiple',
  explanation: '[S1] Melting and condensation both produce liquid water.' });

const arithmetic = mcq({ id: 'arithmetic-feedback', title: 'Known arithmetic and learner-action feedback',
  facts: 'A sealed inventory starts with 12 tokens. Add 5 tokens and remove 3 tokens. No other changes occur.',
  instructions: 'Ask how many tokens remain after starting with 12, adding 5 and removing 3. Show 12 + 5 - 3 = 14 in the explanation. Do not invent a calculation for a distractor.',
  stem: 'Starting with 12 tokens, adding 5 and removing 3 leaves how many?', answers: ['14', '20', '10', '17'], correct: ['14'],
  explanation: '[S1] 12 + 5 - 3 = 14 tokens.' });
arithmetic.expected.arithmetic = { operands: [12, 5, 3], result: 14, expressionPattern: '12\\s*\\+\\s*5\\s*[-−]\\s*3\\s*=\\s*14' };
const badFeedback = structuredClone(arithmetic.gold);
badFeedback.content.options[1].notChosenFeedback = 'Incorrect. You should select 20.';
arithmetic.counterexamples.push({ id: 'wrong-omission-feedback', fails: ['facts.feedback-polarity'], output: badFeedback });
const wrongCalculation = structuredClone(arithmetic.gold);
wrongCalculation.explanation = '12 + 5 - 3 = 20 tokens.';
arithmetic.counterexamples.push({ id: 'wrong-calculation', fails: ['facts.arithmetic'], output: wrongCalculation });
const wrongDistractorMath = structuredClone(arithmetic.gold);
wrongDistractorMath.content.options[1].chosenFeedback = 'This option is incorrect. However, 12 + 5 - 3 = 20.';
arithmetic.counterexamples.push({ id: 'invented-distractor-arithmetic', fails: ['facts.arithmetic-feedback'], output: wrongDistractorMath });
const falseImplicitDerivation = structuredClone(arithmetic.gold);
falseImplicitDerivation.content.options[1].chosenFeedback = 'This option is incorrect. This distractor would result if you used 12 + 8 before subtracting 3.';
arithmetic.counterexamples.push({ id: 'false-distractor-derivation', fails: ['facts.distractor-calculation'], output: falseImplicitDerivation });

const hypothetical = mcq({ id: 'hypothetical-premise', title: 'Explicit fictional rule outranks ordinary-world assumptions',
  facts: 'This is a fictional simulation. In this simulation gravity acts upward. When released from rest, a bead initially accelerates upward; ignore all other forces.',
  instructions: 'State explicitly that this is a fictional simulation where gravity acts upward, then ask the bead’s initial acceleration direction. Do not substitute Earth gravity.',
  stem: 'In this fictional simulation gravity acts upward. Which direction does a released bead initially accelerate?',
  answers: ['Upward', 'Downward', 'Leftward', 'No acceleration'], correct: ['Upward'],
  explanation: '[S1] The hypothetical rule defines upward gravity, so the bead accelerates upward.' });
hypothetical.expected.stemPatterns = ['fictional|simulation|hypothetical', 'upward'];

const glass = mcq({ id: 'cold-glass-request', title: 'Specific instructor scenario survives broad objective and history',
  facts: 'Water vapour in room air can condense into liquid droplets on the outside of a cold sealed glass. The droplets do not pass through the glass from the sealed interior.',
  instructions: 'Use a cold sealed glass with droplets on its outside. Ask where those droplets come from. Do not generate a runoff, vegetation, infiltration, or numerical problem.',
  stem: 'Where do droplets on the outside of a cold sealed glass come from?',
  answers: ['Water vapour in the room air', 'Liquid passing through the glass', 'Water created by the glass', 'Ice leaking from the sealed interior'], correct: ['Water vapour in the room air'],
  explanation: '[S1] Water vapour in room air condenses on the cold outer surface.',
  extra: { learningObjective: 'Explain evaporation, condensation, runoff and infiltration in the water cycle.',
    previousQuestions: [{ type: 'true-false', questionText: 'Condensation changes water vapour into liquid water.', explanation: 'This statement is true.' }] } });
glass.expected.stemPatterns = ['cold', 'sealed', 'glass', 'droplet|outside|outer'];
glass.expected.forbiddenStemPatterns = ['runoff', 'vegetation', 'infiltration', '\\bcalculate\\b'];
const wrongTopic = structuredClone(glass.gold);
wrongTopic.questionText = 'How does vegetation affect infiltration and runoff?';
glass.counterexamples.push({ id: 'changed-topic', fails: ['facts.request-topic', 'facts.request-exclusions'], output: wrongTopic });

const grounding = mcq({ id: 'source-grounding', title: 'Synthetic citation and support boundary',
  facts: 'A fictional classroom Zorbi trial reports: Group A sprouted after 5 days; Group B after 8 days. The trial gives no cause and no sample sizes. No other trial is described.',
  instructions: 'Ask which group sprouted earlier in the supplied Zorbi trial. Cite [S1] in the explanation. Say the cause is not given. Do not invent a mechanism, sample size, outside study or source.',
  stem: 'Which group sprouted earlier in the fictional Zorbi trial?',
  answers: ['Group A', 'Group B', 'Both on the same day', 'The timing is not given'], correct: ['Group A'],
  explanation: '[S1] Group A sprouted after 5 days, before Group B at 8 days. The cause is not given.' });
grounding.expected.explanationPatterns = ['\\[S1\\]', '5', '8', 'cause.{0,30}(not|unknown)|no.{0,15}cause'];
grounding.expected.allowedCitations = ['S1'];
const invented = structuredClone(grounding.gold);
invented.explanation = '[S2] A published fertilizer study proves that nitrogen caused the faster growth.';
grounding.counterexamples.push({ id: 'invented-source-cause', fails: ['facts.source-support', 'facts.citation-allowlist'], output: invented });

const documentationGold = { title: 'Read, reflect and export', params: { taskDescription: 'Record an explanation using the supplied facts.', pagesList: [
  native('H5P.StandardPage 1.5', '1. Read', { elementList: [native('H5P.Text 1.1', 'Reading', { text: '<p>[S1] Water vapour becomes liquid water through condensation.</p>' })] }),
  native('H5P.StandardPage 1.5', '2. Reflect', { elementList: [native('H5P.TextInputField 1.2', 'Your explanation', { taskDescription: 'Explain condensation in your own words.', placeholderText: 'Write your explanation.', inputFieldSize: '3' })] }),
  native('H5P.DocumentExportPage 1.5', '3. Export', { description: 'Export your written response.' })
] } };
const documentation = {
  id: 'documentation-three-step', title: 'Native Documentation: reading, written response, export', surface: 'studio', synthetic: true,
  request: { library: 'H5P.DocumentationTool 1.8', context: '[S1] Condensation changes water vapour into liquid water.',
    instructions: 'Create exactly three ordered native pages: 1. Read (a short reading using S1); 2. Reflect (one written response field asking learners to explain condensation); 3. Export (export the learner response). No goals pages and no scored multiple-choice questions. Use only this fact: condensation changes water vapour into liquid water.' },
  expected: { pageLibraries: ['H5P.StandardPage', 'H5P.StandardPage', 'H5P.DocumentExportPage'] },
  gold: documentationGold,
  counterexamples: [
    { id: 'title-only', fails: ['structure.documentation-pages'], output: { title: 'Empty tool', params: { taskDescription: 'Documentation tool' } } },
    { id: 'missing-response-input', fails: ['structure.documentation-response'], output: { ...documentationGold, params: { ...documentationGold.params, pagesList: documentationGold.params.pagesList.map((page, index) => index === 1 ? native('H5P.StandardPage 1.5', 'Reflect', { elementList: [native('H5P.Text 1.1', 'Read more', { text: 'Think about condensation.' })] }) : page) } } },
    { id: 'missing-export', fails: ['structure.documentation-order'], output: { ...documentationGold, params: { ...documentationGold.params, pagesList: documentationGold.params.pagesList.slice(0, 2) } } }
  ], teacherRubric: rubric
};

export const cases = [documentation, single, multiple, arithmetic, hypothetical, glass, grounding];
