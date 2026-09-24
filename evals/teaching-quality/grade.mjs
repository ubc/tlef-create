const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const normalized = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const sameSet = (left, right) => left.length === right.length && [...left].map(normalized).sort().join('\0') === [...right].map(normalized).sort().join('\0');
const libraryName = item => String(item?.library || '').split(' ')[0];
const matchesAll = (text, patterns) => patterns.every(pattern => new RegExp(pattern, 'i').test(text));
const sum = expression => (expression.replaceAll('−', '-').replace(/\s+/g, '').match(/[+-]?\d+(?:\.\d+)?/g) || []).reduce((total, term) => total + Number(term), 0);

function arithmeticClaimsAreValid(options, startingAmount) {
  return options.every(option => [option.chosenFeedback, option.notChosenFeedback].every(value => {
    const text = String(value || '');
    const equations = [...text.matchAll(/(\d+(?:\s*[+−-]\s*\d+)+)\s*=\s*(-?\d+)/g)];
    if (equations.some(match => sum(match[1]) !== Number(match[2]))) return false;
    // Evaluate only explicitly claimed derivations of this numeric option.
    // Natural-language mathematics outside these forms remains a human task.
    const claimedResult = /^\d+$/.test(String(option.text)) ? Number(option.text) : null;
    if (claimedResult === null) return true;
    const explicit = text.match(/(?:would (?:be (?:the )?)?result|reflects|arises from)[\s\S]{0,140}?(\d+)\s*\+\s*(\d+)\s+before\s+(?:subtracting|removing)\s+(\d+)/i);
    if (explicit && Number(explicit[1]) + Number(explicit[2]) - Number(explicit[3]) !== claimedResult) return false;
    const substitution = text.match(/(?:would (?:be (?:the )?)?result|reflects|arises from)[\s\S]{0,80}?add(?:ed|ing)?\s+(\d+)(?:\s+tokens)?\s+instead of\s+\d+\s+before\s+(?:subtracting|removing)\s+(\d+)/i);
    return !substitution || startingAmount + Number(substitution[1]) - Number(substitution[2]) === claimedResult;
  }));
}

// These are bounded deterministic contracts, not an automated pedagogy verdict.
export function gradeCase(testCase, output) {
  const checks = [];
  const check = (id, passed, detail) => checks.push({ id, category: id.startsWith('structure.') ? 'engineering' : 'deterministic-facts', passed: Boolean(passed), detail });
  const expected = testCase.expected;
  if (testCase.surface === 'studio') {
    const pages = output?.params?.pagesList;
    const validPages = Array.isArray(pages) ? pages : [];
    check('structure.documentation-pages', nonempty(output?.title) && validPages.length > 0, 'A titled native document contains actual pages.');
    check('structure.documentation-order', validPages.length === 3 && validPages.every((page, index) => libraryName(page) === expected.pageLibraries[index]), 'Exactly Read → Reflect → Export pages, with final native export page.');
    check('structure.documentation-reading', validPages[0]?.params?.elementList?.some(item => libraryName(item) === 'H5P.Text' && nonempty(item.params?.text)), 'Reading page includes real text.');
    check('structure.documentation-response', validPages[1]?.params?.elementList?.some(item => libraryName(item) === 'H5P.TextInputField' && nonempty(item.params?.taskDescription)), 'Reflection page contains a labelled learner input.');
    check('structure.documentation-titles', validPages.length > 0 && validPages.every(page => nonempty(page.metadata?.title)), 'Every page has a visible title.');
  } else {
    // The production model contract uses root options; persistence nests them.
    const candidateOptions = output?.content?.options ?? output?.options;
    const options = Array.isArray(candidateOptions) ? candidateOptions : [];
    const correct = options.filter(option => option.isCorrect === true).map(option => option.text);
    const stem = String(output?.questionText || '');
    const explanation = String(output?.explanation || '');
    check('structure.question', nonempty(stem) && nonempty(explanation) && options.length === expected.optionTexts.length, 'Question, explanation and the requested number of options are present.');
    check('structure.answer-mode', (output?.content?.selectionMode ?? testCase.request.selectionMode) === expected.selectionMode && (expected.selectionMode === 'single' ? correct.length === 1 : correct.length === expected.correctOptions.length), 'Requested single/multiple answer mode and correct-option count. Raw model output may omit the mode because the request owns it.');
    check('structure.feedback', options.length > 0 && options.every(option => typeof option.isCorrect === 'boolean' && nonempty(option.chosenFeedback) && nonempty(option.notChosenFeedback)), 'Every option has a boolean key and both feedback actions.');
    check('facts.option-contract', sameSet(options.map(option => option.text), expected.optionTexts), 'Exact option texts required by this fixed evaluation task are retained.');
    check('facts.answer-key', sameSet(correct, expected.correctOptions), 'Answer flags match independently authored synthetic ground truth.');
    const answer = Array.isArray(output?.correctAnswer) ? output.correctAnswer : [output?.correctAnswer];
    check('facts.answer-key-consistency', sameSet(answer, expected.correctOptions), 'Persisted correctAnswer agrees with the known answer key.');
    // Detect only explicit learner-action contradictions; full semantic correctness needs a teacher.
    const wrongVerdict = text => /^(?:incorrect\b|this option is incorrect\b|wrong\b)/i.test(String(text).trim());
    const goodVerdict = text => /^(?:correct[.!:]|correctly\b|well done\b)/i.test(String(text).trim());
    check('facts.feedback-polarity', options.length > 0 && options.every(option => option.isCorrect
      ? !wrongVerdict(option.chosenFeedback) && !goodVerdict(option.notChosenFeedback)
      : !goodVerdict(option.chosenFeedback) && !wrongVerdict(option.notChosenFeedback)), 'Feedback contains no explicit selection/omission verdict opposite to its answer flag. This is a limited polarity check.');
    if (expected.arithmetic) {
      check('facts.arithmetic', matchesAll(explanation, [expected.arithmetic.expressionPattern]) && expected.arithmetic.operands[0] + expected.arithmetic.operands[1] - expected.arithmetic.operands[2] === expected.arithmetic.result, 'The requested arithmetic statement equals independently computed ground truth.');
      const allFeedback = [explanation, ...options.flatMap(option => [option.chosenFeedback, option.notChosenFeedback])].join('\n');
      const calculations = [...allFeedback.matchAll(/12\s*\+\s*5\s*[-−]\s*3\s*=\s*(-?\d+(?:\.\d+)?)/g)];
      check('facts.arithmetic-feedback', calculations.length > 0 && calculations.every(match => Number(match[1]) === expected.arithmetic.result), 'No feedback claims a false result for the exact supplied arithmetic expression. Other reasoning still requires human review.');
      check('facts.distractor-calculation', arithmeticClaimsAreValid(options, expected.arithmetic.operands[0]), 'Explicit addition/subtraction equations and supported conditional derivation forms must numerically produce their claimed answer. Unrecognized mathematical prose still needs a teacher.');
    }
    if (expected.stemPatterns) check('facts.request-topic', matchesAll(stem, expected.stemPatterns), 'The requested scenario/premise remains visible in the question; keyword presence alone is not proof of full instruction adherence.');
    if (expected.forbiddenStemPatterns) check('facts.request-exclusions', expected.forbiddenStemPatterns.every(pattern => !new RegExp(pattern, 'i').test(stem)), 'The stem does not switch to an explicitly excluded task.');
    if (expected.explanationPatterns) check('facts.source-support', matchesAll(explanation, expected.explanationPatterns), 'Explanation retains the fixed source facts and acknowledges the missing cause.');
    if (expected.allowedCitations) {
      const citations = [...explanation.matchAll(/\[(S\d+)\]/g)].map(match => match[1]);
      check('facts.citation-allowlist', citations.length > 0 && citations.every(id => expected.allowedCitations.includes(id)), 'Citation markers refer only to supplied synthetic excerpts. Does not test app reference persistence.');
    }
  }
  return { passed: checks.every(item => item.passed), checks,
    teacherReview: { status: 'pending', score: null, rubric: testCase.teacherRubric, note: 'A teacher must inspect meaning and teaching usefulness. No model-judge score is treated as ground truth.' } };
}
