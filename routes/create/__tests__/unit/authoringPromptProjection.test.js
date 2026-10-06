import { expect, test } from '@jest/globals';
import { AGENT_PROMPT_PROJECTION_LIMITS, authoringPromptSourceVersions, projectAuthoringPromptContext } from '../../services/authoring/authoringPromptProjection.js';
import { authoringScopeHash, mergeAuthoringTaskContext } from '../../services/authoring/authoringTaskContext.js';

const owner = '111111111111111111111111';
const materialId = '222222222222222222222222';
const session = () => ({ _id: '333333333333333333333333', owner, courseId: '444444444444444444444444',
  contextCourse: false, materialIds: [materialId], objectiveIds: [], teachingRequirements: { fields: {} } });
const read = (s, index = 0, extra = {}) => ({ tool: 'read_material', scopeHash: authoringScopeHash(s), arguments: { materialId, offset: index * 6000 },
  result: { material: { id: materialId, name: 'Synthetic source', sourceVersion: '2026-10-03T00:00:00.000Z' },
    offset: index * 6000, text: (`SOURCE_${index}_START `).padEnd(5980, 'x') + ' EXACT_END_OF_SOURCE',
    nextOffset: (index + 1) * 6000, totalCharacters: 200000, summary: 'Read an authorized source range.', ...extra } });
const project = (s, observations, extra = {}) => projectAuthoringPromptContext({ session: s, state: { observations },
  sourceVersions: authoringPromptSourceVersions(observations), ...extra });
const remember = (s, observations) => mergeAuthoringTaskContext(null, s, { _id: '555555555555555555555555' }, { observations });
const freeze = object => { Object.freeze(object); for (const value of Object.values(object)) if (value && typeof value === 'object') freeze(value); return object; };

test('the newest read occurs once with its exact tail, actual read range and next page even after a check', () => {
  const s = session(); const reading = read(s);
  const check = { tool: 'check_requirements', scopeHash: authoringScopeHash(s), arguments: {},
    result: { fields: { questionCount: 15 }, countIssue: null, summary: 'Checked the confirmed count.' } };
  s.taskContext = remember(s, [reading]);
  const result = project(s, [reading, check]);
  expect(result.pastResults.observations).toEqual([]);
  expect(JSON.stringify(result).split('SOURCE_0_START').length - 1).toBe(1);
  expect(result.observations[0].result).toMatchObject({ text: reading.result.text, offset: 0,
    observedEnd: reading.result.text.length, nextOffset: 6000, totalCharacters: 200000, material: reading.result.material });
  expect(result.observations[1].result).toEqual(check.result);
});

test('both pages of a short material retain their complete facts after a check when the packet fits', () => {
  const s = session(); const first = read(s, 0, { text: 'FIRST_PAGE_END_FACT'.padStart(6000, 'x'), totalCharacters: 7220 });
  const second = read(s, 1, { text: 'SECOND_PAGE_END_FACT'.padStart(1220, 'y'), nextOffset: null, totalCharacters: 7220 });
  const check = { tool: 'check_requirements', scopeHash: authoringScopeHash(s), arguments: {},
    result: { fields: { questionCount: 15 }, countIssue: null, summary: 'Checked the confirmed count.' } };
  const observations = [first, second, check];
  s.taskContext = remember(s, observations);
  const result = project(s, observations);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(AGENT_PROMPT_PROJECTION_LIMITS.characters);
  expect(result.pastResults.observations).toEqual([]);
  expect(result.observations[0].result.text).toBe(first.result.text);
  expect(result.observations[1].result.text).toBe(second.result.text);
  expect(result.observations.slice(0, 2).some(row => row.result.excerptTruncated)).toBe(false);
  expect(result.observations[0].result.observedEnd).toBe(6000);
  expect(result.observations[1].result.observedEnd).toBe(7220);
  expect(result.observations[1].result.nextOffset).toBeNull();
  expect(JSON.stringify(result).split('FIRST_PAGE_END_FACT').length - 1).toBe(1);
  expect(JSON.stringify(result).split('SECOND_PAGE_END_FACT').length - 1).toBe(1);
});

test('model projection does not alter durable observations, confirmed fields or paging receipts', () => {
  const s = session(); const observations = Array.from({ length: 31 }, (_, index) => read(s, index));
  s.taskContext = remember(s, observations);
  const original = structuredClone({ s, observations });
  freeze(s); freeze(observations);
  const result = project(s, observations);
  expect({ s, observations }).toEqual(original);
  expect(result.observations.at(-1).result.text).toBe(observations.at(-1).result.text);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(AGENT_PROMPT_PROJECTION_LIMITS.characters);
  expect(result.observations.some(row => row.result.excerptTruncated && row.result.text === '')).toBe(true);
  for (const row of result.observations) {
    expect(row.result).toMatchObject({ offset: row.arguments.offset, nextOffset: row.arguments.offset + 6000,
      observedEnd: row.arguments.offset + read(s).result.text.length, material: { sourceVersion: '2026-10-03T00:00:00.000Z' } });
  }
});

test('a freshly invalidated source version cannot reenter through the raw saved state', () => {
  const s = session(); const old = read(s);
  s.taskContext = remember(s, [old]);
  const result = project(s, [old], { sourceVersions: new Set() });
  expect(result.observations).toEqual([]);
  expect(result.pastResults.observations).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('SOURCE_0_START');
});

test('a changed scope hides old text and pending pointers even if its version was previously validated', () => {
  const s = session(); const old = read(s); const sourceVersions = authoringPromptSourceVersions([old]);
  s.taskContext = remember(s, [old]);
  s.teachingRequirements.fields.exclusions = { value: 'Exclude the first chapter.' };
  const result = project(s, [old], { sourceVersions });
  expect(result.observations).toEqual([]);
  expect(result.pastResults.observations).toEqual([]);
  expect(result.pastResults.pending).toEqual([]);
});

test('verified historical reading survives without a current duplicate and stays explicitly partial', () => {
  const s = session(); s.taskContext = remember(s, [read(s)]);
  const result = projectAuthoringPromptContext({ session: s, state: { observations: [] } });
  expect(result.pastResults.observations).toHaveLength(1);
  expect(result.pastResults.observations[0].data.excerpt.length).toBe(800);
  expect(result.pastResults.observations[0].provenance[0]).toMatchObject({ start: 0, sourceVersion: '2026-10-03T00:00:00.000Z' });
  expect(result.pastResults.pending[0].arguments).toEqual({ materialId, offset: 6000 });
  expect(result.notice).toContain('exact text is needed');
});

test('source versions are part of deduplication so distinct validated revisions are not conflated', () => {
  const s = session(); const first = read(s); const changed = read(s, 0,
    { material: { ...first.result.material, sourceVersion: '2026-10-03T01:00:00.000Z' }, text: 'UPDATED_SOURCE' });
  const result = project(s, [first, changed]);
  expect(result.observations).toHaveLength(2);
  expect(result.observations[1].result.text).toBe('UPDATED_SOURCE');
});

test('the newest ready check and final diagnostic survive pressure without widening checked arguments', () => {
  const s = session(); const checks = [
    { tool: 'check_requirements', arguments: {}, result: { fields: { questionCount: 15, exclusions: 'Keep all topics except calculus.' }, countIssue: null } },
    { tool: 'check_question_revision', arguments: { questionIndices: [2] }, result: { ready: true, revisionCount: 1 } },
    { tool: 'validate_final_decision', arguments: { questionIndices: [2], scope: 'all' },
      result: { ready: false, diagnostic: { code: 'AUTHORING_FINAL_DECISION_INVALID', message: 'Use either all or indices.' } } }
  ].map(row => ({ ...row, scopeHash: authoringScopeHash(s) }));
  const repeatedChecks = Array.from({ length: 8 }, () => checks[1]);
  const result = project(s, [...Array.from({ length: 26 }, (_, index) => read(s, index)), ...repeatedChecks, ...checks]);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(AGENT_PROMPT_PROJECTION_LIMITS.characters);
  for (const check of checks) expect(result.observations).toContainEqual(check);
  expect(result.observations.filter(row => row.tool === 'check_question_revision')).toHaveLength(1);
});

test('a partial saved material listing is deduplicated when the full current listing covers its references', () => {
  const s = session(); const materials = Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1).padStart(24, '0'), name: `Material ${i}`, sourceVersion: '2026-10-03T00:00:00.000Z' }));
  s.contextCourse = true;
  const listed = { tool: 'list_materials', scopeHash: authoringScopeHash(s), arguments: {}, result: { materials, nextOffset: 20 } };
  s.taskContext = remember(s, [listed]);
  const result = project(s, [listed]);
  expect(result.pastResults.observations).toEqual([]);
  expect(result.observations[0].result.materials).toEqual(materials);
  expect(result.observations[0].result.nextOffset).toBe(20);
});

test('selected-only scope rejects a historical reference outside its selected IDs', () => {
  const s = session(); s.taskContext = remember(s, [read(s)]);
  s.taskContext.observations[0].provenance[0].id = '999999999999999999999999';
  expect(projectAuthoringPromptContext({ session: s, state: { observations: [] } }).pastResults.observations).toEqual([]);
});

test('a maximum-size objective page keeps every exact ID and its next page while marking trimmed text', () => {
  const s = session(); s.contextCourse = true;
  const objectives = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1).padStart(24, '0'),
    quizId: '666666666666666666666666', sourceVersion: '2026-10-03T00:00:00.000Z', text: 't'.repeat(1000),
    subpoints: Array.from({ length: 12 }, () => 's'.repeat(400)) }));
  const page = { tool: 'read_objectives', arguments: { offset: 0, limit: 20 }, scopeHash: authoringScopeHash(s),
    result: { objectives, nextOffset: 20, summary: 'Read 20 authorized objectives.' } };
  const count = { tool: 'check_requirements', arguments: {}, scopeHash: page.scopeHash,
    result: { fields: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`constraint${i}`, 'c'.repeat(1000)])) } };
  const result = project(s, [page, count]);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(AGENT_PROMPT_PROJECTION_LIMITS.characters);
  expect(result.observations[0].result.objectives.map(objective => objective.id)).toEqual(objectives.map(objective => objective.id));
  expect(result.observations[0].result.nextOffset).toBe(20);
  expect(result.observations[0].result.objectives.every(objective => objective.textTruncated)).toBe(true);
  expect(result.observations[1]).toEqual(count);
});

test('capability pressure trims descriptions without changing availability or template gates', () => {
  const s = session(); const scopeHash = authoringScopeHash(s);
  const catalogue = { tool: 'list_activity_types', arguments: { representation: 'native-h5p' }, scopeHash,
    result: { types: Array.from({ length: 20 }, (_, i) => ({ library: `H5P.Synthetic${i} 1.0`, mode: i ? 'template' : 'generate',
      available: true, needsTemplate: i !== 0, guidance: 'g'.repeat(2000), authoringGuidance: 'a'.repeat(2000) })), nextOffset: 20 } };
  const check = { tool: 'check_requirements', arguments: {}, scopeHash,
    result: { fields: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`constraint${i}`, 'c'.repeat(1000)])) } };
  const revised = { tool: 'check_question_revision', arguments: { objectiveChanges: { authorizationQuote: 'q'.repeat(3500) } },
    scopeHash, result: { ready: false, diagnostic: { code: 'QUESTION_COVERAGE_CONFLICT', message: 'Keep the objective coverage.' } } };
  const invalid = { tool: 'validate_final_decision', arguments: revised.arguments, scopeHash,
    result: { ready: false, diagnostic: { code: 'AUTHORING_FINAL_DECISION_INVALID', message: 'Keep these exact arguments.' } } };
  const result = project(s, [catalogue, check, revised, invalid]);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(AGENT_PROMPT_PROJECTION_LIMITS.characters);
  expect(result.observations[0].result.nextOffset).toBe(20);
  expect(result.observations[0].result.types.map(({ library, mode, available, needsTemplate }) => ({ library, mode, available, needsTemplate })))
    .toEqual(catalogue.result.types.map(({ library, mode, available, needsTemplate }) => ({ library, mode, available, needsTemplate })));
  expect(result.observations.slice(1)).toEqual([check, revised, invalid]);
});

test('an oversized protected diagnostic fails locally rather than silently losing its constraints', () => {
  const s = session(); const diagnostic = { tool: 'check_requirements', arguments: {}, scopeHash: authoringScopeHash(s),
    result: { fields: { mustCover: 'x'.repeat(AGENT_PROMPT_PROJECTION_LIMITS.characters) } } };
  expect(() => project(s, [diagnostic])).toThrow(expect.objectContaining({ code: 'AUTHORING_PROMPT_CONTEXT' }));
  expect(diagnostic.result.fields.mustCover.length).toBe(AGENT_PROMPT_PROJECTION_LIMITS.characters);
});
