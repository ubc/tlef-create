import { getStudioCatalog, libraryProblems } from '../services/h5pStudioCatalog.js';

// Guard authoring/export against incomplete deployed runtime assets while
// keeping existing content readable. Healthy pinned installations are enabled.
export function getQuestionTypeAvailability(type) {
  if (type !== 'branching-scenario') return { available: true };
  const problems = libraryProblems('H5P.BranchingScenario 1.10', getStudioCatalog().libraries);
  if (!problems.length) return { available: true };
  return {
    available: false,
    code: 'QUESTION_TYPE_UNAVAILABLE',
    status: 503,
    message: `Branching Scenario cannot start because its H5P runtime is incomplete. Existing activities are kept. Please contact support to restore the installed libraries. ${problems[0]}`
  };
}
