import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import llmService from '../../services/llmService.js';
import ragService from '../../services/ragService.js';

const config = { provider: 'openai', model: 'gpt-6-luna', endpoint: 'https://api.openai.com/v1', apiKey: 'test-not-used' };
const materials = [{ _id: 'material-1', name: 'Synthetic physics notes', type: 'text' }];
const sections = [
  { id: 'M1-S1', title: 'Net force', content: 'Net force determines acceleration.' },
  { id: 'M1-S2', title: 'Inertia', content: 'Zero net force preserves velocity.' }
].map((section, index) => ({ ...section, materialId: 'material-1', materialName: materials[0].name,
  sourceFile: 'physics.txt', materialRole: 'instructional-content', pageNumbers: [index + 1],
  chunks: [{ content: section.content, chunkIndex: index, pageNumber: index + 1 }] }));
const profile = { clusters: [{ title: 'Net force analysis', role: 'skill', sectionIds: ['M1-S1', 'M1-S1', 'foreign-section'],
  keyConcepts: ['Force vectors'], assessableSkills: ['Calculate net force'], assessmentSignals: [] }] };
const digest = { materialQuality: 'structured', recommendedObjectiveCount: 2, ignoredNoise: [],
  instructionalTopics: [{ topic: 'Velocity preservation', sourceSectionIds: ['M1-S2'], subtopics: ['Inertia'],
    teachableConcepts: ['Constant velocity'], assessableSkills: ['Explain uniform motion'], backgroundOnly: false }],
  coverageNotes: 'Cover net force and inertia.' };
const objectives = [
  { text: 'Calculate net force.', sourceSectionIds: ['M1-S1'] },
  { text: 'Explain motion with zero net force.', sourceSectionIds: ['M1-S2'] }
];
const response = value => ({ content: JSON.stringify(value), model: config.model });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}
const generate = progress => llmService.generateLearningObjectives(materials, 'First-year physics', 2, null,
  'Use short explanations.', 'Exclude friction.', 'teacher', progress);
let sendMessage;
let draft;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(llmService, 'resolveUserLLMConfig').mockResolvedValue(config);
  sendMessage = jest.fn(async prompt => response(prompt.startsWith('Analyze this deterministic') ? profile : digest));
  jest.spyOn(llmService, 'createLLMForConfig').mockImplementation(() => ({ sendMessage }));
  jest.spyOn(ragService, 'initialize').mockResolvedValue();
  jest.spyOn(ragService, 'buildLearningObjectiveInventory').mockResolvedValue({
    sections, requiredSections: sections, totalChunks: 2, promptContent: sections.map(section => section.content).join('\n'),
    conceptSectionCount: 2, assessmentSectionCount: 0, recommendedObjectiveRange: { min: 2, max: 2, suggested: 2 }
  });
  jest.spyOn(ragService, 'retrieveRelevantContent').mockResolvedValue({ chunks: [] });
  draft = jest.spyOn(llmService, 'streamCompletion').mockResolvedValue(response({ objectives }));
});
afterEach(() => jest.restoreAllMocks());

describe('independent learning-objective material preparation', () => {
  test.each(['profile', 'digest'])('starts both preparations together and waits for the slower %s before drafting', async slower => {
    const pendingProfile = deferred();
    const pendingDigest = deferred();
    const profileStarted = deferred();
    sendMessage.mockImplementation(prompt => {
      if (prompt.startsWith('Analyze this deterministic')) {
        profileStarted.resolve();
        return pendingProfile.promise;
      }
      return pendingDigest.promise;
    });
    const progress = jest.fn();
    const pending = generate(progress);
    await profileStarted.promise;
    try {
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(sendMessage.mock.calls[1][0]).toContain('Create an instructional digest');
      const faster = slower === 'profile' ? pendingDigest : pendingProfile;
      faster.resolve(response(slower === 'profile' ? digest : profile));
      await new Promise(resolve => setImmediate(resolve));
      expect(draft).not.toHaveBeenCalled();
      expect(progress.mock.calls.map(([event]) => event.status)).not.toContain('draft-started');
    } finally {
      pendingProfile.resolve(response(profile));
      pendingDigest.resolve(response(digest));
      await pending;
    }
    expect(draft).toHaveBeenCalledTimes(1);
    const prompt = draft.mock.calls[0][0].prompt;
    expect(prompt).toContain('Net force analysis');
    expect(prompt).toContain('Velocity preservation');
    expect(prompt).toContain('Use short explanations.');
    for (const [preparationPrompt, options] of sendMessage.mock.calls) {
      expect(preparationPrompt).toContain('Exclude friction.');
      expect(options.reasoning_effort).toBe('low');
    }
    expect(sendMessage.mock.calls.map(([, options]) => options.max_completion_tokens)).toEqual([1800, 2400]);
  });

  test.each(['profile', 'digest'])('a failed %s preserves the other preparation and source-grounded objectives without another preparation call', async failing => {
    sendMessage.mockImplementation(async prompt => {
      const kind = prompt.startsWith('Analyze this deterministic') ? 'profile' : 'digest';
      if (kind === failing) throw new Error('Synthetic preparation unavailable');
      return response(kind === 'profile' ? profile : digest);
    });
    const progress = jest.fn();
    const result = await generate(progress);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(draft).toHaveBeenCalledTimes(1);
    expect(result.coverageDiagnostics).toMatchObject({ requiredSectionCount: 2, coveredSectionCount: 2, repairApplied: false });
    expect(result.objectives.map(objective => objective.sourceReferences[0].materialId)).toEqual(['material-1', 'material-1']);
    if (failing === 'profile') {
      expect(result.inventoryDiagnostics.profileModelAssisted).toBe(false);
      expect(result.inventoryDiagnostics.profileClusterCount).toBe(2);
      expect(result.inventoryDiagnostics.instructionalDigest.instructionalTopics[0].topic).toBe('Velocity preservation');
    } else {
      expect(result.inventoryDiagnostics.profileModelAssisted).toBe(true);
      expect(result.inventoryDiagnostics.instructionalDigest).toBeNull();
      expect(progress.mock.calls.map(([event]) => event.status)).toContain('digest-fallback');
    }
  });

  test('keeps profile source-ID validation and deterministic coverage recovery before the independent final coverage gate', async () => {
    draft.mockResolvedValueOnce(response({ objectives: [objectives[0]] })).mockResolvedValueOnce(response({ objectives }));
    const result = await generate();
    expect(result.inventoryDiagnostics).toMatchObject({ profileModelAssisted: true, profileClusterCount: 2,
      recoveredProfileSectionIds: ['M1-S2'] });
    expect(draft.mock.calls[0][0].prompt).not.toContain('foreign-section');
    expect(draft).toHaveBeenCalledTimes(2);
    expect(draft.mock.calls[1][0].prompt).toContain('Missing required source sections:\nM1-S2');
    expect(result.coverageDiagnostics).toMatchObject({ requiredSectionCount: 2, coveredSectionCount: 2,
      missingSectionIds: [], repairApplied: true });
  });

  test('an empty inventory skips both preparation calls and drafts from cached material text', async () => {
    ragService.buildLearningObjectiveInventory.mockResolvedValue({ sections: [], requiredSections: [], promptContent: 'Cached synthetic notes.' });
    draft.mockResolvedValue(response({ objectives: [{ text: 'Explain the instructor topic.' }] }));
    const result = await generate();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(draft).toHaveBeenCalledTimes(1);
    expect(draft.mock.calls[0][0].prompt).toContain('Cached synthetic notes.');
    expect(result.inventoryDiagnostics.profileModelAssisted).toBe(false);
    expect(result.inventoryDiagnostics.instructionalDigest).toBeNull();
  });
});
