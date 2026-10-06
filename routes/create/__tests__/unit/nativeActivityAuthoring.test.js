import { describe, expect, jest, test } from '@jest/globals';
import { createNativeActivityAuthoring, proposeNativeActivityPlan, proposeNativeActivityRevision,
  validateNativePlanLibrary, validateNativeSourceContract, NATIVE_REVIEW_WORKFLOW_VERSION } from '../../services/authoring/nativeActivityAuthoring.js';
import { getStudioCatalog, buildStudioCatalog } from '../../services/h5pStudioCatalog.js';
import { QUESTION_REVIEW_POLICY_VERSION } from '../../services/questionReviewContract.js';
import { digest } from '../../services/authoring/authoringContracts.js';

const library = 'H5P.Chart 1.2';
const passed = { contentIsValid: true, answerIsCorrect: true, rubricIsAppropriate: true,
  feedbackIsConsistent: true, followsInstructorRequest: true, evidenceIsSufficient: true, issues: [], calculations: [] };
const document = { library, metadata: { title: 'Water use' }, parameters: { type: 'bar', data: [{ label: 'Repair leaks', value: 20 }] } };
const draftResponse = { content: JSON.stringify({ document }), model: 'test-draft-model' };
const reviewResponse = { content: JSON.stringify(passed), model: 'test-review-model' };
const clone = value => structuredClone(value);

async function harness() {
  const session = { _id: '111111111111111111111111', owner: '222222222222222222222222', courseId: '333333333333333333333333',
    instructions: 'Create a bar chart from the supplied survey, with descriptive labels.',
    materialIds: ['444444444444444444444444'], objectiveIds: ['555555555555555555555555'] };
  let context = { course: { _id: session.courseId }, materials: [{ _id: session.materialIds[0], name: 'Water survey',
    processingStatus: 'completed', updatedAt: '2026-10-01T00:00:00.000Z' }],
    objectives: [{ _id: session.objectiveIds[0], text: 'Interpret survey data.', updatedAt: '2026-10-01T00:00:00.000Z' }] };
  const catalog = getStudioCatalog();
  const resolveContext = jest.fn(async () => clone(context));
  const plan = await proposeNativeActivityPlan({ session, library, latestRequest: 'Use the survey values.', revision: 3, catalog, resolveContext });
  session.nativePlan = { ...plan, status: 'generating' };
  const run = { _id: '666666666666666666666666', owner: session.owner, sessionId: session._id, leaseToken: 'test-lease' };
  const checkpoints = []; const paid = [];
  const checkpoint = jest.fn(async (name, result) => checkpoints.push({ name, result: clone(result) }));
  const persistPaid = jest.fn(async ({ state, checkpoint }) => paid.push({ name: checkpoint, state: clone(state) }));
  const buildContext = jest.fn(async () => ({ context: 'The survey recorded 20 units of saving from repairing leaks.',
    sources: [{ materialId: session.materialIds[0], materialName: 'Water survey', excerpt: 'Repairing leaks saved 20 units.' }] }));
  const complete = jest.fn(async options => clone(options.prompt === 'Generate the native chart.' ? draftResponse : reviewResponse));
  const generate = jest.fn(async ({ complete }) => JSON.parse((await complete({ prompt: 'Generate the native chart.' })).content));
  const operation = jest.fn(async (_kind, _title, work) => work());
  const dependencies = { resolveContext, buildContext, complete, generate, persistPaid, operation };
  const author = createNativeActivityAuthoring(dependencies);
  const args = { session, run, catalog, guard: jest.fn(async () => {}), checkpoint };
  return { session, run, plan, catalog, args, checkpoints, paid, complete, generate, buildContext, resolveContext, author, dependencies,
    setContext(value) { context = clone(value); }, context: () => clone(context) };
}

describe('native authoring capability and approved-source contract', () => {
  test('the real installed catalog resolves a directly generatable activity with its actual label', () => {
    expect(validateNativePlanLibrary(library, getStudioCatalog())).toMatchObject({ representation: 'native-h5p', library, label: 'Chart', mode: 'generate' });
  });
  test.each(['H5P.DoesNotExist 1.0', 'H5P.ImageHotspots 1.10', 'H5P.AdvancedBlanks 1.4'])(
    'refuses unavailable, template or manual library %s before proposing paid work', target => {
      expect(() => validateNativePlanLibrary(target, getStudioCatalog())).toThrow(expect.objectContaining({ code: 'AUTHORING_NATIVE_TYPE' }));
    });
  test('the catalog gates an installed descriptor whose declared runtime asset is missing', () => {
    const libraries = new Map(getStudioCatalog().libraries);
    const installed = libraries.get(library);
    libraries.set(library, { ...installed, descriptor: { ...installed.descriptor, preloadedJs: [{ path: 'test-nonexistent-runtime.js' }] } });
    const catalog = { libraries, types: buildStudioCatalog(libraries) };
    expect(catalog.types.find(type => type.library === library).mode).toBe('unavailable');
    expect(() => validateNativePlanLibrary(library, catalog)).toThrow(expect.objectContaining({ code: 'AUTHORING_NATIVE_TYPE' }));
  });
  test('a proposed plan records the selected source signature and needs approval', async () => {
    const h = await harness();
    expect(h.plan).toMatchObject({ status: 'awaiting_approval', revision: 3, title: 'Chart', materialIds: h.session.materialIds, objectiveIds: h.session.objectiveIds });
    expect(h.plan.sourceSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(h.plan).toMatchObject({ courseId: h.session.courseId, reviewPolicyVersion: QUESTION_REVIEW_POLICY_VERSION });
    expect(h.plan.requirementSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(h.resolveContext).toHaveBeenCalledWith(h.session.owner, { courseId: h.session.courseId, materialIds: h.session.materialIds, objectiveIds: h.session.objectiveIds });
  });
  test.each(['material update', 'objective change', 'processing failure', 'fabricated signature'])(
    '%s blocks generation before any model request', async change => {
      const h = await harness(); const context = h.context();
      if (change === 'material update') context.materials[0].updatedAt = '2026-10-02T00:00:00.000Z';
      if (change === 'objective change') context.objectives[0].text = 'An unrelated objective.';
      if (change === 'processing failure') context.materials[0].processingStatus = 'failed';
      if (change === 'fabricated signature') h.session.nativePlan.sourceSignature = 'not-a-source-signature';
      h.setContext(context);
      await expect(h.author(h.args)).rejects.toMatchObject({ code: 'AUTHORING_SOURCE_CHANGED' });
      expect(h.complete).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
    });
  test.each(['teaching requirements', 'material scope', 'objective scope', 'course', 'policy', 'unsigned plan'])(
    'the initial approved plan cannot be relabeled with changed %s before generation', async changed => {
      const h = await harness();
      if (changed === 'teaching requirements') h.session.teachingRequirements = { fields: { audience: { value: 'Advanced researchers' } } };
      if (changed === 'material scope') h.session.materialIds = [];
      if (changed === 'objective scope') h.session.objectiveIds = [];
      if (changed === 'course') h.session.courseId = '999999999999999999999999';
      if (changed === 'policy') h.session.nativePlan.reviewPolicyVersion = 'old-policy';
      if (changed === 'unsigned plan') delete h.session.nativePlan.requirementSignature;
      await expect(h.author(h.args)).rejects.toMatchObject({ code: 'AUTHORING_CONTRACT_CHANGED' });
      expect(h.complete).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
    });
});

async function revisionHarness() {
  const h = await harness();
  h.session.currentVersionId = '777777777777777777777777';
  const current = { _id: h.session.currentVersionId, sessionId: h.session._id, owner: h.session.owner, contentId: 'owned-chart' };
  let template = { library, params: { params: clone(document.parameters), metadata: clone(document.metadata) } };
  const plan = await proposeNativeActivityRevision({ session: h.session, current, template,
    latestRequest: 'Revise the labels to be clearer and preserve the survey values.', catalog: h.catalog, resolveContext: h.resolveContext });
  const resolveTemplate = jest.fn(async () => clone(template));
  const author = createNativeActivityAuthoring({ ...h.dependencies, resolveTemplate });
  const args = { ...h.args, plan };
  return { ...h, current, plan, author, args, resolveTemplate, template: () => clone(template),
    setTemplate(value) { template = clone(value); } };
}

describe('owned native revisions and saved candidate contracts', () => {
  test('the revision passes the actual owned template into the same whole-activity check and receipt pipeline', async () => {
    const h = await revisionHarness(); const output = await h.author(h.args);
    expect(h.generate.mock.calls[0][0]).toMatchObject({ template: h.template(), templateContentId: h.current.contentId,
      instructions: expect.stringContaining(h.plan.latestRequest) });
    expect(output.nativeSourceContract).toMatchObject({ kind: 'revision', baseVersionId: h.current._id,
      templateContentId: h.current.contentId, reviewPolicyVersion: QUESTION_REVIEW_POLICY_VERSION });
    expect(output.reviewSummary.policyVersion).toBe(QUESTION_REVIEW_POLICY_VERSION);
    expect(h.complete.mock.calls[1][0].prompt).toContain('ENTIRE existing activity document');
    expect(h.complete.mock.calls[1][0].prompt).toContain('native_revision_candidate_review');
    expect(h.complete.mock.calls[1][0].prompt).toContain('The instructor explicitly requested this revision');
    expect(h.complete.mock.calls[1][0].prompt).toContain(h.plan.latestRequest);
    expect(h.run.result.nativeActivity.plan).toEqual(h.plan);
    expect(h.paid.map(item => item.name)).toEqual(['native_draft_model_saved', 'native_review_model_saved']);
    expect(await h.author(h.args)).toEqual(output);
    expect(h.complete).toHaveBeenCalledTimes(2); expect(h.generate).toHaveBeenCalledTimes(1);
  });

  test.each(['current base', 'template content', 'selected materials', 'source version', 'review policy'])(
    'completed revision reuse rejects a changed %s without purchasing another response', async changed => {
      const h = await revisionHarness(); await h.author(h.args);
      if (changed === 'current base') h.session.currentVersionId = '888888888888888888888888';
      if (changed === 'template content') { const template = h.template(); template.params.params.data[0].value = 100; h.setTemplate(template); }
      if (changed === 'selected materials') h.session.materialIds = [];
      if (changed === 'source version') { const context = h.context(); context.materials[0].updatedAt = '2026-10-02T00:00:00.000Z'; h.setContext(context); }
      if (changed === 'review policy') h.plan.reviewPolicyVersion = 'old-policy';
      await expect(h.author(h.args)).rejects.toMatchObject({ code: changed === 'source version' ? 'AUTHORING_SOURCE_CHANGED' : 'AUTHORING_CONTRACT_CHANGED' });
      expect(h.complete).toHaveBeenCalledTimes(2); expect(h.generate).toHaveBeenCalledTimes(1);
    });

  test('an initial generated candidate contract rechecks its actual sources and current policy at later boundaries', async () => {
    const h = await harness(); const output = await h.author(h.args);
    const args = { session: h.session, contract: output.nativeSourceContract, resolveContext: h.resolveContext };
    await expect(validateNativeSourceContract(args)).resolves.toMatchObject({ context: h.context() });
    const context = h.context(); context.objectives[0].text = 'A replacement goal.'; h.setContext(context);
    await expect(validateNativeSourceContract(args)).rejects.toMatchObject({ code: 'AUTHORING_SOURCE_CHANGED' });
    await expect(validateNativeSourceContract({ ...args, contract: { ...args.contract, reviewPolicyVersion: 'old-policy' } }))
      .rejects.toMatchObject({ code: 'AUTHORING_CONTRACT_CHANGED' });
    expect(h.complete).toHaveBeenCalledTimes(2);
  });

  test('template-only types require a real supplied template and manual types cannot use that exception', async () => {
    const h = await revisionHarness();
    const template = { library: 'H5P.ImageHotspots 1.10', params: { params: { image: { path: 'images/owned.png', mime: 'image/png' } }, metadata: { title: 'Owned diagram' } } };
    expect(validateNativePlanLibrary(template.library, h.catalog, { template })).toMatchObject({ mode: 'template' });
    await expect(proposeNativeActivityRevision({ session: h.session, current: h.current, template, latestRequest: 'Clarify the labels on this existing diagram.',
      catalog: h.catalog, resolveContext: h.resolveContext })).resolves.toMatchObject({ templateContentId: h.current.contentId });
    expect(() => validateNativePlanLibrary('H5P.AdvancedBlanks 1.4', h.catalog, { template: { ...template, library: 'H5P.AdvancedBlanks 1.4' } }))
      .toThrow(expect.objectContaining({ code: 'AUTHORING_NATIVE_TYPE' }));
    await expect(proposeNativeActivityRevision({ session: h.session, current: { ...h.current, owner: '888888888888888888888888' },
      template: h.template(), latestRequest: 'Revise the labels.', catalog: h.catalog, resolveContext: h.resolveContext }))
      .rejects.toMatchObject({ code: 'AUTHORING_CONTRACT_CHANGED' });
  });
});

describe('native paid response and semantic review lifecycle', () => {
  test('approved initial review preserves the full brief and identifies the first-plan request as already fulfilled', async () => {
    const h = await harness();
    h.session.nativePlan.instructions += '\nFirst provide a confirmable activity plan. Do not invent survey values or add scored questions.';
    await h.author(h.args);
    const reviewPrompt = h.complete.mock.calls[1][0].prompt;
    expect(reviewPrompt).toContain('approved_native_plan_candidate_review');
    expect(reviewPrompt).toContain('explicitly chose Accept plan & generate');
    expect(reviewPrompt).toContain('already been fulfilled');
    expect(reviewPrompt).toContain('First provide a confirmable activity plan. Do not invent survey values or add scored questions.');
    expect(reviewPrompt).toContain('ENTIRE existing activity document');
  });

  test('an explicit retry of an older workflow-only mismatch rechecks the saved draft using actual approval context', async () => {
    const h = await harness(); await h.author(h.args);
    const state = clone(h.run.result.nativeActivity); state.phase = 'failed'; delete state.output; delete state.reviewContextVersion;
    state.failure = { code: 'QUESTION_QUALITY_REVIEW', reason: 'INSTRUCTION_MISMATCH' };
    state.receipts['review:0'].response = { content: JSON.stringify({ ...passed, followsInstructorRequest: false,
      issues: ['The native parameters do not include the first confirmable plan.'] }) };
    const result = await h.author({ ...h.args, resumeState: state, explicitResume: true });
    expect(result.reviewSummary.checks.followsInstructorRequest).toBe(true);
    expect(h.complete).toHaveBeenCalledTimes(3);
    expect(h.complete.mock.calls.filter(([options]) => options.prompt === 'Generate the native chart.')).toHaveLength(1);
    expect(h.run.result.nativeActivity.reviewContextVersion).toBe(NATIVE_REVIEW_WORKFLOW_VERSION);
  });

  test('a current workflow instruction mismatch still requires a new checked draft', async () => {
    const h = await harness(); let reviews = 0;
    h.complete.mockImplementation(async options => options.prompt === 'Generate the native chart.' ? clone(draftResponse)
      : { content: JSON.stringify(++reviews === 1 ? { ...passed, followsInstructorRequest: false,
        issues: ['The approved chart title is wrong.'] } : passed) });
    await expect(h.author(h.args)).rejects.toMatchObject({ qualityFailureReason: 'INSTRUCTION_MISMATCH' });
    expect(h.run.result.nativeActivity.reviewContextVersion).toBe(NATIVE_REVIEW_WORKFLOW_VERSION);
    await expect(h.author({ ...h.args, explicitResume: true })).resolves.toMatchObject({ reviewSummary: { kind: 'semantic' } });
    expect(h.complete.mock.calls.filter(([options]) => options.prompt === 'Generate the native chart.')).toHaveLength(2);
    expect(h.complete).toHaveBeenCalledTimes(4);
  });

  test('creates a whole-activity checked proposal using owned evidence and saves both raw responses first', async () => {
    const h = await harness(); const output = await h.author(h.args);
    expect(output).toMatchObject({ document, representation: 'native-fork', reviewSummary: { kind: 'semantic', policyVersion: QUESTION_REVIEW_POLICY_VERSION,
      mediaInspection: 'not-performed' }, sourceReferences: [{ materialId: h.session.materialIds[0] }] });
    expect(h.complete).toHaveBeenCalledTimes(2);
    expect(h.complete.mock.calls[1][0].prompt).toContain('ENTIRE existing activity document');
    expect(h.complete.mock.calls[1][0].prompt).toContain('Repairing leaks saved 20 units.');
    expect(h.paid.map(item => item.name)).toEqual(['native_draft_model_saved', 'native_review_model_saved']);
    expect(h.paid[0].state.receipts['draft:0'].response).toEqual(draftResponse);
    expect(h.run.result.nativeActivity.phase).toBe('completed');
  });
  test('saved raw responses replay without another draft or review purchase', async () => {
    const h = await harness(); const first = await h.author(h.args);
    const state = clone(h.run.result.nativeActivity); state.phase = 'ready'; delete state.output;
    expect(await h.author({ ...h.args, resumeState: state })).toEqual(first);
    expect(h.complete).toHaveBeenCalledTimes(2); expect(h.buildContext).toHaveBeenCalledTimes(1);
  });
  test('completed replay rechecks source coherence, then returns without regeneration', async () => {
    const h = await harness(); const first = await h.author(h.args);
    expect(await h.author(h.args)).toEqual(first);
    expect(h.generate).toHaveBeenCalledTimes(1); expect(h.complete).toHaveBeenCalledTimes(2);
    const context = h.context(); context.objectives[0].text = 'A changed objective.'; h.setContext(context);
    await expect(h.author(h.args)).rejects.toMatchObject({ code: 'AUTHORING_SOURCE_CHANGED' });
    expect(h.complete).toHaveBeenCalledTimes(2);
  });
  test('a response with an unknown outcome is not automatically repurchased', async () => {
    const h = await harness(); await h.author(h.args);
    const state = clone(h.run.result.nativeActivity); state.phase = 'ready'; delete state.output;
    state.receipts['draft:0'] = { phase: 'pending', promptHash: state.receipts['draft:0'].promptHash };
    await expect(h.author({ ...h.args, resumeState: state })).rejects.toMatchObject({ code: 'AUTHORING_MODEL_UNCERTAIN' });
    expect(h.complete).toHaveBeenCalledTimes(2);
  });
  test('an explicitly resumed unknown review keeps the saved draft and buys only the missing review', async () => {
    const h = await harness(); await h.author(h.args);
    const state = clone(h.run.result.nativeActivity); state.phase = 'ready'; delete state.output;
    state.receipts['review:0'] = { phase: 'pending', promptHash: state.receipts['review:0'].promptHash };
    await expect(h.author({ ...h.args, resumeState: state })).rejects.toMatchObject({ code: 'AUTHORING_MODEL_UNCERTAIN' });
    await expect(h.author({ ...h.args, explicitResume: true })).resolves.toMatchObject({ reviewSummary: { kind: 'semantic' } });
    expect(h.complete).toHaveBeenCalledTimes(3);
    expect(h.complete.mock.calls.filter(([options]) => options.prompt === 'Generate the native chart.')).toHaveLength(1);
  });
  test('a failed semantic check produces no candidate output and does not automatically retry', async () => {
    const h = await harness(); h.complete.mockImplementation(async options => options.prompt === 'Generate the native chart.' ? clone(draftResponse)
      : { content: JSON.stringify({ ...passed, answerIsCorrect: false, issues: ['The chart does not match the source values.'] }) });
    await expect(h.author(h.args)).rejects.toMatchObject({ code: 'QUESTION_QUALITY_REVIEW', qualityFailureReason: 'ANSWER_INVALID' });
    expect(h.run.result.nativeActivity.output).toBeUndefined();
    expect(h.run.result.nativeActivity.failure).toMatchObject({ reason: 'ANSWER_INVALID', message: expect.stringContaining('Activity check stopped:') });
    expect(h.run.result.nativeActivity.failure.message).not.toContain('model configuration');
    await expect(h.author(h.args)).rejects.toMatchObject({ code: 'AUTHORING_NATIVE_RETRY' });
    expect(h.complete).toHaveBeenCalledTimes(2);
  });
  test('an unknown native draft error keeps its details out of the saved public failure', async () => {
    const h = await harness(); h.generate.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAILS'));
    await expect(h.author(h.args)).rejects.toThrow('PRIVATE_PROVIDER_DETAILS');
    expect(h.run.result.nativeActivity.failure).toMatchObject({ code: 'AUTHORING_NATIVE_FAILED',
      message: 'The native activity could not finish. Saved work is preserved.' });
    expect(JSON.stringify(h.run.result.nativeActivity.failure)).not.toContain('PRIVATE_PROVIDER_DETAILS');
  });
  test('insufficient evidence preserves paid receipts and cannot repurchase the same unsupported draft on resume', async () => {
    const h = await harness(); h.complete.mockImplementation(async options => options.prompt === 'Generate the native chart.' ? clone(draftResponse)
      : { content: JSON.stringify({ ...passed, evidenceIsSufficient: false, issues: ['The required survey is not described by the excerpts.'] }) });
    await expect(h.author(h.args)).rejects.toMatchObject({ qualityFailureReason: 'EVIDENCE_INSUFFICIENT' });
    await expect(h.author({ ...h.args, explicitResume: true })).rejects.toMatchObject({ qualityFailureReason: 'EVIDENCE_INSUFFICIENT' });
    expect(h.complete).toHaveBeenCalledTimes(2); expect(h.run.result.nativeActivity.output).toBeUndefined();
  });
  test('explicit retry of an unavailable reviewer keeps the checked draft raw response', async () => {
    const h = await harness(); let reviewCalls = 0;
    h.complete.mockImplementation(async options => {
      if (options.prompt === 'Generate the native chart.') return clone(draftResponse);
      if (++reviewCalls === 1) throw new Error('Private transport details');
      return clone(reviewResponse);
    });
    await expect(h.author(h.args)).rejects.toMatchObject({ qualityFailureReason: 'REVIEW_UNAVAILABLE' });
    await expect(h.author({ ...h.args, explicitResume: true })).resolves.toMatchObject({ reviewSummary: { kind: 'semantic' } });
    expect(h.complete).toHaveBeenCalledTimes(3);
    expect(h.complete.mock.calls.filter(([options]) => options.prompt === 'Generate the native chart.')).toHaveLength(1);
  });
  test('returned raw output is saved despite cancellation; explicit resume reuses it without buying another draft', async () => {
    const h = await harness(); const controller = new AbortController(); const stopped = new Error('Stopped after paid response');
    h.complete.mockImplementationOnce(async () => { controller.abort(stopped); return clone(draftResponse); });
    await expect(h.author({ ...h.args, signal: controller.signal, guard: async () => controller.signal.throwIfAborted() })).rejects.toBe(stopped);
    expect(h.paid[0].state.receipts['draft:0']).toMatchObject({ phase: 'saved', response: draftResponse });
    expect(h.run.result.nativeActivity.output).toBeUndefined();
    await expect(h.author({ ...h.args, explicitResume: true })).resolves.toMatchObject({ document });
    expect(h.complete).toHaveBeenCalledTimes(2);
    expect(h.complete.mock.calls.filter(([options]) => options.prompt === 'Generate the native chart.')).toHaveLength(1);
  });
  test('an older review-contract receipt or completed summary cannot bypass the current policy', async () => {
    const h = await harness(); await h.author(h.args);
    const older = clone(h.run.result.nativeActivity);
    older.inputHash = digest({ plan: h.session.nativePlan, sessionId: h.session._id });
    await expect(h.author({ ...h.args, resumeState: older })).rejects.toMatchObject({ code: 'AUTHORING_CONTRACT_CHANGED' });
    const wrongSummary = clone(h.run.result.nativeActivity); wrongSummary.output.reviewSummary.policyVersion = 'old-policy';
    await expect(h.author({ ...h.args, resumeState: wrongSummary })).rejects.toMatchObject({ code: 'AUTHORING_CONTRACT_CHANGED' });
    expect(h.complete).toHaveBeenCalledTimes(2);
  });
});
