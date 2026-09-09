import { describe, expect, jest, test } from '@jest/globals';
import { getStudioCatalog, libraryProblems } from '../../services/h5pStudioCatalog.js';
import { buildStudioContract, buildStudioJSONContract, collectTemplateMedia, normalizeStudioParameters } from '../../services/h5pStudioSemantics.js';
import { generateStudioActivity } from '../../services/h5pStudioAIService.js';

const catalog = getStudioCatalog();
const chart = { graphMode: 'barChart', listOfTypes: [{ text: 'Oak', value: 12 }] };
const complete = () => jest.fn().mockResolvedValue({ model: 'test-model', content: JSON.stringify({ title: 'Tree survey', params: chart }) });

describe('native Studio AI authoring', () => {
  test('discovers every runnable type and checks the complete asset/dependency chain', () => {
    const runnable = new Set([...catalog.libraries.values()].filter(entry => entry.descriptor.runnable).map(entry => entry.descriptor.machineName));
    expect(new Set(catalog.types.map(type => type.machineName))).toEqual(runnable);
    expect(catalog.types.length).toBeGreaterThan(30);
    for (const type of catalog.types.filter(type => type.mode !== 'unavailable')) {
      expect(libraryProblems(type.library, catalog.libraries)).toEqual([]);
    }
    expect(catalog.types.find(type => type.machineName === 'H5P.InteractiveBook').library).toBe('H5P.InteractiveBook 1.11');
    expect(catalog.types.find(type => type.machineName === 'H5P.Dictation')).toMatchObject({ library: 'H5P.Dictation 1.3', mode: 'template' });
    expect(catalog.types.find(type => type.machineName === 'H5P.BranchingScenario').mode).toBe('unavailable');
  });

  test('fills official defaults and strips unknown fields and unsafe HTML', () => {
    const params = normalizeStudioParameters('H5P.Chart 1.2', { ...chart, listOfTypes: [{ text: '<script>alert(1)</script>Oak', value: 12 }], exploit: true }, catalog.libraries);
    expect(params.figureDefinition).toBe('Chart');
    expect(params.listOfTypes[0].text).toBe('Oak');
    expect(params).not.toHaveProperty('exploit');
  });

  test('rejects missing required fields, invalid numbers, enum values and nested libraries', () => {
    expect(() => normalizeStudioParameters('H5P.Chart 1.2', {}, catalog.libraries)).toThrow('Required field');
    expect(() => normalizeStudioParameters('H5P.Chart 1.2', { ...chart, graphMode: 'bad' }, catalog.libraries)).toThrow('selection');
    expect(() => normalizeStudioParameters('H5P.Chart 1.2', { ...chart, listOfTypes: [{ text: 'X', value: -1 }] }, catalog.libraries)).toThrow('number');
    expect(() => normalizeStudioParameters('H5P.Column 1.20', { content: [{ content: { library: 'H5P.Untrusted 1.0', params: {} } }] }, catalog.libraries)).toThrow('allowed nested library');
  });

  test('never inserts an empty optional media group for Guess the Answer', () => {
    const params = normalizeStudioParameters('H5P.GuessTheAnswer 1.5', { taskDescription: 'Name the largest planet.', solutionText: 'Jupiter' }, catalog.libraries);
    expect(params).not.toHaveProperty('media');
  });

  test('resolves questionnaire nested schemas rather than only the top-level wrapper', () => {
    const schema = buildStudioContract('H5P.Questionnaire 1.3', catalog.libraries);
    expect(schema['H5P.SimpleMultiChoice 1.1']).toBeDefined();
    expect(schema['H5P.OpenEndedQuestion 1.0']).toBeDefined();
    const jsonSchema = buildStudioJSONContract('H5P.Questionnaire 1.3', catalog.libraries);
    const item = jsonSchema.$defs['H5P.Questionnaire 1.3'].properties.questionnaireElements.items;
    expect(item.properties.library.oneOf[0].properties.library.const).toBe('H5P.OpenEndedQuestion 1.0');
    expect(item.properties).not.toHaveProperty('libraryGroup');
  });

  test('creates a structurally checked native draft with private data absent from provenance', async () => {
    const result = await generateStudioActivity({ library: 'H5P.Chart 1.2', instructions: 'Chart the provided tree counts.', userId: 'teacher', complete: complete(), catalog });
    expect(result.document.library).toBe('H5P.Chart 1.2');
    expect(result.document.parameters.listOfTypes[0].value).toBe(12);
    expect(result.provenance).toEqual({ model: 'test-model', library: 'H5P.Chart 1.2', attempts: 1, validation: 'structural', contractVersion: 1 });
  });

  test('repairs one invalid response and rejects repeated invalid output', async () => {
    const completion = complete().mockResolvedValueOnce({ content: '{bad', model: 'test' });
    const result = await generateStudioActivity({ library: 'H5P.Chart 1.2', instructions: 'Chart the provided tree counts.', complete: completion, catalog });
    expect(result.provenance.attempts).toBe(2);
    const invalid = jest.fn().mockResolvedValue({ content: '{}', model: 'test' });
    await expect(generateStudioActivity({ library: 'H5P.Chart 1.2', instructions: 'Chart the provided tree counts.', complete: invalid, catalog })).rejects.toThrow('No content was saved');
    expect(invalid).toHaveBeenCalledTimes(2);
  });

  test('blocks missing media templates before calling the AI', async () => {
    const completion = complete();
    await expect(generateStudioActivity({ library: 'H5P.MemoryGame 1.3', instructions: 'Create a matching game.', complete: completion, catalog })).rejects.toMatchObject({ code: 'H5P_AI_TEMPLATE_REQUIRED' });
    expect(completion).not.toHaveBeenCalled();
  });

  test('rejects an unfinished empty media template before spending AI tokens', async () => {
    const completion = complete();
    await expect(generateStudioActivity({ library: 'H5P.Dictation 1.3', instructions: 'Adapt this dictation.', template: { library: 'H5P.Dictation 1.3', params: { params: {} } }, templateContentId: 'owned', complete: completion, catalog })).rejects.toMatchObject({ code: 'H5P_AI_TEMPLATE_REQUIRED', status: 400 });
    expect(completion).not.toHaveBeenCalled();
  });

  test('copies only trusted media references from the saved owner-checked template', () => {
    const params = { files: [{ path: 'audios/lesson.mp3', mime: 'audio/mpeg' }], autoplay: false };
    const media = collectTemplateMedia('H5P.Audio 1.5', params, catalog.libraries, '123');
    expect(media.get('audios/lesson.mp3').path).toBe('../content/123/audios/lesson.mp3');
    const normalized = normalizeStudioParameters('H5P.Audio 1.5', params, catalog.libraries, media);
    expect(normalized.files[0].path).toBe('../content/123/audios/lesson.mp3');
    expect(() => normalizeStudioParameters('H5P.Audio 1.5', { files: [{ path: '../other-user/private.mp3' }] }, catalog.libraries, media)).toThrow('saved template');
  });
});
