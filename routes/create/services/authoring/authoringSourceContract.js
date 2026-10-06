import { resolveAuthoringContext } from './authoringContext.js';
import { digest, fail } from './authoringContracts.js';
import { QUESTION_REVIEW_POLICY_VERSION } from '../questionReviewContract.js';
import { isMaterialReady } from '../../utils/generationReadiness.js';

const selectedIds = values => [...new Set((values || []).map(String))].sort();
const requirements = session => Object.fromEntries(Object.entries(session.teachingRequirements?.fields || {})
  .sort(([left], [right]) => left.localeCompare(right)).map(([name, field]) => [name, field?.value]));
const sourceSignature = context => digest({
  courseId: String(context.course?._id || ''),
  materials: context.materials.map(material => ({ id: String(material._id), updatedAt: material.updatedAt,
    checksum: material.checksum || '', status: material.processingStatus,
    contentHash: digest(String(material.content || '')) })).sort((left, right) => left.id.localeCompare(right.id)),
  objectives: context.objectives.map(objective => ({ id: String(objective._id), updatedAt: objective.updatedAt,
    contentHash: digest({ text: objective.text, subpoints: objective.subpoints,
      metadataSubpoints: objective.generationMetadata?.subpoints }) })).sort((left, right) => left.id.localeCompare(right.id))
});
const scope = session => ({ owner: String(session.owner), sessionId: String(session._id),
  courseId: String(session.courseId), quizId: String(session.quizId || ''),
  baseVersionId: String(session.currentVersionId || ''), contextCourse: session.contextCourse === true,
  materialIds: selectedIds(session.materialIds), objectiveIds: selectedIds(session.objectiveIds),
  requirementSignature: digest({ fields: requirements(session), countIssue: session.teachingRequirements?.countIssue || '' }),
  reviewPolicyVersion: QUESTION_REVIEW_POLICY_VERSION });

async function readSources(session, { resolveContext, guard, signal }) {
  signal?.throwIfAborted(); await guard();
  const context = await resolveContext(String(session.owner), { courseId: String(session.courseId),
    materialIds: selectedIds(session.materialIds), objectiveIds: selectedIds(session.objectiveIds) });
  if (context.materials.some(material => !isMaterialReady(material))) {
    fail('The selected sources are no longer ready. Saved work is preserved; request an updated proposal.', 409, 'AUTHORING_SOURCE_CHANGED');
  }
  signal?.throwIfAborted(); await guard();
  return context;
}

/** A generated proposal is bound to the actual authorized source revisions.
 * Only fingerprints and identifiers are stored here, never excerpts or prompts.
 * Manual saves and historical restores do not acquire a fresh AI review claim.
 */
export async function buildAuthoringSourceContract({ session, resolveContext = resolveAuthoringContext,
  guard = async () => {}, signal }) {
  const context = await readSources(session, { resolveContext, guard, signal });
  return { version: 1, ...scope(session), sourceSignature: sourceSignature(context) };
}

export async function validateAuthoringSourceContract({ session, contract,
  resolveContext = resolveAuthoringContext, guard = async () => {}, signal }) {
  const currentScope = scope(session);
  if (contract?.version !== 1 || !contract.sourceSignature
    || Object.entries(currentScope).some(([name, value]) => JSON.stringify(contract[name]) !== JSON.stringify(value))) {
    fail('The saved proposal belongs to a different activity, review policy or teaching scope. Request a new proposal.', 409, 'AUTHORING_CONTRACT_CHANGED');
  }
  const context = await readSources(session, { resolveContext, guard, signal });
  if (sourceSignature(context) !== contract.sourceSignature) {
    fail('The selected sources changed after this proposal was checked. Saved work is preserved; request an updated proposal.', 409, 'AUTHORING_SOURCE_CHANGED');
  }
  return context;
}
