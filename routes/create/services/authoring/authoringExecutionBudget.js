// One request can perform a sustained sequence of source checks while retaining
// a hard bound on model decisions. Generation has its separate job budget.
export const DEFAULT_AUTHORING_DECISIONS = 32;
export function authoringDecisionBudget(value = process.env.AUTHORING_AGENT_MAX_DECISIONS) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 64 ? limit : DEFAULT_AUTHORING_DECISIONS;
}
