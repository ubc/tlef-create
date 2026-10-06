import { expect, test } from '@jest/globals';
import { authoringDecisionBudget, DEFAULT_AUTHORING_DECISIONS } from '../../services/authoring/authoringExecutionBudget.js';

test.each(['', 'not-a-number', '0', '-1', '2.5', '65', 'Infinity'])('invalid decision budget %s retains the bounded default', input => {
  expect(authoringDecisionBudget(input)).toBe(DEFAULT_AUTHORING_DECISIONS);
});
test.each([1, 8, 32, 64])('honors an administrator-configured decision budget %s', limit => {
  expect(authoringDecisionBudget(String(limit))).toBe(limit);
});
