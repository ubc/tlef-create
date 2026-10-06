import { expect, test } from '@jest/globals';
import { listH5PTypeAdapters } from '../../config/h5pTypeAdapterRegistry.js';
import { createAuthoringActivityCapabilities } from '../../services/authoring/authoringActivityCapabilities.js';
import { createStudioAuthoringStrategyRegistry } from '../../services/studioAuthoringStrategies.js';
import { getStudioCatalog } from '../../services/h5pStudioCatalog.js';

const definitions = listH5PTypeAdapters();
const catalog = { types: [...new Set(definitions.map(adapter => adapter.mainLibrary))].map(library => ({
  library, machineName: library.split(' ')[0], mode: 'generate', title: library.split(' ')[0], guidance: 'Installed and available.',
  category: 'Questions & text activities'
})) };
const capabilities = createAuthoringActivityCapabilities({ catalog: () => catalog });

test('course-question capabilities derive the enabled canonical adapter and container intersection', () => {
  for (const container of ['column', 'interactive-book', 'question-set', 'standalone', 'mixed-activity']) {
    expect(capabilities.listQuestionTypes({ container }).map(type => type.questionType)).toEqual(
      definitions.filter(adapter => adapter.aiEnabled && adapter.convertible && adapter.containers.includes(container)).map(adapter => adapter.type));
  }
  expect(capabilities.resolve({ questionType: 'crossword', container: 'column' })).toMatchObject({ available: false, representation: 'course-question' });
  expect(capabilities.resolve({ questionType: 'crossword', container: 'standalone' })).toMatchObject({ available: true, contractSource: 'create-question-adapter' });
});

test('runtime availability narrows capabilities without changing or copying canonical type facts', () => {
  const first = definitions.find(adapter => adapter.aiEnabled);
  const missing = { types: catalog.types.filter(type => type.library !== first.mainLibrary) };
  expect(capabilities.resolve({ questionType: first.type, catalog: missing })).toMatchObject({ available: false, reason: expect.stringContaining('not installed') });
  const broken = { types: catalog.types.map(type => type.library === first.mainLibrary ? { ...type, mode: 'unavailable', guidance: 'A runtime asset is missing.' } : type) };
  expect(capabilities.resolve({ questionType: first.type, catalog: broken })).toMatchObject({ available: false, guidance: 'A runtime asset is missing.' });
  expect(capabilities.resolve({ questionType: 'question-set' })).toMatchObject({ available: false });
});

test('native discovery exposes template/manual/unavailable boundaries independently from CREATE Question support', () => {
  const native = { types: [
    { library: 'H5P.NewTextActivity 1.0', machineName: 'H5P.NewTextActivity', title: 'New text activity', mode: 'generate' },
    { library: 'H5P.NewMediaActivity 1.0', machineName: 'H5P.NewMediaActivity', title: 'Media activity', mode: 'template', guidance: 'Save real media first.' },
    { library: 'H5P.NewEditorActivity 1.0', machineName: 'H5P.NewEditorActivity', title: 'Editor activity', mode: 'manual', guidance: 'Use the official editor.' },
    { library: 'H5P.BrokenActivity 1.0', machineName: 'H5P.BrokenActivity', title: 'Broken activity', mode: 'unavailable', guidance: 'Missing dependency.' }
  ] };
  const result = capabilities.listNativeActivities({ catalog: native });
  expect(result.map(type => type.mode)).toEqual(['generate', 'template', 'manual', 'unavailable']);
  expect(result[0]).toMatchObject({ available: true, strategyId: 'installed-semantics', questionTypes: [], contractSource: 'installed-h5p-semantics' });
  expect(result[1]).toMatchObject({ available: true, needsTemplate: true });
  expect(result[2]).toMatchObject({ available: false });
  expect(capabilities.listQuestionTypes({ catalog: native })).toEqual([]);
});

test('registered native strategies surface through the same capability facade with no agent type changes', () => {
  const strategies = createStudioAuthoringStrategyRegistry().register('H5P.NewTextActivity', { id: 'new-text-strategy', guidance: 'Use a revealable explanation.' });
  const native = { types: [{ library: 'H5P.NewTextActivity 1.0', machineName: 'H5P.NewTextActivity', title: 'New text activity', mode: 'generate' }] };
  const facade = createAuthoringActivityCapabilities({ catalog: () => native, strategies });
  expect(facade.resolve({ library: 'H5P.NewTextActivity 1.0' })).toMatchObject({ strategyId: 'new-text-strategy', authoringGuidance: 'Use a revealable explanation.' });
  expect(() => facade.resolve({ library: 'H5P.NewTextActivity 1.0', questionType: 'multiple-choice' })).toThrow('either');
  expect(facade.resolve({ library: 'H5P.NotInstalled 1.0' })).toBeNull();
});

test('new canonical adapters enter all matching container queries without a facade or agent switch', () => {
  const extension = { type: 'synthetic-card', label: 'Synthetic Card', mainLibrary: 'H5P.SyntheticCard 1.0',
    aiEnabled: true, convertible: true, containers: ['column', 'mixed-activity'] };
  const facade = createAuthoringActivityCapabilities({ adapters: () => [...definitions, extension],
    catalog: () => ({ types: [...catalog.types, { library: extension.mainLibrary, machineName: 'H5P.SyntheticCard', mode: 'generate', title: extension.label }] }) });
  expect(facade.listQuestionTypes({ container: 'column' }).at(-1)).toMatchObject({ questionType: extension.type, available: true });
  expect(facade.listQuestionTypes({ container: 'standalone' }).some(type => type.questionType === extension.type)).toBe(false);
  expect(facade.resolve({ library: extension.mainLibrary }).questionTypes).toMatchObject([{ questionType: extension.type }]);
});

test('a healthy installed embedded library remains available through its canonical course adapter', () => {
  const installed = getStudioCatalog();
  expect(installed.libraries.get('H5P.AdvancedText 1.1').descriptor.runnable).toBe(0);
  expect(installed.types.some(type => type.library === 'H5P.AdvancedText 1.1')).toBe(false);
  expect(capabilities.resolve({ questionType: 'discussion', catalog: installed, container: 'column' }))
    .toMatchObject({ available: true, mode: 'generate', needsTemplate: false, representation: 'course-question' });
  expect(capabilities.resolve({ library: 'H5P.AdvancedText 1.1', catalog: installed })).toBeNull();
  expect(capabilities.resolve({ questionType: 'discussion', catalog: installed, container: 'question-set' }).available).toBe(false);
  expect(capabilities.listQuestionTypes({ catalog: installed, container: 'mixed-activity' }).map(type => type.questionType))
    .toEqual(definitions.filter(adapter => adapter.aiEnabled && adapter.convertible && adapter.containers.includes('mixed-activity')).map(adapter => adapter.type));
});

test('embedded course adapters still require actual runtime assets and dependencies', () => {
  const installed = getStudioCatalog(); const target = 'H5P.AdvancedText 1.1';
  for (const failure of ['asset', 'dependency']) {
    const libraries = new Map(installed.libraries); const original = libraries.get(target);
    const descriptor = { ...original.descriptor, ...(failure === 'asset'
      ? { preloadedJs: [{ path: 'test-nonexistent-runtime.js' }] }
      : { preloadedDependencies: [{ machineName: 'H5P.MissingDependency', majorVersion: 1, minorVersion: 0 }] }) };
    libraries.set(target, { ...original, descriptor });
    expect(capabilities.resolve({ questionType: 'discussion', catalog: { ...installed, libraries } }))
      .toMatchObject({ available: false, reason: expect.stringContaining(failure === 'asset' ? 'Missing runtime asset' : 'Missing installed dependency') });
  }
});

test('embedded availability cannot bypass an explicit native template, manual or unavailable gate', () => {
  const installed = getStudioCatalog();
  for (const mode of ['template', 'manual', 'unavailable']) {
    const explicit = { ...installed, types: [...installed.types, { library: 'H5P.AdvancedText 1.1',
      machineName: 'H5P.AdvancedText', title: 'Text', mode, guidance: `Explicit ${mode} gate.` }] };
    expect(capabilities.resolve({ questionType: 'discussion', catalog: explicit }))
      .toMatchObject({ available: false, reason: `Explicit ${mode} gate.` });
  }
});
