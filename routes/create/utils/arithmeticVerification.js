const fail = (code, message) => Object.assign(new Error(message), { code });
const unsupported = message => fail('ARITHMETIC_UNSUPPORTED_EXPRESSION', message);

/** Bounded arithmetic parser. Never evaluates JavaScript, functions, or units. */
export function evaluateArithmetic(expression) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 160) throw unsupported('Invalid arithmetic expression');
  const source = expression.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
  const tokens = [];
  const pattern = /\s*(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[()+*/-])/y;
  let position = 0;
  while (position < source.trimEnd().length) {
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    if (!match || tokens.length >= 128) throw unsupported('Unsupported arithmetic syntax');
    tokens.push(match[1]);
    position = pattern.lastIndex;
  }
  let cursor = 0;
  const finite = value => {
    if (!Number.isFinite(value)) throw unsupported('Non-finite arithmetic result');
    return value;
  };
  const factor = depth => {
    if (depth > 16) throw unsupported('Arithmetic nesting limit exceeded');
    const token = tokens[cursor++];
    if (token === '+' || token === '-') return finite((token === '-' ? -1 : 1) * factor(depth + 1));
    if (token === '(') {
      const value = sum(depth + 1);
      if (tokens[cursor++] !== ')') throw unsupported('Unbalanced arithmetic parentheses');
      return value;
    }
    if (!token || !/^(?:\d|\.)/.test(token)) throw unsupported('Expected arithmetic number');
    return finite(Number(token));
  };
  const product = depth => {
    let value = factor(depth);
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++];
      const right = factor(depth);
      if (operator === '/' && right === 0) throw fail('ARITHMETIC_DIVISION_BY_ZERO', 'Division by zero');
      value = finite(operator === '*' ? value * right : value / right);
    }
    return value;
  };
  const sum = depth => {
    let value = product(depth);
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++];
      const right = product(depth);
      value = finite(operator === '+' ? value + right : value - right);
    }
    return value;
  };
  const result = sum(0);
  if (cursor !== tokens.length) throw unsupported('Unexpected arithmetic token');
  return result;
}

const equal = (left, right) => Math.abs(left - right) <= 1e-10 * Math.max(1, Math.abs(left), Math.abs(right));
const normalize = value => value.replace(/\s+/g, '').replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
const isConstant = value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalize(value).replace(/[()]/g, ''));

/** Verify declared calculations and recognized explicit equations, then render. */
export function verifyAndRenderCalculations(text, calculations) {
  if (!Array.isArray(calculations) || calculations.length > 8) throw fail('ARITHMETIC_INVALID_SCHEMA', 'Missing or excessive declared calculations');
  for (const item of calculations) {
    if (!item || typeof item.expression !== 'string' || typeof item.result !== 'number' || !Number.isFinite(item.result)) throw fail('ARITHMETIC_INVALID_SCHEMA', 'Malformed declared calculation');
    if (!equal(evaluateArithmetic(item.expression), item.result)) throw fail('ARITHMETIC_FALSE_EQUALITY', 'A declared arithmetic result is incorrect');
  }
  const equations = [];
  // Only plain numerical equalities are recognized in free text. Scientific
  // symbols, units and arbitrary natural-language claims are not inferred.
  const equationPattern = /(?<![\w.,])([\d.()+*/−×÷\s-]+)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?![\w.])/g;
  for (const match of String(text).matchAll(equationPattern)) {
    const expression = match[1].trim();
    if (!/[+*/−×÷-]/.test(expression) && !isConstant(expression)) continue;
    let value;
    try { value = evaluateArithmetic(expression); }
    catch (error) {
      if (error.code === 'ARITHMETIC_DIVISION_BY_ZERO') throw error;
      continue; // Unsupported prose is not proof of a wrong calculation.
    }
    const result = Number(match[2]);
    if (!equal(value, result)) throw fail('ARITHMETIC_FALSE_EQUALITY', 'An explicit arithmetic equation is incorrect');
    equations.push({ expression, result });
  }
  const meaningfulCalculations = calculations.filter(item => !isConstant(item.expression));
  const additions = meaningfulCalculations.filter(item => !equations.some(equation => normalize(equation.expression) === normalize(item.expression) && equal(equation.result, item.result)))
    .map(item => `${item.expression.trim()} = ${item.result}.`);
  return { text: [String(text).trim(), ...additions].filter(Boolean).join(' '),
    verifiedCount: meaningfulCalculations.length + equations.filter(equation => !isConstant(equation.expression) && !calculations.some(item => normalize(equation.expression) === normalize(item.expression))).length };
}
