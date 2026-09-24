import crypto from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { libraryProblems } from './h5pStudioCatalog.js';

const media = new Set(['image', 'audio', 'video', 'file']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { const error = new Error(message); error.code = 'H5P_AI_INVALID'; throw error; };

function runtimeDefaults(library, params) {
  if (library.startsWith('H5P.DragQuestion ')) {
    const { elements = [], dropZones = [] } = params.question?.task || {};
    if (elements.some(item => item.dropZones?.some(index => Number(index) >= dropZones.length)) || dropZones.some(item => item.correctElements?.some(index => Number(index) >= elements.length))) fail('Drag and Drop references a missing element or drop zone.');
    // 1.14 reads .tip unconditionally although this group is optional in semantics.
    for (const zone of dropZones) zone.tipsAndFeedback ??= {};
  }
  return params;
}

/** Validate native parameters, fill official defaults and reject invented media.
 * The server owns the schema, nested-library allowlist and file references.
 * This is structural validation, not a claim of pedagogical/runtime correctness.
 */
export function normalizeStudioParameters(library, parameters, libraries, trustedMedia = new Map()) {
  let nodes = 0;
  const inspect = (field, input, location, depth, root = false) => {
    if (++nodes > 12000 || depth > 32) fail('The activity is too complex. Generate a smaller activity.');
    let value = input;
    if (value === undefined && field.default !== undefined) value = structuredClone(field.default);
    // Official color widgets use null to mean “no custom color”.
    if (value === null && field.optional) return undefined;
    // Pass absence through to the child too (e.g. optional overallFeedback).
    if (field.type === 'group' && !root && field.fields?.length === 1 && !field.isSubContent) {
      if (value === undefined && field.optional) return undefined;
      return inspect(field.optional ? { ...field.fields[0], optional: true } : field.fields[0], value, location, depth + 1);
    }
    if (value === undefined) {
      if (field.optional) return undefined;
      if (field.type === 'group') value = {};
      else if (field.type === 'list' && !field.min) value = [];
      else fail(`Required field: ${location}`);
    }
    if (field.type === 'group') {
      // H5P flattens ordinary one-child groups, including list item groups.
      // The root parameters object (and explicit subcontent) stays an object.
      if (!object(value)) fail(`Expected an object: ${location}`);
      const result = {};
      for (const child of field.fields || []) {
        if (['__proto__', 'prototype', 'constructor'].includes(child.name)) fail('Unsafe field name.');
        // Hidden ShowWhen widgets do not require a value in the native editor.
        // Still validate a supplied value, and keep unknown rule types strict.
        const rules = child.widget === 'showWhen' ? child.showWhen?.rules : undefined;
        const matches = rules?.map(rule => {
          const sibling = field.fields.find(item => item.name === rule.field);
          const actual = value[rule.field] ?? sibling?.default;
          if (sibling?.type === 'library') return String(rule.equals).includes(actual?.library?.split(' ')[0] ?? '__missing__');
          if (sibling?.type === 'select') return Array.isArray(rule.equals) ? rule.equals.includes(actual) : String(rule.equals).includes(actual);
          if (sibling?.type === 'boolean') return actual === rule.equals;
          return true;
        });
        const hidden = matches?.length && !(child.showWhen.type === 'and' ? matches.every(Boolean) : matches.some(Boolean));
        // H5PEditor.Group propagates optional to each child (e.g. video overrides).
        const normalized = inspect(field.optional || hidden ? { ...child, optional: true } : child, value[child.name], `${location}.${child.name}`, depth + 1);
        if (normalized !== undefined) result[child.name] = normalized;
      }
      // Some older semantics mark the group required but every child optional.
      // In particular GuessTheAnswer crashes if an absent media group is {}.
      if (field.name === 'media' && !Object.keys(result).length && (field.fields || []).every(child => child.optional)) return undefined;
      return result;
    }
    if (field.type === 'list') {
      if (!Array.isArray(value) || value.length < (field.min || 0) || value.length > Math.min(field.max ?? 100, 100)) fail(`Invalid list length: ${location}`);
      return value.map((item, index) => inspect(field.field, item, `${location}[${index}]`, depth + 1));
    }
    if (field.type === 'library') {
      // The official editor represents an unselected optional library as
      // { params: {} }, not undefined. It is not a requested executable type.
      if (field.optional && object(value) && !value.library && (!value.params || (object(value.params) && !Object.keys(value.params).length))) return undefined;
      if (!object(value) || !field.options?.includes(value.library)) fail(`Choose an allowed nested library: ${location}`);
      const entry = libraries.get(value.library);
      if (!entry || libraryProblems(value.library, libraries).length) fail(`Nested library is unavailable: ${value.library}`);
      return {
        library: value.library,
        params: runtimeDefaults(value.library, inspect({ type: 'group', fields: entry.semantics }, value.params, `${location}.params`, depth + 1, true)),
        subContentId: crypto.randomUUID(),
        metadata: { title: typeof value.metadata?.title === 'string' ? sanitizeHtml(value.metadata.title, { allowedTags: [], allowedAttributes: {} }).slice(0, 255) : entry.descriptor.title, license: 'U' }
      };
    }
    if (media.has(field.type)) {
      const items = ['audio', 'video'].includes(field.type) ? value : [value];
      if (!Array.isArray(items) || !items.length) fail(`Real ${field.type} is required: ${location}`);
      const files = items.map(file => {
        if (!object(file) || !trustedMedia.has(file.path)) fail(`Use media from your saved template: ${location}`);
        return structuredClone(trustedMedia.get(file.path));
      });
      return ['audio', 'video'].includes(field.type) ? files : files[0];
    }
    if (field.type === 'text') {
      if (typeof value !== 'string' || value.length > Math.min(field.maxLength ?? 50000, 50000)) fail(`Invalid text: ${location}`);
      if (!field.optional && field.default === undefined && !sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()) fail(`Required text: ${location}`);
      if (field.regexp?.pattern && !new RegExp(field.regexp.pattern, (field.regexp.modifiers || '').replace(/g/g, '')).test(value)) fail(`Text has the wrong format: ${location}`);
      return sanitizeHtml(value, { allowedTags: field.widget === 'html' ? ['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h2', 'h3', 'sub', 'sup', 'blockquote', 'table', 'tr', 'td', 'th', 'tbody'] : [], allowedAttributes: {} });
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < (field.min ?? -Infinity) || value > (field.max ?? Infinity)) fail(`Invalid number: ${location}`);
      return value;
    }
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') fail(`Expected true or false: ${location}`);
      return value;
    }
    if (field.type === 'select') {
      const values = field.multiple ? value : [value];
      if (!field.options && field.widget === 'dynamicCheckboxes') {
        if (!Array.isArray(values) || values.some(item => !/^(0|[1-9]\d{0,2})$/.test(String(item)))) fail(`Invalid dynamic selection: ${location}`);
        return values.map(String);
      }
      const options = (field.options || []).flatMap(option => option.options || [option]).map(option => option.value);
      // SelectToggleFields retains the native '-' placeholder on optional selects.
      if (field.optional && !field.multiple && (value === '-' || value === '') && !options.includes(value)) return undefined;
      if (!Array.isArray(values) || values.some(item => !options.includes(item))) fail(`Invalid selection: ${location}`);
      return value;
    }
    fail(`Unsupported semantics field: ${location}`);
  };
  const entry = libraries.get(library);
  if (!entry) fail('Choose an installed H5P type.');
  const result = inspect({ type: 'group', fields: entry.semantics }, parameters, 'params', 0, true);
  return runtimeDefaults(library, result);
}

// Keep the AI prompt bounded: include the chosen library and safe nested text
// activities, not every editor widget, translation and possible recursive type.
export function buildStudioContract(library, libraries, templateParameters) {
  const schemas = {};
  const visit = (name, depth = 0) => {
    if (schemas[name] || depth > 3) return;
    const entry = libraries.get(name);
    if (!entry || libraryProblems(name, libraries).length) return;
    schemas[name] = [];
    const compact = field => {
      const out = {};
      for (const key of ['name', 'type', 'label', 'description', 'default', 'optional', 'min', 'max', 'maxLength', 'multiple', 'regexp', 'isSubContent']) {
        if (field[key] !== undefined) out[key] = field[key];
      }
      if (field.fields) out.fields = field.fields.map(compact);
      if (field.field) out.field = compact(field.field);
      if (field.type === 'library') {
        out.options = (field.options || []).filter(option => libraries.has(option) && !libraryProblems(option, libraries).length);
        // These are sufficient building blocks for composite text lessons.
        for (const option of out.options.filter(option => /^H5P\.(AdvancedText|MultiChoice|SimpleMultiChoice|OpenEndedQuestion|TrueFalse|Blanks|Column|SingleChoiceSet|Summary|Text|StandardPage|TextInputField|DocumentExportPage|GoalsPage|GoalsAssessmentPage|BranchingQuestion) /.test(option))) visit(option, depth + 1);
      } else if (field.options) out.options = field.options;
      if (field.widget === 'html') out.html = true;
      return out;
    };
    schemas[name] = entry.semantics.map(compact);
  };
  visit(library);
  const includeTemplateLibraries = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 32) return;
    if (typeof value.library === 'string') visit(value.library);
    Object.values(value).forEach(child => includeTemplateLibraries(child, depth + 1));
  };
  includeTemplateLibraries(templateParameters);
  return schemas;
}

/** Translate editor semantics to the actual JSON shape the model must emit.
 * A list field's name is an editor label, NOT a wrapper in each array item.
 * A field named "library" can itself hold a nested {library, params} value.
 */
export function buildStudioJSONContract(library, libraries, templateParameters, trustedMedia = new Map()) {
  const semantics = buildStudioContract(library, libraries, templateParameters);
  const group = fields => ({
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries((fields || []).map(field => [field.name, convert(field)])),
    required: (fields || []).filter(field => !field.optional && field.default === undefined).map(field => field.name)
  });
  const convert = field => {
    let schema;
    if (field.type === 'group') {
      const fields = field.optional ? field.fields?.map(child => ({ ...child, optional: true })) : field.fields;
      schema = fields?.length === 1 && !field.isSubContent ? convert(fields[0]) : group(fields);
    }
    else if (field.type === 'list') schema = { type: 'array', items: convert(field.field), minItems: field.min || 0, maxItems: Math.min(field.max ?? 100, 100) };
    else if (field.type === 'library') schema = { oneOf: (field.options || []).filter(option => semantics[option]).map(option => ({
      type: 'object', additionalProperties: false,
      properties: { library: { const: option }, params: { $ref: `#/$defs/${option}` }, metadata: { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false } },
      required: ['library', 'params']
    })) };
    else if (media.has(field.type)) {
      const file = { type: 'object', properties: { path: { enum: [...trustedMedia.keys()] } }, required: ['path'], additionalProperties: false };
      schema = ['audio', 'video'].includes(field.type) ? { type: 'array', items: file, minItems: 1 } : file;
    } else if (field.type === 'select') {
      const selection = !field.options && field.multiple
        ? { type: 'string', pattern: '^(0|[1-9][0-9]{0,2})$', description: 'Zero-based index of an existing element or drop zone.' }
        : { enum: (field.options || []).flatMap(option => option.options || [option]).map(option => option.value) };
      schema = field.multiple ? { type: 'array', items: selection } : selection;
    } else {
      schema = { type: field.type === 'text' ? 'string' : field.type };
      if (field.type === 'number') {
        if (field.min !== undefined) schema.minimum = field.min;
        if (field.max !== undefined) schema.maximum = field.max;
      }
      if (field.maxLength !== undefined) schema.maxLength = field.maxLength;
      if (field.regexp?.pattern) schema.pattern = field.regexp.pattern;
    }
    if (field.default !== undefined) schema.default = field.default;
    const description = [field.label, field.description, field.html ? 'Simple safe HTML is allowed.' : ''].filter(Boolean).join(' — ');
    if (description) schema.description = description;
    return schema;
  };
  return { $ref: `#/$defs/${library}`, $defs: Object.fromEntries(Object.entries(semantics).map(([name, fields]) => [name, group(fields)])) };
}

// Use only media discovered through semantics, never arbitrary keys supplied by
// a model. Lumi's paste-source format copies owned files into the new draft.
export function collectTemplateMedia(library, parameters, libraries, contentId) {
  const files = new Map();
  const walk = (field, value, depth = 0, root = false) => {
    if (value == null || depth > 32) return;
    if (media.has(field.type)) {
      for (const file of Array.isArray(value) ? value : [value]) {
        if (!object(file) || typeof file.path !== 'string') continue;
        const external = /^https:\/\//.test(file.path);
        const relative = /^(?!\/)[\w./-]+$/.test(file.path) && !file.path.split('/').includes('..');
        if (!external && !relative) fail('The saved template contains an unsafe media path.');
        files.set(file.path, { ...file, path: external ? file.path : `../content/${contentId}/${file.path}` });
      }
    } else if (field.type === 'group') {
      if (!root && field.fields?.length === 1 && !field.isSubContent) walk(field.fields[0], value, depth + 1);
      else for (const child of field.fields || []) walk(child, value[child.name], depth + 1);
    } else if (field.type === 'list' && Array.isArray(value)) {
      value.forEach(item => walk(field.field, item, depth + 1));
    } else if (field.type === 'library' && libraries.has(value.library)) {
      walk({ type: 'group', fields: libraries.get(value.library).semantics }, value.params, depth + 1, true);
    }
  };
  walk({ type: 'group', fields: libraries.get(library)?.semantics }, parameters, 0, true);
  return files;
}

export function studioMediaPaths(parameters) {
  const paths = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string' && typeof value.mime === 'string') paths.push(value.path);
    Object.values(value).forEach(walk);
  };
  walk(parameters);
  return paths;
}

// Validation-only editor boundary: these references are NOT an AI allowlist.
// Lumi still checks uploaded/pasted files and ownership when saving. Never use
// this map to authorize a generated file or copy from another user's content.
export function validateStudioMediaTemplate(library, parameters, catalog) {
  const type = catalog.types.find(item => item.machineName === library.split(' ')[0]);
  if (type?.category !== 'Media activities') return parameters;
  // The native video editor adds one blank optional subtitle row by default.
  // Discard that placeholder rather than rejecting a valid video without captions.
  // This is an editor boundary only; AI output retains strict required-file checks.
  if (library.startsWith('H5P.InteractiveVideo ')) {
    parameters = structuredClone(parameters);
    const tracks = parameters.interactiveVideo?.video?.textTracks;
    if (Array.isArray(tracks?.videoTrack)) tracks.videoTrack = tracks.videoTrack.filter(item => item.track?.path);
  }
  // ImageCoordinateSelector emits legacyPositioning only when it is true.
  // Modern positions omit it, although this library's semantics require it.
  if (library.startsWith('H5P.ImageHotspots ')) {
    parameters = structuredClone(parameters);
    for (const hotspot of parameters.hotspots || []) {
      if (object(hotspot.position) && hotspot.position.legacyPositioning === undefined) {
        hotspot.position.legacyPositioning = false;
      }
    }
  }
  const references = new Map();
  let nodes = 0;
  const visit = (value, depth = 0) => {
    if (++nodes > 12000 || depth > 32) fail('The activity is too complex.');
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string') references.set(value.path, value);
    Object.values(value).forEach(child => visit(child, depth + 1));
  };
  visit(parameters);
  const normalized = normalizeStudioParameters(library, parameters, catalog.libraries, references);
  if (!studioMediaPaths(normalized).length) fail('Add real media and complete the required fields before saving or previewing.');
  return parameters;
}
