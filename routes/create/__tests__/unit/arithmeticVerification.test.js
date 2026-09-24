import { describe, expect, test } from '@jest/globals';
import { evaluateArithmetic, verifyAndRenderCalculations } from '../../utils/arithmeticVerification.js';

describe('bounded arithmetic verification', () => {
  test.each([
    ['12 + 8 - 3', 17], ['(18 + 6) / 3', 8], ['-2 * (3 + 4)', -14],
    ['0.1 + 0.2', 0.3], ['7 × 8 − 6 ÷ 2', 53], ['.5 * 8', 4], ['1e2 / 4', 25]
  ])('evaluates %s with normal precedence', (expression, value) => {
    expect(evaluateArithmetic(expression)).toBeCloseTo(value, 10);
  });
  test.each(['3 / 0', '1 +', '1 2', '2(3)', 'sqrt(4)', 'Math.max(2,3)', 'process.exit()', '2 ** 3', 'Infinity', '1e999', '20%', '2 kg + 3 kg', '('.repeat(30) + '1' + ')'.repeat(30)])('refuses unsupported or unsafe declared syntax: %s', expression => {
    expect(() => evaluateArithmetic(expression)).toThrow();
  });
  test('renders only checked declared results without duplicating an existing correct equation', () => {
    expect(verifyAndRenderCalculations('Net change.', [{ expression: '12 + 5 - 3', result: 14 }])).toEqual({ text: 'Net change. 12 + 5 - 3 = 14.', verifiedCount: 1 });
    expect(verifyAndRenderCalculations('12 + 5 - 3 = 14 tokens.', [{ expression: '12 + 5 - 3', result: 14 }]).text).toBe('12 + 5 - 3 = 14 tokens.');
  });
  test('blocks a contradictory equation embedded in free text', () => {
    expect(() => verifyAndRenderCalculations('The result is 7 × 8 = 54.', [])).toThrow('incorrect');
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
    [[{ expression: '2 kilograms + 2 kilograms', result: 4 }], 'ARITHMETIC_UNSUPPORTED_EXPRESSION'],
    [[{ expression: '2 / 0', result: 0 }], 'ARITHMETIC_DIVISION_BY_ZERO'],
    [[{ expression: '2 * 7', result: 15 }], 'ARITHMETIC_FALSE_EQUALITY']
  ])('distinguishes malformed, unsupported, undefined and false declarations', (declarations, code) => {
    try { verifyAndRenderCalculations('Explanation.', declarations); throw new Error('Expected validation to fail'); }
    catch (error) { expect(error.code).toBe(code); }
  });
});
