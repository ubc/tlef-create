import { getStudioCatalog } from '../routes/create/services/h5pStudioCatalog.js';
import { normalizeStudioParameters } from '../routes/create/services/h5pStudioSemantics.js';

export const catalog = getStudioCatalog();
export const image = { path: 'images/fixture.png', mime: 'image/png', width: 32, height: 32 };
export const audio = { path: 'audios/fixture.wav', mime: 'audio/wav' };
export const video = { path: 'videos/fixture.mp4', mime: 'video/mp4' };
const seeds = {
  'H5P.DragQuestion': { question: { settings: { background: image, size: { width: 620, height: 310 } } } },
  'H5P.ImageHotspotQuestion': { imageHotspotQuestion: { backgroundImageSettings: image, hotspotSettings: { taskDescription: 'Select the blue area.', hotspot: [{ userSettings: { correct: true }, computedSettings: { x: 10, y: 10, width: 50, height: 50, figure: 'rect' } }] } } },
  'H5P.Collage': { collage: { template: '1', clips: [{ image, alt: 'Blue square' }] } },
  'H5P.Dialogcards': { dialogs: [{ text: 'Closest star to Earth', answer: 'The Sun' }] },
  'H5P.MultiChoice': { question: 'Which star is closest to Earth?', answers: [{ text: 'The Sun', correct: true }, { text: 'Sirius', correct: false }] },
  'H5P.TrueFalse': { question: 'The Sun is a star.', correct: 'true' },
  'H5P.Chart': { graphMode: 'barChart', listOfTypes: [{ text: 'Oak', value: 12 }, { text: 'Pine', value: 8 }] },
  'H5P.Blanks': { questions: ['The closest star to Earth is the *Sun*.'] },
  'H5P.DragText': { textField: 'The closest star to Earth is the *Sun*.' },
  'H5P.MarkTheWords': { taskDescription: 'Mark the star.', textField: 'Earth orbits the *Sun*.' },
  'H5P.GuessTheAnswer': { taskDescription: 'Which star is closest to Earth?', solutionText: 'The Sun' },
  'H5P.Crossword': { words: [{ answer: 'SUN', clue: 'Our closest star' }, { answer: 'MOON', clue: 'Earth’s natural satellite' }] },
  'H5P.Audio': { files: [audio], autoplay: false },
  'H5P.InteractiveVideo': { interactiveVideo: { video: { files: [video] } } },
  'H5P.Timeline': { timeline: { headline: 'Space milestones', type: 'default', text: 'A short timeline', date: [{ startDate: '1969,7,20', headline: 'Moon landing', text: 'Humans landed on the Moon.' }] } },
  'H5P.IFrameEmbed': { width: '640', minWidth: '320', height: '360', source: 'https://example.com' },
  'H5P.TwitterUserFeed': { userName: 'NASA', showReplies: false }
};

// Deterministic structural fixtures, NOT evidence of live model quality. Text,
// media and correct answers are synthetic and contain no instructor content.
export function fixtureFor(library) {
  let count = 0;
  const fill = (field, supplied, depth = 0) => {
    if (depth > 20) throw new Error('Fixture recursion exceeded');
    if (supplied === undefined && field.optional) return undefined;
    if (supplied === undefined && field.default !== undefined) supplied = structuredClone(field.default);
    if (field.type === 'group') {
      if (!field.root && field.fields?.length === 1 && !field.isSubContent) return fill(field.fields[0], supplied, depth + 1);
      return Object.fromEntries((field.fields || []).map(child => [child.name, fill(child, supplied?.[child.name], depth + 1)]).filter(([, value]) => value !== undefined));
    }
    if (field.type === 'list') {
      const items = supplied?.length ? supplied : Array.from({ length: Math.max(field.min || 1, 1) }, () => undefined);
      return items.map(value => fill(field.field, value, depth + 1));
    }
    if (field.type === 'library') {
      const available = field.options.filter(value => catalog.libraries.has(value));
      const preferred = ['AdvancedText', 'Text', 'MultiChoice', 'StandardPage', 'Column', 'OpenEndedQuestion'];
      const chosen = supplied?.library || preferred.flatMap(name => available.filter(value => value.startsWith(`H5P.${name} `)))[0] || available[0];
      return { library: chosen, params: build(chosen, supplied?.params, depth + 1), metadata: { title: 'Acceptance fixture' } };
    }
    if (supplied !== undefined) return supplied;
    if (field.type === 'image' || field.type === 'file') return image;
    if (field.type === 'audio') return [audio];
    if (field.type === 'video') return [video];
    if (field.type === 'number') return field.min ?? 1;
    if (field.type === 'boolean') return false;
    if (field.type === 'select') {
      if (!field.options && field.multiple) return ['0'];
      const choice = (field.options[0].options || field.options)[0].value;
      return field.multiple ? [choice] : choice;
    }
    if (/color/i.test(field.name || '')) return '#222222';
    return `Fixture ${++count}`;
  };
  const build = (name, overrides, depth = 0) => fill({ type: 'group', root: true, fields: catalog.libraries.get(name).semantics }, overrides || seeds[name.split(' ')[0]] || {}, depth);
  const params = build(library);
  const trusted = new Map([image, audio, video].map(file => [file.path, file]));
  return normalizeStudioParameters(library, params, catalog.libraries, trusted);
}
