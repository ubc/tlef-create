import { describe, expect, jest, test } from '@jest/globals';
import { getStudioCatalog, libraryProblems } from '../../services/h5pStudioCatalog.js';
import { buildStudioContract, buildStudioJSONContract, collectTemplateMedia, normalizeStudioParameters, validateStudioMediaTemplate } from '../../services/h5pStudioSemantics.js';
import { generateStudioActivity, proposeStudioQuestionPlan, resolveStudioInstructions, validateStudioQuestionPlan, validateStudioRequestFeasibility } from '../../services/h5pStudioAIService.js';

const catalog = getStudioCatalog();
const chart = { graphMode: 'barChart', listOfTypes: [{ text: 'Oak', value: 12 }] };
const complete = () => jest.fn().mockResolvedValue({ model: 'test-model', content: JSON.stringify({ title: 'Tree survey', params: chart }) });

describe('native Studio AI authoring', () => {
  test('accepts blank instructions only when selected course evidence can ground the request', () => {
    expect(resolveStudioInstructions('', true)).toContain('selected course evidence');
    expect(() => resolveStudioInstructions('', false)).toThrow('select at least one ready course material');
    expect(() => resolveStudioInstructions('D', true)).toThrow('clear the field');
    expect(resolveStudioInstructions('Create a force question.', false)).toBe('Create a force question.');
  });
  test('restricts an approved collection plan to installed compatible types and counts', () => {
    const column = catalog.types.find(type => type.machineName === 'H5P.Column');
    expect(validateStudioQuestionPlan(column.library, [{ questionType: 'multiple-choice', count: 3 }], catalog))
      .toMatchObject([{ questionType: 'multiple-choice', count: 3, library: 'H5P.MultiChoice 1.16' }]);
    expect(() => validateStudioQuestionPlan(column.library, [{ questionType: 'crossword', count: 1 }], catalog))
      .toThrow('unavailable in this H5P layout');
    expect(() => validateStudioQuestionPlan(column.library, [{ questionType: 'multiple-choice', count: 9 }], catalog))
      .toThrow('whole number');
  });

  test('proposes a reviewable count and refuses a substituted same-type plan', async () => {
    const column = catalog.types.find(type => type.machineName === 'H5P.Column');
    const complete = jest.fn().mockResolvedValue({ content: JSON.stringify({ unsupportedReason: '', rows: [{ questionType: 'multiple-choice', count: 4 }] }) });
    const plan = await proposeStudioQuestionPlan({ library: column.library, kind: 'same-type', preferredQuestionType: 'multiple-choice',
      instructions: 'Write four multiple-choice questions about cellular respiration.', userId: 'teacher', complete, catalog });
    expect(plan).toMatchObject([{ questionType: 'multiple-choice', count: 4 }]);
    expect(complete.mock.calls[0][0].prompt).toContain('Follow explicit quantities');
    const invalid = jest.fn().mockResolvedValue({ content: JSON.stringify({ unsupportedReason: '', rows: [{ questionType: 'true-false', count: 4 }] }) });
    await expect(proposeStudioQuestionPlan({ library: column.library, kind: 'same-type', preferredQuestionType: 'multiple-choice',
      instructions: 'Write four multiple-choice questions about cellular respiration.', userId: 'teacher', complete: invalid, catalog }))
      .rejects.toThrow('selected question type');
    const wrongCount = jest.fn().mockResolvedValue({ content: JSON.stringify({ unsupportedReason: '', rows: [{ questionType: 'multiple-choice', count: 3 }] }) });
    await expect(proposeStudioQuestionPlan({ library: column.library, kind: 'same-type', preferredQuestionType: 'multiple-choice',
      instructions: 'Write four multiple-choice questions about cellular respiration.', userId: 'teacher', complete: wrongCount, catalog }))
      .rejects.toThrow('4 questions requested');
    const tooMany = jest.fn();
    await expect(proposeStudioQuestionPlan({ library: column.library, kind: 'same-type', preferredQuestionType: 'multiple-choice',
      instructions: 'Write 10 multiple-choice questions about cellular respiration.', userId: 'teacher', complete: tooMany, catalog }))
      .rejects.toThrow('at most eight');
    expect(tooMany).not.toHaveBeenCalled();
  });

  test('a collection plan covers every selected type and rejects substitutions', async () => {
    const column = catalog.types.find(type => type.machineName === 'H5P.Column');
    const base = { library: column.library, kind: 'collection', selectedQuestionTypes: ['multiple-choice', 'true-false'],
      instructions: 'Create three questions about the water cycle.', userId: 'teacher', catalog };
    const complete = jest.fn().mockResolvedValue({ content: JSON.stringify({ unsupportedReason: '', rows: [
      { questionType: 'multiple-choice', count: 2 }, { questionType: 'true-false', count: 1 }
    ] }) });
    await expect(proposeStudioQuestionPlan({ ...base, complete })).resolves.toMatchObject([
      { questionType: 'multiple-choice', count: 2 }, { questionType: 'true-false', count: 1 }
    ]);
    expect(complete.mock.calls[0][0].jsonSchema.schema.properties.rows.items.properties.questionType.enum)
      .toEqual(base.selectedQuestionTypes);
    const incomplete = jest.fn().mockResolvedValue({ content: JSON.stringify({ unsupportedReason: '', rows: [
      { questionType: 'multiple-choice', count: 3 }
    ] }) });
    await expect(proposeStudioQuestionPlan({ ...base, complete: incomplete })).rejects.toThrow('every selected question type');
    const invalid = jest.fn();
    await expect(proposeStudioQuestionPlan({ ...base, selectedQuestionTypes: ['crossword'], complete: invalid }))
      .rejects.toMatchObject({ code: 'H5P_AI_INPUT', status: 400 });
    await expect(proposeStudioQuestionPlan({ ...base, instructions: 'Create one question about the water cycle.', complete: invalid }))
      .rejects.toThrow('at least one question per selected type');
    expect(invalid).not.toHaveBeenCalled();
  });

  test('repairs a collection with the wrong number of native questions', async () => {
    const column = catalog.types.find(type => type.machineName === 'H5P.Column');
    const item = (question, correct) => ({ content: { library: 'H5P.MultiChoice 1.16', metadata: { title: question }, params: {
      question, answers: [{ text: correct, correct: true }, { text: 'Wrong', correct: false }]
    } } });
    const one = { title: 'Forces', params: { content: [item('What is force?', 'A push')] } };
    const two = { title: 'Forces', params: { content: [item('What is force?', 'A push'), item('What is mass?', 'Matter')] } };
    const complete = jest.fn().mockResolvedValueOnce({ content: JSON.stringify(one), model: 'test' })
      .mockResolvedValueOnce({ content: JSON.stringify(two), model: 'test' });
    const result = await generateStudioActivity({ library: column.library, instructions: 'Write two multiple-choice questions about force and mass.',
      questionPlan: [{ questionType: 'multiple-choice', count: 2 }], complete, catalog });
    expect(result.provenance.attempts).toBe(2);
    expect(result.document.parameters.content).toHaveLength(2);
  });

  test('rejects a Documentation Tool request for multiple-choice pages before calling the model', async () => {
    const completion = jest.fn();
    await expect(generateStudioActivity({ library: 'H5P.DocumentationTool 1.8',
      instructions: 'Read a resource, answer 4 multiple-choice questions, then export all answers to Word.',
      complete: completion, catalog })).rejects.toMatchObject({ code: 'H5P_AI_INPUT', status: 400 });
    expect(completion).not.toHaveBeenCalled();
  });

  test('allows an explicit instruction to omit multiple-choice from a Documentation Tool', () => {
    expect(() => validateStudioRequestFeasibility('H5P.DocumentationTool 1.8',
      'Use written response fields and export answers to Word. Do not include multiple-choice questions.')).not.toThrow();
  });

  test('rejects extra native items outside the approved collection plan', async () => {
    const column = catalog.types.find(type => type.machineName === 'H5P.Column');
    const params = { content: [
      { content: { library: 'H5P.MultiChoice 1.16', metadata: { title: 'Force' }, params: {
        question: 'What is force?', answers: [{ text: 'A push', correct: true }, { text: 'A color', correct: false }]
      } } },
      { content: { library: 'H5P.Chart 1.2', metadata: { title: 'Extra chart' }, params: chart } }
    ] };
    const complete = jest.fn().mockResolvedValue({ content: JSON.stringify({ title: 'Forces', params }), model: 'test' });
    await expect(generateStudioActivity({ library: column.library, instructions: 'Write one multiple-choice question about force.',
      questionPlan: [{ questionType: 'multiple-choice', count: 1 }], complete, catalog })).rejects.toThrow('approved type and count plan');
    expect(complete).toHaveBeenCalledTimes(2);
  });
  test('repairs a heading-only Documentation Tool with real native reading, response and export pages', async () => {
    const entry = (library, title, params) => ({ library, metadata: { title }, params });
    const params = { taskDescription: 'Water cycle reflection', pagesList: [
      entry('H5P.StandardPage 1.5', 'Read', { elementList: [entry('H5P.Text 1.1', 'Source', { text: 'Evaporation changes liquid to vapor.' })] }),
      entry('H5P.StandardPage 1.5', 'Reflect', { elementList: [entry('H5P.TextInputField 1.2', 'Your response', { taskDescription: 'Explain condensation.', placeholderText: '', inputFieldSize: '3' })] }),
      entry('H5P.DocumentExportPage 1.5', 'Export your response', { description: 'Export your response for review.' })
    ] };
    const model = jest.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ title: 'Reflection', params: { taskDescription: 'Reflection' } }), model: 'test' })
      .mockResolvedValue({ content: JSON.stringify({ title: 'Reflection', params }), model: 'test' });
    const result = await generateStudioActivity({ library: 'H5P.DocumentationTool 1.8', instructions: 'Read, respond, export.', complete: model, catalog });
    expect(result.document.parameters.pagesList).toHaveLength(3);
    expect(result.document.parameters.pagesList[1].params.elementList[0].params.inputFieldSize).toBe('3');
    expect(result.document.parameters.pagesList[2].params.createDocumentLabel).toBe('Create document');
    expect(model.mock.calls[0][0].jsonSchema.schema.properties.params.required).toContain('pagesList');
    expect(model.mock.calls[1][0].prompt).toContain('Required field: params.pagesList');
  });
  test('requires a Multimedia Choice poster only for an audio option', () => {
    const image = { path: 'images/example.png', mime: 'image/png', width: 640, height: 360 };
    const choice = { media: { library: 'H5P.Image 1.1', params: { file: image, alt: 'A square' } }, correct: true };
    const params = { question: 'Select the square.', options: [choice, { ...structuredClone(choice), correct: false }] };
    expect(() => validateStudioMediaTemplate('H5P.MultiMediaChoice 0.3', params, catalog)).not.toThrow();
    params.options[0].media = { library: 'H5P.Audio 1.5', params: { autoplay: false, files: [{ path: 'audio/example.wav', mime: 'audio/wav' }] } };
    expect(() => validateStudioMediaTemplate('H5P.MultiMediaChoice 0.3', params, catalog)).toThrow('params.options[0].poster');
    params.options[0].poster = image;
    expect(() => validateStudioMediaTemplate('H5P.MultiMediaChoice 0.3', params, catalog)).not.toThrow();
  });
  test('accepts modern coordinates emitted by the official Image Hotspots editor', () => {
    const image = { path: 'images/example.png', mime: 'image/png', width: 640, height: 360 };
    const params = {
      image, iconImage: image, iconType: 'icon', icon: 'plus', color: '#981d99',
      hotspots: [{ position: { x: 50, y: 50 }, alwaysFullscreen: false,
        content: [{ library: 'H5P.Text 1.1', params: { text: 'A hotspot explanation.' } }] }]
    };
    const saved = validateStudioMediaTemplate('H5P.ImageHotspots 1.10', params, catalog);
    expect(saved.hotspots[0].position).toEqual({ x: 50, y: 50, legacyPositioning: false });
    expect(params.hotspots[0].position).not.toHaveProperty('legacyPositioning');
    params.hotspots[0].position.legacyPositioning = true;
    expect(validateStudioMediaTemplate('H5P.ImageHotspots 1.10', params, catalog).hotspots[0].position.legacyPositioning).toBe(true);
    params.hotspots[0].position.legacyPositioning = 'invalid';
    expect(() => validateStudioMediaTemplate('H5P.ImageHotspots 1.10', params, catalog)).toThrow();
  });
  test('includes assessment and score-aware feedback constraints in the live prompt', async () => {
    const completion = complete();
    await generateStudioActivity({ library: 'H5P.Chart 1.2', instructions: 'Create a tree count chart.', complete: completion });
    const prompt = completion.mock.calls[0][0].prompt;
    expect(completion.mock.calls[0][0].jsonMode).toBe(true);
    expect(prompt).toContain('not a statement revealing the correct answer');
    expect(prompt).toContain('unambiguously incorrect');
    expect(prompt).toContain('notChosenFeedback describes leaving it unselected');
    expect(prompt).toContain('0–100 must be neutral');
  });
  test('discovers every runnable type and checks the complete asset/dependency chain', () => {
    const runnable = new Set([...catalog.libraries.values()].filter(entry => entry.descriptor.runnable).map(entry => entry.descriptor.machineName));
    expect(new Set(catalog.types.map(type => type.machineName))).toEqual(runnable);
    expect(catalog.types.length).toBeGreaterThan(30);
    for (const type of catalog.types.filter(type => type.mode !== 'unavailable')) {
      expect(libraryProblems(type.library, catalog.libraries)).toEqual([]);
    }
    expect(catalog.types.find(type => type.machineName === 'H5P.InteractiveBook').library).toBe('H5P.InteractiveBook 1.11');
    expect(catalog.types.find(type => type.machineName === 'H5P.Dictation')).toMatchObject({ library: 'H5P.Dictation 1.3', mode: 'template' });
    expect(catalog.types.find(type => type.machineName === 'H5P.BranchingScenario').mode).toBe('generate');
    expect(catalog.types.find(type => type.machineName === 'H5P.TwitterUserFeed')).toMatchObject({ mode: 'unavailable', guidance: expect.stringContaining('no longer supported') });
    expect(catalog.types.find(type => type.machineName === 'H5P.CoursePresentation').mode).toBe('generate');
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

  test('accepts official optional null color defaults without emitting invalid text', () => {
    const libraries = new Map([['Test 1.0', { semantics: [{ name: 'color', type: 'text', optional: true, default: null }] }]]);
    expect(normalizeStudioParameters('Test 1.0', {}, libraries)).toEqual({});
  });

  test('flattens single-child groups consistently in parameters, schema and media copying', () => {
    const libraries = new Map([['Test 1.0', { descriptor: {}, semantics: [
      { name: 'picture', type: 'group', fields: [{ name: 'image', type: 'image' }] },
      { name: 'feedback', type: 'group', fields: [{ name: 'rows', type: 'list', optional: true, min: 1, field: { type: 'text' } }] }
    ] }]]);
    const params = { picture: { path: 'images/test.png', mime: 'image/png' } };
    const media = collectTemplateMedia('Test 1.0', params, libraries, 'owned');
    expect(media.get('images/test.png').path).toBe('../content/owned/images/test.png');
    const normalized = normalizeStudioParameters('Test 1.0', params, libraries, media);
    expect(normalized.picture.path).toBe('../content/owned/images/test.png');
    expect(normalized).not.toHaveProperty('feedback');
    expect(buildStudioJSONContract('Test 1.0', libraries).$defs['Test 1.0'].properties.feedback.type).toBe('array');
  });

  test('accepts unselected optional library values emitted by the official editor', () => {
    const libraries = new Map([['Test 1.0', { semantics: [{ name: 'media', type: 'library', optional: true, options: [] }] }]]);
    expect(normalizeStudioParameters('Test 1.0', { media: { params: {} } }, libraries)).toEqual({});
    expect(() => normalizeStudioParameters('Test 1.0', { media: { library: 'Untrusted 1.0', params: {} } }, libraries)).toThrow('allowed nested library');
  });

  test('accepts the native optional select placeholder but rejects unknown choices', () => {
    const libraries = new Map([['Test 1.0', { semantics: [{ name: 'target', type: 'select', optional: true, options: [{ value: 'time' }] }] }]]);
    expect(normalizeStudioParameters('Test 1.0', { target: '-' }, libraries)).toEqual({});
    expect(() => normalizeStudioParameters('Test 1.0', { target: 'unknown' }, libraries)).toThrow('selection');
  });

  test('inherits group optionality like the official editor without weakening required groups', () => {
    const group = { name: 'override', type: 'group', optional: true, fields: [{ name: 'retry', type: 'select', options: [{ value: 'on' }] }, { name: 'label', type: 'text' }] };
    const libraries = new Map([['Test 1.0', { descriptor: {}, semantics: [group] }]]);
    expect(normalizeStudioParameters('Test 1.0', { override: {} }, libraries)).toEqual({ override: {} });
    expect(buildStudioJSONContract('Test 1.0', libraries).$defs['Test 1.0'].properties.override.required).toEqual([]);
    group.optional = false;
    expect(() => normalizeStudioParameters('Test 1.0', { override: {} }, libraries)).toThrow('Required field');
  });

  test('validates dynamic drag-and-drop indexes and rejects dangling references', () => {
    const dynamic = { type: 'select', widget: 'dynamicCheckboxes', multiple: true };
    const libraries = new Map([['H5P.DragQuestion 1.14', { semantics: [{ name: 'question', type: 'group', isSubContent: true, fields: [{ name: 'task', type: 'group', fields: [
      { name: 'elements', type: 'list', field: { type: 'group', isSubContent: true, fields: [{ name: 'dropZones', ...dynamic }] } },
      { name: 'dropZones', type: 'list', field: { type: 'group', isSubContent: true, fields: [{ name: 'correctElements', ...dynamic }] } }
    ] }] }] }]]);
    const params = { question: { task: { elements: [{ dropZones: ['0'] }], dropZones: [{ correctElements: ['0'] }] } } };
    expect(normalizeStudioParameters('H5P.DragQuestion 1.14', params, libraries).question.task.dropZones).toEqual([{ correctElements: ['0'], tipsAndFeedback: {} }]);
    params.question.task.elements[0].dropZones = ['1'];
    expect(() => normalizeStudioParameters('H5P.DragQuestion 1.14', params, libraries)).toThrow('missing element');
    params.question.task.elements[0].dropZones = ['-1'];
    expect(() => normalizeStudioParameters('H5P.DragQuestion 1.14', params, libraries)).toThrow('dynamic selection');
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
