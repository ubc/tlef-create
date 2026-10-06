import { describe, expect, jest, test } from '@jest/globals';
import { createNativeTeachingStep } from '../../services/authoring/authoringNativeTeaching.js';

const owner = 'teacher';
const goals = [{ id: 'lo-1', text: 'Compare two chart values.', sourceReferences: [] }];
const makeSession = () => ({ _id: 'session-1', owner, courseId: 'course-1', materialIds: [], objectiveIds: [],
  instructions: 'Create a chart from the exact supplied data.', teachingRequirements: { version: 1,
    fields: { audience: { value: 'First-year students', requestId: 'first-request', updatedAt: '2026-10-01' } }, openQuestions: [] } });
const makeRun = () => ({ _id: 'run-1', requestId: 'request-1', input: { requestId: 'request-1' } });

function fixture(overrides = {}) {
  const dependencies = {
    resolveContext: jest.fn().mockResolvedValue({ materials: [], objectives: [] }),
    buildContext: jest.fn().mockResolvedValue({ context: 'Trusted sampled text.', sources: [] }),
    proposeObjectives: jest.fn().mockResolvedValue(goals),
    operation: jest.fn(async (_key, _label, work) => work()), persist: jest.fn().mockResolvedValue(undefined), ...overrides
  };
  const session = makeSession(); const run = makeRun();
  const invoke = createNativeTeachingStep(dependencies);
  const options = { session, run, latestRequest: session.instructions, guard: jest.fn().mockResolvedValue(undefined), checkpoint: jest.fn().mockResolvedValue(undefined) };
  return { dependencies, session, run, invoke, options };
}

describe('durable LO-first native teaching step', () => {
  test('identical requirement values survive refreshed quote/request/timestamp provenance without buying another call', async () => {
    const f = fixture();
    const brief = await f.invoke(f.options);
    expect(brief).toMatchObject({ grounding: 'instructor-brief', objectives: [{ id: 'lo-1', text: goals[0].text, sourceIds: [] }] });
    f.session.teachingRequirements.fields.audience = { value: 'First-year students', requestId: 're-extracted', updatedAt: '2026-10-02', quote: 'Students' };
    expect(await f.invoke(f.options)).toEqual(brief);
    expect(f.dependencies.proposeObjectives).toHaveBeenCalledTimes(1);
    expect(f.dependencies.buildContext).not.toHaveBeenCalled();
    expect(f.run.nativeTeachingState.phase).toBe('completed');
  });

  test('changed source or requirement values reject completed replay before another paid call', async () => {
    const f = fixture(); await f.invoke(f.options);
    f.session.teachingRequirements.fields.audience.value = 'Graduate students';
    await expect(f.invoke(f.options)).rejects.toMatchObject({ code: 'AUTHORING_SOURCE_CHANGED' });
    expect(f.dependencies.proposeObjectives).toHaveBeenCalledTimes(1);
  });

  test('a returned objective response is persisted before a racing Stop and resumes without paying again', async () => {
    const controller = new AbortController();
    const stopped = Object.assign(new Error('Stopped by instructor'), { code: 'AUTHORING_STOPPED' });
    const f = fixture({ proposeObjectives: jest.fn(async () => { controller.abort(stopped); return goals; }) });
    await expect(f.invoke({ ...f.options, signal: controller.signal, guard: async () => controller.signal.throwIfAborted() })).rejects.toBe(stopped);
    expect(f.run.nativeTeachingState).toMatchObject({ phase: 'model_saved', objectives: goals });
    expect(f.dependencies.persist.mock.calls.some(([call]) => call.state.phase === 'model_saved')).toBe(true);
    const resumed = await f.invoke({ ...f.options, explicitResume: true });
    expect(resumed.objectives[0].text).toBe(goals[0].text);
    expect(f.dependencies.proposeObjectives).toHaveBeenCalledTimes(1);
  });

  test('an unconfirmed paid result cannot be automatically replayed, but explicit Resume can buy the missing call', async () => {
    const unknown = Object.assign(new Error('Connection lost after submission'), { code: 'UNCONFIRMED_RESULT' });
    const f = fixture({ proposeObjectives: jest.fn().mockRejectedValueOnce(unknown).mockResolvedValueOnce(goals) });
    await expect(f.invoke(f.options)).rejects.toBe(unknown);
    expect(f.run.nativeTeachingState.phase).toBe('model_pending');
    await expect(f.invoke(f.options)).rejects.toMatchObject({ code: 'AUTHORING_NATIVE_TEACHING_UNKNOWN' });
    expect(f.dependencies.proposeObjectives).toHaveBeenCalledTimes(1);
    await f.invoke({ ...f.options, explicitResume: true });
    expect(f.dependencies.proposeObjectives).toHaveBeenCalledTimes(2);
    expect(f.run.nativeTeachingState.phase).toBe('completed');
  });

  test('reused objectives retain actual selected references outside the new sample while foreign references are excluded', async () => {
    const material = { _id: 'm-1', uploadedBy: owner, name: 'Newton Lecture Notes', type: 'pdf', content: 'Newton laws', updatedAt: '2026-10-01' };
    const sampled = { id: 'src-first', materialId: 'm-1', sourceFile: 'notes.pdf', pageNumber: 1, excerpt: 'Acceleration depends on net force.' };
    const oldRead = { materialId: 'm-1', sourceFile: 'notes.pdf', pageNumber: 7, chunkIndex: 9, section: 'Action and reaction', sectionId: 'law3', excerpt: 'Interaction forces act on different objects.' };
    const existing = { _id: 'saved-goal', text: 'Identify action-reaction force pairs.', generationMetadata: { sourceReferences: [oldRead, { ...oldRead, materialId: 'another-owner-source' }] } };
    const f = fixture({ resolveContext: jest.fn().mockResolvedValue({ materials: [material], objectives: [existing] }),
      buildContext: jest.fn().mockResolvedValue({ context: 'Sampled first page.', sources: [sampled] }) });
    f.session.materialIds = ['m-1']; f.session.objectiveIds = ['saved-goal'];
    const brief = await f.invoke(f.options);
    expect(f.dependencies.proposeObjectives).not.toHaveBeenCalled();
    expect(f.run.nativeTeachingState.sources).toHaveLength(2);
    expect(f.run.nativeTeachingState.sources.find(source => source.pageNumber === 7)).toMatchObject(oldRead);
    expect(brief.objectives[0]).toMatchObject({ id: 'saved-goal', grounding: 'material-grounded', sourceIds: [expect.stringMatching(/^src-/)] });
    expect(brief.materials[0]).toMatchObject({ readStatus: 'sampled', sourceCount: 2 });
    expect(brief.scope.coverage).toBe('sampled');
    expect(JSON.stringify(brief)).not.toContain('another-owner-source');
  });
});
