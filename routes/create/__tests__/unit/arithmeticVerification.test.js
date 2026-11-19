import { describe, expect, test } from '@jest/globals';
import { computeAndRenderCalculations, evaluateArithmetic, verifyAndRenderCalculations } from '../../utils/arithmeticVerification.js';

describe('bounded arithmetic verification', () => {
  test.each([
    ['12 + 8 - 3', 17], ['(18 + 6) / 3', 8], ['-2 * (3 + 4)', -14],
    ['0.1 + 0.2', 0.3], ['7 × 8 − 6 ÷ 2', 53], ['.5 * 8', 4], ['1e2 / 4', 25]
  ])('evaluates %s with normal precedence', (expression, value) => {
    expect(evaluateArithmetic(expression)).toBeCloseTo(value, 10);
  });
  test.each([['8(1/8) + 6(1/2)', 4], ['(1/2)(4)', 2], ['2(3)', 6], ['8(1/8)(2)', 2], ['1.5(2)', 3]])('reads adjacent parentheses as multiplication: %s', (expression, value) => {
    expect(evaluateArithmetic(expression)).toBeCloseTo(value, 10);
  });
  test('does not multiply a number separated from parentheses by a space', () => {
    expect(() => evaluateArithmetic('2 (1 + 1)')).toThrow(expect.objectContaining({ code: 'ARITHMETIC_UNSUPPORTED_EXPRESSION' }));
    expect(verifyAndRenderCalculations('Step 2 (1 + 1) = 2 shows the sum.', []).verifiedCount).toBe(0);
  });
  test('treats a leading name in a declared calculation as prose', () => {
    expect(computeAndRenderCalculations('FCC has 12 nearest neighbours.', [{ expression: 'CN_SC = 6' }, { expression: 'CN FCC = 12' }]))
      .toEqual({ text: 'FCC has 12 nearest neighbours.', verifiedCount: 0 });
    expect(computeAndRenderCalculations('FCC.', [{ expression: 'N_FCC = 8(1/8) + 6(1/2)' }]))
      .toEqual({ text: 'FCC. 8(1/8) + 6(1/2) = 4.', verifiedCount: 1 });
    expect(() => verifyAndRenderCalculations('BCC.', [{ expression: 'N_BCC = 8(1/8) + 1', result: 3 }])).toThrow('incorrect');
  });
  test.each([
    '(charge_Ca2+ * charge_O2-) > (charge_K+ * charge_I-)', 'f = 1 - pi/6', '√3 / 4', '2 kilograms + 2 kilograms',
    '', 'process.exit()', '1e999', '1+'.repeat(100) + '1'
  ])('drops a declared expression it cannot read instead of rejecting the draft: %s', expression => {
    expect(computeAndRenderCalculations('CaO melts higher.', [{ expression }, { expression: '2 * 3' }]))
      .toEqual({ text: 'CaO melts higher. 2 * 3 = 6.', verifiedCount: 1 });
    expect(verifyAndRenderCalculations('CaO melts higher.', [{ expression, result: 4 }]))
      .toEqual({ text: 'CaO melts higher.', verifiedCount: 0 });
  });
  test('still rejects readable declarations that are wrong or divide by zero', () => {
    expect(() => computeAndRenderCalculations('Void.', [{ expression: 'pi' }, { expression: '2 * 7', result: 15 }]))
      .toThrow(expect.objectContaining({ code: 'ARITHMETIC_FALSE_EQUALITY' }));
    expect(() => computeAndRenderCalculations('Void.', [{ expression: 'pi' }, { expression: '1 / (2 - 2)' }]))
      .toThrow(expect.objectContaining({ code: 'ARITHMETIC_DIVISION_BY_ZERO' }));
  });
  test.each(['3 / 0', '1 +', '1 2', '2 (3)', 'sqrt(4)', 'Math.max(2,3)', 'process.exit()', '2 ** 3', 'Infinity', '1e999', '20%', '2 kg + 3 kg', '('.repeat(30) + '1' + ')'.repeat(30)])('refuses unsupported or unsafe declared syntax: %s', expression => {
    expect(() => evaluateArithmetic(expression)).toThrow();
  });
  test('renders only checked declared results without duplicating an existing correct equation', () => {
    expect(verifyAndRenderCalculations('Net change.', [{ expression: '12 + 5 - 3', result: 14 }])).toEqual({ text: 'Net change. 12 + 5 - 3 = 14.', verifiedCount: 1 });
    expect(verifyAndRenderCalculations('12 + 5 - 3 = 14 tokens.', [{ expression: '12 + 5 - 3', result: 14 }]).text).toBe('12 + 5 - 3 = 14 tokens.');
  });
  test('blocks a contradictory equation embedded in free text', () => {
    expect(() => verifyAndRenderCalculations('The result is 7 × 8 = 54.', [])).toThrow('incorrect');
  });
  test.each(['7 * 8 = 54.0.', '9.8*(.5-.2*.8660254037844386) = 3.21.'])('checks exact decimal equalities before sentence punctuation: %s', prose => {
    expect(() => verifyAndRenderCalculations(prose, [])).toThrow('incorrect');
  });
  test('restates a correctly rounded exact claim as an approximation instead of rejecting it', () => {
    expect(verifyAndRenderCalculations('So 9.8*(.5-.2*.8660254037844386) = 3.20.', [])).toEqual({ text: 'So 9.8*(.5-.2*.8660254037844386) ≈ 3.20.', verifiedCount: 0 });
    expect(verifyAndRenderCalculations('Density: 4 × 63.55 / 6.022 = 42.21 g.', []).text).toBe('Density: 4 × 63.55 / 6.022 ≈ 42.21 g.');
    expect(verifyAndRenderCalculations('Void fraction is 1 - 3.14159265/6 = 0.4764.', []).text).toBe('Void fraction is 1 - 3.14159265/6 ≈ 0.4764.');
  });
  test.each(['4 × 63.55 / 6.022 = 42.22.', '12 * 9.8 = 117.7.', '10 / 3 = 3.', '7 / 2 = 4.'])('still rejects values that are wrong or too coarse to be a rounding: %s', prose => {
    expect(() => verifyAndRenderCalculations(prose, [])).toThrow(expect.objectContaining({ code: 'ARITHMETIC_FALSE_EQUALITY' }));
  });
  test('checks chained equalities link by link', () => {
    expect(verifyAndRenderCalculations('FCC: 8 × 1/8 + 6 × 1/2 = 1 + 3 = 4 atoms.', [])).toEqual({ text: 'FCC: 8 × 1/8 + 6 × 1/2 = 1 + 3 = 4 atoms.', verifiedCount: 2 });
    expect(verifyAndRenderCalculations('So 1 - 0.5236 = 0.4764 = 47.64 / 100.', []).verifiedCount).toBe(1);
    expect(() => verifyAndRenderCalculations('So 1 - 0.5236 = 0.4764 = 47.65 / 100.', [])).toThrow('incorrect');
    expect(() => verifyAndRenderCalculations('BCC: 8 × 1/8 + 1 = 1 + 1 = 3 atoms.', [])).toThrow(expect.objectContaining({ calculation: { expression: '1 + 1', claimed: 3, computed: 2 } }));
  });
  test('skips unparseable links of a chain but checks the rest', () => {
    expect(verifyAndRenderCalculations('8 × ⅛ + 6 × ½ = 1 + 3 = 4 atoms.', []).verifiedCount).toBe(1);
    expect(() => verifyAndRenderCalculations('8 × ⅛ + 6 × ½ = 1 + 3 = 5 atoms.', [])).toThrow('incorrect');
  });
  test('checks the textbook unit-cell notation in prose', () => {
    expect(verifyAndRenderCalculations('FCC: 8(1/8) + 6(1/2) = 4 atoms.', []).verifiedCount).toBe(1);
    expect(() => verifyAndRenderCalculations('BCC: 8(1/8) + 1 = 3 atoms.', [])).toThrow('incorrect');
  });
  test('does not treat an explicitly rounded approximation as an exact verified equation', () => {
    const prose = '9.8*(.5-.2*.8660254037844386) ≈ 3.20.';
    expect(verifyAndRenderCalculations(prose, [])).toEqual({ text: prose, verifiedCount: 0 });
    expect(verifyAndRenderCalculations('7 * 8 = 56.0.', []).verifiedCount).toBe(1);
  });
  test('does not call symbolic text, units or qualitative feedback arithmetically verified', () => {
    const prose = 'Use F = ma, the 5 kg mass, and the fictional upward gravity rule.';
    expect(verifyAndRenderCalculations(prose, [])).toEqual({ text: prose, verifiedCount: 0 });
  });
  test('does not append constant identities or treat them as meaningful computation', () => {
    expect(verifyAndRenderCalculations('Group A took 5 days; group B took 8.', [{ expression: '5', result: 5 }, { expression: '(8)', result: 8 }]))
      .toEqual({ text: 'Group A took 5 days; group B took 8.', verifiedCount: 0 });
    expect(() => verifyAndRenderCalculations('A false constant.', [{ expression: '5', result: 8 }])).toThrow('incorrect');
    expect(() => verifyAndRenderCalculations('The claim is 5 = 8.', [])).toThrow('incorrect');
  });
  test('allows normal decimal precision but not an incorrect claimed result', () => {
    expect(verifyAndRenderCalculations('Decimal sum.', [{ expression: '0.1 + 0.2', result: 0.3 }]).verifiedCount).toBe(1);
    expect(() => verifyAndRenderCalculations('Decimal sum.', [{ expression: '0.1 + 0.2', result: 0.31 }])).toThrow('incorrect');
  });
  test.each([
    [undefined, 'ARITHMETIC_INVALID_SCHEMA'],
    [[{ expression: '2 + 2', result: '4' }], 'ARITHMETIC_INVALID_SCHEMA'],
    [[{ expression: '2 / 0', result: 0 }], 'ARITHMETIC_DIVISION_BY_ZERO'],
    [[{ expression: '2 * 7', result: 15 }], 'ARITHMETIC_FALSE_EQUALITY']
  ])('distinguishes malformed, unsupported, undefined and false declarations', (declarations, code) => {
    try { verifyAndRenderCalculations('Explanation.', declarations); throw new Error('Expected validation to fail'); }
    catch (error) { expect(error.code).toBe(code); }
  });
});

describe('server-computed feedback expressions', () => {
  test('computes the incline acceleration without asking the writer for a numeric result', () => {
    const expression = '9.8*(0.5-0.2*0.8660254037844386)';
    const check = computeAndRenderCalculations('Acceleration ≈ 3.20 m/s².', [{ expression }]);
    expect(check.text).toBe(`Acceleration ≈ 3.20 m/s². ${expression} ≈ 3.202590209.`);
    expect(check.verifiedCount).toBe(1);
    expect(() => computeAndRenderCalculations('Acceleration.', [{ expression, result: 3.2025904085829 }])).toThrow('incorrect');
  });
  test('keeps floating-point tails out of learner feedback without relaxing verification', () => {
    expect(computeAndRenderCalculations('Weight.', [{ expression: '12.0 * 9.80' }]).text).toBe('Weight. 12.0 * 9.80 ≈ 117.6.');
    expect(computeAndRenderCalculations('Acceleration.', [{ expression: '7 / 2.4' }]).text).toBe('Acceleration. 7 / 2.4 ≈ 2.916666667.');
    expect(computeAndRenderCalculations('Force.', [{ expression: '3 * 4' }]).text).toBe('Force. 3 * 4 = 12.');
    expect(computeAndRenderCalculations('', [{ expression: '1/3', result: 0.3333333333 }]).text).toBe('1/3 ≈ 0.3333333333.');
    expect(computeAndRenderCalculations('', [{ expression: '100000000000+1', result: 100000000000 }]).text).toBe('100000000000+1 ≈ 100000000000.');
    expect(() => computeAndRenderCalculations('12 * 9.8 = 117.7.', [{ expression: '12 * 9.8' }])).toThrow('incorrect');
    expect(() => computeAndRenderCalculations('Weight.', [{ expression: '12 * 9.8', result: 117.7 }])).toThrow('incorrect');
  });
  test('supports correct legacy claims alongside new expressions without duplicating prose equations', () => {
    expect(computeAndRenderCalculations('7 * 8 = 56.0.', [{ expression: '7 * 8' }, { expression: '12 + 8', result: 20 }]))
      .toEqual({ text: '7 * 8 = 56.0. 12 + 8 = 20.', verifiedCount: 2 });
  });
  test.each([
    [undefined, 'ARITHMETIC_INVALID_SCHEMA'],
    [[['2 + 2']], 'ARITHMETIC_INVALID_SCHEMA'],
    [[{ expression: '2 + 2', unit: 'm' }], 'ARITHMETIC_INVALID_SCHEMA'],
    [[{ expression: '3 / 0' }], 'ARITHMETIC_DIVISION_BY_ZERO'],
    [[{ expression: '2 + 2', result: '4' }], 'ARITHMETIC_INVALID_SCHEMA'],
    [[{ expression: '2 + 2', result: 5 }], 'ARITHMETIC_FALSE_EQUALITY'],
    [Array.from({ length: 9 }, () => ({ expression: '2 + 2' })), 'ARITHMETIC_INVALID_SCHEMA']
  ])('fails closed for malformed or unsafe feedback formulas', (entries, code) => {
    expect(() => computeAndRenderCalculations('Explanation.', entries)).toThrow(expect.objectContaining({ code }));
  });
});
