import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals';
import { buildAuthoringSourceContract, validateAuthoringSourceContract } from '../../services/authoring/authoringSourceContract.js';
import { createVersion, acceptVersion } from '../../services/authoring/artifactVersionService.js';
import { QUESTION_REVIEW_POLICY_VERSION } from '../../services/questionReviewContract.js';
import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import LearningObjective from '../../models/LearningObjective.js';
import Quiz from '../../models/Quiz.js';
import H5PContent from '../../models/H5PContent.js';
import { AuthoringSession, AuthoringVersion } from '../../models/StudioAuthoring.js';

const clone = value => structuredClone(value);
function fixture() {
  const session = { _id: '111111111111111111111111', owner: '222222222222222222222222',
    courseId: '333333333333333333333333', quizId: '444444444444444444444444',
    currentVersionId: '555555555555555555555555', materialIds: ['666666666666666666666666'],
    objectiveIds: ['777777777777777777777777'], contextCourse: false,
    teachingRequirements: { fields: { exclusions: { value: 'Exclude advanced thermodynamics.', quote: 'Exclude advanced thermodynamics.' },
      questionCount: { value: 2 } } } };
  const context = { course: { _id: session.courseId },
    materials: [{ _id: session.materialIds[0], folder: session.courseId, uploadedBy: session.owner,
      content: 'Water changes from liquid to vapour.', processingStatus: 'completed', updatedAt: '2026-10-01T00:00:00.000Z' }],
    objectives: [{ _id: session.objectiveIds[0], quiz: session.quizId, createdBy: session.owner,
      text: 'Explain evaporation.', subpoints: ['Identify the phase change.'], updatedAt: '2026-10-01T00:00:00.000Z' }] };
  return { session, context, resolveContext: jest.fn(async () => clone(context)) };
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('authoring source contract', () => {
  test('stores only bounded identifiers and fingerprints and returns freshly authorized context', async () => {
    const f = fixture();
    const contract = await buildAuthoringSourceContract(f);
    expect(contract).toMatchObject({ version: 1, owner: f.session.owner, baseVersionId: f.session.currentVersionId,
      materialIds: f.session.materialIds, objectiveIds: f.session.objectiveIds, reviewPolicyVersion: QUESTION_REVIEW_POLICY_VERSION });
    expect(contract.sourceSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(contract)).not.toContain(f.context.materials[0].content);
    expect(JSON.stringify(contract)).not.toContain(f.session.teachingRequirements.fields.exclusions.value);
    await expect(validateAuthoringSourceContract({ ...f, contract })).resolves.toEqual(f.context);
    expect(f.resolveContext).toHaveBeenLastCalledWith(f.session.owner, { courseId: f.session.courseId,
      materialIds: f.session.materialIds, objectiveIds: f.session.objectiveIds });
  });

  test.each(['ready material version', 'ready material text', 'objective text', 'objective subpoint', 'processing failure'])(
    '%s invalidates a checked proposal even when selected IDs are unchanged', async change => {
      const f = fixture(); const contract = await buildAuthoringSourceContract(f);
      if (change === 'ready material version') f.context.materials[0].updatedAt = '2026-10-02T00:00:00.000Z';
      if (change === 'ready material text') f.context.materials[0].content = 'A newly corrected source fact.';
      if (change === 'objective text') f.context.objectives[0].text = 'Explain condensation.';
      if (change === 'objective subpoint') f.context.objectives[0].subpoints.push('Explain condensation.');
      if (change === 'processing failure') f.context.materials[0].processingStatus = 'failed';
      await expect(validateAuthoringSourceContract({ ...f, contract })).rejects.toMatchObject({ code: 'AUTHORING_SOURCE_CHANGED' });
    });

  test.each(['requirements', 'conflicting count', 'base version', 'selected scope', 'policy', 'missing field'])(
    '%s rejects replay before rereading or purchasing any work', async change => {
      const f = fixture(); const contract = await buildAuthoringSourceContract(f); f.resolveContext.mockClear();
      if (change === 'requirements') f.session.teachingRequirements.fields.exclusions.value = 'Exclude evaporation.';
      if (change === 'conflicting count') f.session.teachingRequirements.countIssue = 'Choose one count.';
      if (change === 'base version') f.session.currentVersionId = '888888888888888888888888';
      if (change === 'selected scope') f.session.contextCourse = true;
      if (change === 'policy') contract.reviewPolicyVersion = 'old-review-policy';
      if (change === 'missing field') delete contract.quizId;
      await expect(validateAuthoringSourceContract({ ...f, contract })).rejects.toMatchObject({ code: 'AUTHORING_CONTRACT_CHANGED' });
      expect(f.resolveContext).not.toHaveBeenCalled();
    });

  test('requirement provenance timestamps and selection order do not invalidate equivalent scope', async () => {
    const f = fixture(); f.session.materialIds.push('999999999999999999999999');
    f.context.materials.push({ ...f.context.materials[0], _id: f.session.materialIds[1] });
    const contract = await buildAuthoringSourceContract(f);
    f.session.materialIds.reverse(); f.context.materials.reverse();
    f.session.teachingRequirements.fields.exclusions.updatedAt = '2026-10-02T00:00:00.000Z';
    await expect(validateAuthoringSourceContract({ ...f, contract })).resolves.toEqual(f.context);
  });

  test('a revoked source authorization propagates without certifying the old cached content', async () => {
    const f = fixture(); const contract = await buildAuthoringSourceContract(f);
    f.resolveContext.mockRejectedValue(Object.assign(new Error('Course not found.'), { status: 404 }));
    await expect(validateAuthoringSourceContract({ ...f, contract })).rejects.toMatchObject({ status: 404 });
  });
});

function mockFreshOwnedContext(f) {
  jest.spyOn(Folder, 'findOne').mockImplementation(async () => clone(f.context.course));
  jest.spyOn(Material, 'find').mockImplementation(async () => clone(f.context.materials));
  jest.spyOn(LearningObjective, 'find').mockImplementation(async () => clone(f.context.objectives));
  jest.spyOn(Quiz, 'find').mockResolvedValue([{ _id: f.session.quizId, folder: f.session.courseId,
    learningObjectives: f.session.objectiveIds }]);
}

describe('packaging and acceptance freshness gates', () => {
  test('packaging a saved paid output refuses a changed ready source before creating content or a version', async () => {
    const f = fixture(); const authoringSourceContract = await buildAuthoringSourceContract(f);
    mockFreshOwnedContext(f);
    f.context.materials[0].updatedAt = '2026-10-02T00:00:00.000Z';
    const versionInit = jest.spyOn(AuthoringVersion, 'init').mockResolvedValue();
    const contentInit = jest.spyOn(H5PContent, 'init').mockResolvedValue();
    const create = jest.spyOn(AuthoringVersion, 'create').mockResolvedValue({});
    await expect(createVersion({ session: f.session, run: { _id: '888888888888888888888888' },
      snapshot: { name: 'Checked candidate' }, authoringSourceContract })).rejects.toMatchObject({ code: 'AUTHORING_SOURCE_CHANGED' });
    expect(versionInit).not.toHaveBeenCalled(); expect(contentInit).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  test('an unchanged packaging contract reuses its existing version receipt', async () => {
    const f = fixture(); const authoringSourceContract = await buildAuthoringSourceContract(f); mockFreshOwnedContext(f);
    jest.spyOn(AuthoringVersion, 'init').mockResolvedValue(); jest.spyOn(H5PContent, 'init').mockResolvedValue();
    const version = { _id: '888888888888888888888888', authoringSourceContract };
    jest.spyOn(AuthoringVersion, 'findOne').mockResolvedValue(version);
    const content = jest.spyOn(H5PContent, 'findOne').mockImplementation(() => { throw new Error('No content copy needed.'); });
    await expect(createVersion({ session: f.session, run: { _id: '999999999999999999999999' }, authoringSourceContract }))
      .resolves.toBe(version);
    expect(content).not.toHaveBeenCalled();
  });

  test.each(['source', 'requirements', 'policy'])(
    'acceptance refuses changed %s while keeping the current version and candidate', async change => {
      const f = fixture(); const authoringSourceContract = await buildAuthoringSourceContract(f); mockFreshOwnedContext(f);
      const version = { _id: '888888888888888888888888', parentId: f.session.currentVersionId,
        representation: 'course-linked', authoringSourceContract, state: 'candidate' };
      f.session.candidateVersionId = version._id;
      if (change === 'source') f.context.materials[0].content = 'Corrected course text.';
      if (change === 'requirements') f.session.teachingRequirements.fields.questionCount.value = 3;
      if (change === 'policy') authoringSourceContract.reviewPolicyVersion = 'old-review-policy';
      const currentId = f.session.currentVersionId;
      jest.spyOn(Quiz, 'exists').mockResolvedValue(null);
      const publish = jest.spyOn(Quiz, 'findOne').mockImplementation(() => { throw new Error('Publication must not start.'); });
      const commit = jest.spyOn(AuthoringSession, 'findOneAndUpdate').mockResolvedValue(null);
      const accept = jest.spyOn(AuthoringVersion, 'updateOne').mockResolvedValue({});
      await expect(acceptVersion(f.session, version, { _id: '999999999999999999999999' }, async () => {}))
        .rejects.toMatchObject({ code: change === 'source' ? 'AUTHORING_SOURCE_CHANGED' : 'AUTHORING_CONTRACT_CHANGED' });
      expect(publish).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled(); expect(accept).not.toHaveBeenCalled();
      expect(f.session.currentVersionId).toBe(currentId); expect(f.session.candidateVersionId).toBe(version._id);
      expect(version.state).toBe('candidate');
    });

  test('an already accepted proposal replays without rereading changed sources or committing again', async () => {
    const f = fixture(); const authoringSourceContract = await buildAuthoringSourceContract(f);
    const version = { _id: f.session.currentVersionId, representation: 'course-linked', authoringSourceContract };
    const materialReads = jest.spyOn(Material, 'find').mockImplementation(() => { throw new Error('No reread needed.'); });
    const commit = jest.spyOn(AuthoringSession, 'findOneAndUpdate').mockResolvedValue(null);
    await expect(acceptVersion(f.session, version, {}, async () => {})).resolves.toBeUndefined();
    expect(materialReads).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });

  test('a committed course manifest finishes acceptance bookkeeping without rereading superseded objective IDs', async () => {
    const f = fixture(); const authoringSourceContract = await buildAuthoringSourceContract(f);
    const newObjectiveId = '999999999999999999999999';
    const version = { _id: '888888888888888888888888', parentId: f.session.currentVersionId,
      contentId: 'saved-candidate', representation: 'course-linked', authoringSourceContract,
      publicationObjectiveMapping: { previousObjectiveIds: f.session.objectiveIds,
        publishedIds: { [f.session.objectiveIds[0]]: newObjectiveId } } };
    const currentQuiz = { name: 'Published activity', authoringCommitId: version._id, questions: [],
      learningObjectives: [{ _id: newObjectiveId, text: f.context.objectives[0].text }], materials: f.session.materialIds };
    jest.spyOn(Quiz, 'exists').mockResolvedValue({ _id: f.session.quizId });
    const query = { populate: jest.fn() };
    query.populate.mockReturnValueOnce(query).mockResolvedValueOnce(currentQuiz);
    jest.spyOn(Quiz, 'findOne').mockReturnValue(query);
    const materialReads = jest.spyOn(Material, 'find').mockImplementation(() => { throw new Error('Committed output needs no stale-source lookup.'); });
    const objectiveWrites = jest.spyOn(LearningObjective, 'updateOne').mockResolvedValue({});
    jest.spyOn(H5PContent, 'updateOne').mockResolvedValue({});
    const commit = jest.spyOn(AuthoringSession, 'findOneAndUpdate').mockResolvedValue({});
    jest.spyOn(AuthoringVersion, 'updateOne').mockResolvedValue({});
    await expect(acceptVersion(f.session, version, { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, async () => {})).resolves.toBeUndefined();
    expect(materialReads).not.toHaveBeenCalled(); expect(objectiveWrites).not.toHaveBeenCalled();
    expect(commit.mock.calls[0][1].$set).toMatchObject({ currentVersionId: version._id,
      candidateVersionId: null, objectiveIds: [newObjectiveId] });
  });
});
