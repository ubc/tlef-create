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
    // Textbook notation such as 8(1/8) or (1/2)(4) multiplies. Only adjacent
    // tokens count: "Step 2 (1 + 1)" in prose must not become 2 × 2.
    const previous = tokens[tokens.length - 1];
    if (match[0] === match[1] && previous !== undefined && match[1] === '(' && /[\d.)]$/.test(previous)) tokens.push('*');
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
const falseEquality = (expression, claimed, computed, message) => Object.assign(fail('ARITHMETIC_FALSE_EQUALITY', message), {
  calculation: { expression: expression.trim(), claimed, computed }
});
const normalize = value => value.replace(/\s+/g, '').replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
// A plain decimal literal with at least two significant figures that equals the
// computed value rounded to the literal's own decimal places. One significant
// figure ("10 / 3 = 3") is too coarse to call a rounding.
const roundsTo = (computed, literal) => {
  const match = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(literal.replace(/−/g, '-'));
  if (!match || (!match[2] && !match[3])) return false;
  const decimals = (match[3] || '').length;
  if ((match[2] + (match[3] || '')).replace(/^0+/, '').length < 2) return false;
  return Math.abs(computed - Number(literal.replace(/−/g, '-'))) <= 0.5 * 10 ** -decimals * (1 + 1e-9);
};
const isConstant = value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalize(value).replace(/[()]/g, ''));

// Keep full precision for validation; only shorten the displayed derivation.
// A rounded display must never masquerade as an exact equality.
const renderCalculation = item => {
  const computed = evaluateArithmetic(item.expression);
  const display = Number(computed.toPrecision(10));
  return `${item.expression.trim()} ${display === computed ? '=' : '≈'} ${display}.`;
};

/** Verify declared calculations and recognized explicit equations, then render. */
// Writers also declare qualitative claims ("(charge_Ca * charge_O) > ...") or
// symbolic notation (pi, sqrt). Those cannot be checked, so they are dropped:
// nothing is appended or counted as verified, exactly as if the writer had
// returned no calculation. Wrong results and division by zero still reject.
const UNREADABLE = Symbol('unreadable');
const evaluateDeclared = expression => {
  try { return evaluateArithmetic(expression); }
  catch (error) {
    if (error.code === 'ARITHMETIC_UNSUPPORTED_EXPRESSION') return UNREADABLE;
    throw error;
  }
};

// Writers sometimes name a declared value ("CN_SC = 6", "N_FCC = 8(1/8) + 6(1/2)").
// The name is prose; only the right-hand side is arithmetic. A bare named
// number then counts as a constant: neither rendered nor reported as verified.
const stripLabel = expression => {
  if (typeof expression !== 'string') return expression;
  const match = /^\s*[A-Za-z_][A-Za-z0-9_ ]{0,39}=(?!=)(.*)$/s.exec(expression);
  return match && match[1].trim() ? match[1].trim() : expression;
};

export function verifyAndRenderCalculations(text, calculations) {
  if (!Array.isArray(calculations) || calculations.length > 8) throw fail('ARITHMETIC_INVALID_SCHEMA', 'Missing or excessive declared calculations');
  calculations = calculations.map(item => item && typeof item === 'object' && typeof item.expression === 'string'
    ? { ...item, expression: stripLabel(item.expression) } : item);
  const readable = [];
  for (const item of calculations) {
    if (!item || typeof item.expression !== 'string' || typeof item.result !== 'number' || !Number.isFinite(item.result)) throw fail('ARITHMETIC_INVALID_SCHEMA', 'Malformed declared calculation');
    const computed = evaluateDeclared(item.expression);
    if (computed === UNREADABLE) continue;
    if (!equal(computed, item.result)) throw falseEquality(item.expression, item.result, computed, 'A declared arithmetic result is incorrect');
    readable.push(item);
  }
  calculations = readable;
  const equations = [];
  const source = String(text);
  const approximations = [];
  // Only plain numerical equalities are recognized in free text. Scientific
  // symbols, units and arbitrary natural-language claims are not inferred.
  // Chains such as "8 × 1/8 + 6 × 1/2 = 1 + 3 = 4" are checked link by link.
  const chainPattern = /(?<![\w.,])[\d.()+*/−×÷\s-]+(?:=[\d.()+*/−×÷\s-]+)+(?!\w)/g;
  for (const match of source.matchAll(chainPattern)) {
    const segments = [];
    let offset = match.index;
    for (const raw of match[0].split('=')) {
      // A trailing period is sentence punctuation, not part of the number.
      const expression = raw.trim().replace(/\.+$/, '');
      let value = null;
      if (expression) {
        try { value = evaluateArithmetic(expression); }
        catch (error) {
          if (error.code === 'ARITHMETIC_DIVISION_BY_ZERO') throw error;
          // Unsupported prose is not proof of a wrong calculation.
        }
      }
      segments.push({ expression, value, equalsAt: offset + raw.length });
      offset += raw.length + 1;
    }
    for (let index = 0; index + 1 < segments.length; index++) {
      const left = segments[index];
      const right = segments[index + 1];
      if (left.value === null || right.value === null) continue;
      if (equal(left.value, right.value)) {
        equations.push({ expression: left.expression, result: right.value });
      } else if (roundsTo(left.value, right.expression)) {
        // Correct once rounded: state it as an approximation rather than
        // rejecting the draft or presenting the rounding as exact.
        approximations.push(left.equalsAt);
      } else {
        throw falseEquality(left.expression, right.value, left.value, 'An explicit arithmetic equation is incorrect');
      }
    }
  }
  const checkedText = approximations.reduceRight((value, at) => `${value.slice(0, at)}≈${value.slice(at + 1)}`, source);
  const meaningfulCalculations = calculations.filter(item => !isConstant(item.expression));
  const additions = meaningfulCalculations.filter(item => !equations.some(equation => normalize(equation.expression) === normalize(item.expression) && equal(equation.result, item.result)))
    .map(renderCalculation);
  return { text: [checkedText.trim(), ...additions].filter(Boolean).join(' '),
    verifiedCount: meaningfulCalculations.length + equations.filter(equation => !isConstant(equation.expression) && !calculations.some(item => normalize(equation.expression) === normalize(item.expression))).length };
}

/** A feedback writer supplies formulas; the application supplies their values.
 * Legacy explicit claims and free-text equalities retain the strict verifier.
 * Computing a formula does not establish that it models the teaching task.
 */
export function computeAndRenderCalculations(text, calculations) {
  if (!Array.isArray(calculations) || calculations.length > 8) throw fail('ARITHMETIC_INVALID_SCHEMA', 'Missing or excessive declared calculations');
  const computed = calculations.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['expression', 'result'].includes(key))
      || typeof item.expression !== 'string') throw fail('ARITHMETIC_INVALID_SCHEMA', 'Malformed declared calculation');
    const expression = stripLabel(item.expression);
    if (Object.hasOwn(item, 'result')) return [{ ...item, expression }];
    const result = evaluateDeclared(expression);
    return result === UNREADABLE ? [] : [{ expression, result }];
  });
  return verifyAndRenderCalculations(text, computed);
}
