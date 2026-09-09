import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const libraryRoot = fileURLToPath(new URL('../h5p-libs/', import.meta.url));
const mediaTypes = new Set(['Agamotto', 'Audio', 'Collage', 'Dictation', 'DragQuestion', 'ImageHotspotQuestion', 'ImageHotspots', 'ImageSlider', 'InteractiveVideo', 'MemoryGame', 'MultiMediaChoice']);
const externalTypes = new Set(['IFrameEmbed', 'TwitterUserFeed']);
const containers = new Set(['Column', 'InteractiveBook', 'QuestionSet', 'CoursePresentation', 'BranchingScenario']);
let cached;
let cachedAt = 0;

// Discover the SAME installed libraries that Lumi serves. Never install code
// from an AI response or accept a client-supplied filesystem path.
export function readStudioLibraries(root = libraryRoot) {
  const libraries = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[\w.-]+-\d+\.\d+$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const descriptorPath = path.join(directory, 'library.json');
    if (!fs.existsSync(descriptorPath)) continue;
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
    const library = `${descriptor.machineName} ${descriptor.majorVersion}.${descriptor.minorVersion}`;
    const semanticsPath = path.join(directory, 'semantics.json');
    libraries.set(library, {
      library, descriptor, directory,
      semantics: fs.existsSync(semanticsPath) ? JSON.parse(fs.readFileSync(semanticsPath, 'utf8')) : []
    });
  }
  return libraries;
}

export function libraryProblems(library, libraries, visited = new Set()) {
  if (visited.has(library)) return [];
  visited.add(library);
  const entry = libraries.get(library);
  if (!entry) return [`Missing installed dependency: ${library}`];
  const problems = [];
  const { descriptor, directory } = entry;
  // The installed Lumi configuration and vendored core currently use 1.27.
  if (descriptor.coreApi && (descriptor.coreApi.majorVersion > 1 || descriptor.coreApi.minorVersion > 27)) {
    problems.push(`${library} requires H5P core ${descriptor.coreApi.majorVersion}.${descriptor.coreApi.minorVersion}; CREATE uses 1.27.`);
  }
  for (const asset of [...(descriptor.preloadedJs || []), ...(descriptor.preloadedCss || [])]) {
    const filename = path.resolve(directory, asset.path);
    if (!filename.startsWith(`${directory}${path.sep}`) || !fs.existsSync(filename)) {
      problems.push(`Missing runtime asset in ${library}: ${asset.path}`);
    }
  }
  for (const dependency of [...(descriptor.preloadedDependencies || []), ...(descriptor.editorDependencies || []), ...(descriptor.dynamicDependencies || [])]) {
    problems.push(...libraryProblems(`${dependency.machineName} ${dependency.majorVersion}.${dependency.minorVersion}`, libraries, visited));
  }
  return problems;
}

export function buildStudioCatalog(libraries) {
  const latest = new Map();
  for (const entry of libraries.values()) {
    if (!entry.descriptor.runnable) continue;
    const previous = latest.get(entry.descriptor.machineName);
    const version = entry.descriptor.majorVersion * 10000 + entry.descriptor.minorVersion;
    const previousVersion = previous ? previous.descriptor.majorVersion * 10000 + previous.descriptor.minorVersion : -1;
    const usable = libraryProblems(entry.library, libraries).length === 0;
    const previousUsable = previous && libraryProblems(previous.library, libraries).length === 0;
    if (!previous || (usable && !previousUsable) || (usable === previousUsable && version > previousVersion)) latest.set(entry.descriptor.machineName, entry);
  }
  return [...latest.values()].map(entry => {
    const name = entry.descriptor.machineName.replace(/^H5P\./, '');
    const problems = libraryProblems(entry.library, libraries);
    const needsTemplate = mediaTypes.has(name) || externalTypes.has(name);
    return {
      library: entry.library, machineName: entry.descriptor.machineName,
      title: entry.descriptor.title, version: `${entry.descriptor.majorVersion}.${entry.descriptor.minorVersion}.${entry.descriptor.patchVersion}`,
      category: containers.has(name) ? 'Lessons & collections' : externalTypes.has(name) ? 'External content' : mediaTypes.has(name) ? 'Media activities' : 'Questions & text activities',
      mode: problems.length ? 'unavailable' : needsTemplate ? 'template' : 'generate',
      guidance: problems.length ? problems[0] : externalTypes.has(name)
        ? 'Save a working activity with your real URL or account first. AI can adapt its text; the external service must allow embedding.'
        : needsTemplate ? 'Create and save a template with real media first. AI can adapt the activity while keeping those files.'
          : 'Generate an editable draft from your teaching instructions, then check it in the official editor.',
      problems
    };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

export function getStudioCatalog() {
  if (!cached || Date.now() - cachedAt > 30000) {
    const libraries = readStudioLibraries();
    cached = { libraries, types: buildStudioCatalog(libraries) };
    cachedAt = Date.now();
  }
  return cached;
}
