import { expect, test } from '@jest/globals';
import { getStudioCatalog } from '../../services/h5pStudioCatalog.js';
import { documentationOutputSchema } from '../../services/studioDocumentationContract.js';
import { buildStudioJSONContract } from '../../services/h5pStudioSemantics.js';
import { createStudioAuthoringStrategyRegistry, semanticsAuthoringStrategy, StudioAuthoringStrategyRegistry } from '../../services/studioAuthoringStrategies.js';

const syntheticLibrary = 'H5P.SyntheticCard 1.0';
const libraries = new Map([[syntheticLibrary, { library: syntheticLibrary, descriptor: {}, semantics: [
  { name: 'prompt', type: 'text' }, { name: 'answer', type: 'text' }, { name: 'showFeedback', type: 'boolean', default: true }
] }]]);

test('an unregistered new type inherits its installed semantics without editing a type switch', () => {
  const registry = createStudioAuthoringStrategyRegistry();
  const strategy = registry.resolve(syntheticLibrary);
  const contract = strategy.buildContract({ library: syntheticLibrary, libraries });
  expect(strategy.id).toBe(semanticsAuthoringStrategy.id);
  expect(contract.paramsSchema).toEqual(buildStudioJSONContract(syntheticLibrary, libraries));
  expect(contract.paramsSchema.$defs[syntheticLibrary].required).toEqual(['prompt', 'answer']);
  expect(contract.outputSchema).toBeNull();
  expect(contract.paramsSchema.$defs[syntheticLibrary].properties.showFeedback.default).toBe(true);
});

test('a registered strategy overrides one hook while inheriting the common contract and validation', () => {
  const registry = new StudioAuthoringStrategyRegistry();
  registry.register('H5P.SyntheticCard', { id: 'synthetic-card', postValidate({ parameters }) {
    if (parameters.prompt === parameters.answer) throw new Error('The task reveals its own answer.');
    return parameters;
  } });
  const strategy = registry.resolve(syntheticLibrary);
  expect(strategy.id).toBe('synthetic-card');
  expect(strategy.buildContract({ library: syntheticLibrary, libraries }).paramsSchema.$defs).toHaveProperty([syntheticLibrary]);
  expect(() => strategy.postValidate({ parameters: { prompt: 'Same', answer: 'Same' } })).toThrow('reveals its own answer');
  expect(strategy.postValidate({ parameters: { prompt: 'Question', answer: 'Answer' } })).toEqual({ prompt: 'Question', answer: 'Answer' });
  expect(() => registry.register('H5P.SyntheticCard', { id: 'replacement' })).toThrow('already registered');
  registry.register('H5P.SyntheticCard', { id: 'replacement' }, { replace: true });
  expect(registry.resolve(syntheticLibrary).id).toBe('replacement');
  expect(() => registry.register('H5P.Invalid', { id: 'invalid', postValidate: 'not a function' })).toThrow('must be a function');
});

test('Documentation Tool retains its specialized output schema only for a new text draft', () => {
  const library = 'H5P.DocumentationTool 1.8';
  const strategy = createStudioAuthoringStrategyRegistry().resolve(library);
  const catalog = getStudioCatalog();
  const contract = strategy.buildContract({ library, libraries: catalog.libraries });
  expect(contract.outputSchema).toBe(documentationOutputSchema);
  expect(contract.guidance.join('\n')).toContain('params.pagesList');
  expect(strategy.buildContract({ library, libraries: catalog.libraries, templateParameters: {} }).outputSchema).toBeNull();
});

test('request feasibility is polymorphic and preserves explicit exclusions', () => {
  const registry = createStudioAuthoringStrategyRegistry();
  const documentation = registry.resolve('H5P.DocumentationTool 1.8');
  expect(() => documentation.validateRequest({ instructions: 'Read, answer four multiple-choice questions, export to Word.' }))
    .toThrow(expect.objectContaining({ code: 'H5P_AI_INPUT' }));
  expect(() => documentation.validateRequest({ instructions: 'Use written responses and export to Word. Do not include multiple-choice questions.' })).not.toThrow();
  const generic = registry.resolve(syntheticLibrary);
  expect(() => generic.validateRequest({ instructions: 'Export all learner answers to Word.' })).toThrow('cannot export');
  expect(() => generic.validateRequest({ instructions: 'Create a short task. Do not export to Word.' })).not.toThrow();
});

test('a requested Documentation Tool response export must survive post-validation', () => {
  const strategy = createStudioAuthoringStrategyRegistry().resolve('H5P.DocumentationTool 1.8');
  const base = { instructions: 'Read and write a response, then export to Word.' };
  expect(() => strategy.postValidate({ ...base, parameters: { pagesList: [{ library: 'H5P.StandardPage 1.5' }] } }))
    .toThrow(expect.objectContaining({ code: 'H5P_AI_INVALID' }));
  const parameters = { pagesList: [{ library: 'H5P.StandardPage 1.5' }, { library: 'H5P.DocumentExportPage 1.5' }] };
  expect(strategy.postValidate({ ...base, parameters })).toBe(parameters);
});

test('class strategies preserve prototype behavior and private state, including a class fallback', () => {
  class ClassFallback {
    id = 'class-fallback';
    #minimum = 2;
    buildContract() { return { minimum: this.#minimum }; }
    validateRequest({ count }) { if (count < this.#minimum) throw new Error('Insufficient items.'); }
    postValidate({ parameters }) { return { ...parameters, checked: this.#minimum }; }
  }
  class ClassSpecialization {
    id = 'class-specialization';
    #expected = 'specific answer';
    postValidate({ parameters }) {
      if (parameters.answer !== this.#expected) throw new Error('Unexpected answer.');
      return parameters;
    }
  }
  const registry = new StudioAuthoringStrategyRegistry(new ClassFallback()).register('H5P.SyntheticCard', new ClassSpecialization());
  const specialized = registry.resolve(syntheticLibrary);
  expect(specialized.buildContract()).toEqual({ minimum: 2 });
  expect(() => specialized.validateRequest({ count: 1 })).toThrow('Insufficient items');
  expect(specialized.postValidate({ parameters: { answer: 'specific answer' } })).toEqual({ answer: 'specific answer' });
  expect(() => specialized.postValidate({ parameters: { answer: 'other' } })).toThrow('Unexpected answer');
  expect(registry.resolve('H5P.Unregistered 1.0').postValidate({ parameters: {} })).toEqual({ checked: 2 });
  expect(Object.keys(specialized)).toEqual(['id', 'guidance', 'buildContract', 'validateRequest', 'postValidate']);
});
