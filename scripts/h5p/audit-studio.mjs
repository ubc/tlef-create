/** Audit actual installed editor coverage against the maintained target manifest. */
import fs from 'node:fs';
import { getStudioCatalog, libraryProblems } from '../../routes/create/services/h5pStudioCatalog.js';
const targets = JSON.parse(fs.readFileSync(new URL('../../routes/create/config/h5p-studio-targets.json', import.meta.url)));
const { types, libraries } = getStudioCatalog();
const results = targets.types.map(target => {
  const type = types.find(item => item.machineName === target.machineName);
  const problems = type ? libraryProblems(type.library, libraries) : ['Not installed'];
  if (type?.mode === 'unavailable' && !problems.length) problems.push(type.guidance);
  if (target.editorOnly && type?.mode !== 'manual') problems.push('Editor-only target was exposed to AI');
  return { machineName: target.machineName, title: type?.title, library: type?.library, version: type?.version, mode: type?.mode, problems };
});
const passed = results.every(result => !result.problems.length) && new Set(results.map(result => result.machineName)).size === results.length;
console.log(JSON.stringify({ source: targets.source, targetCount: results.length, availableTargets: results.filter(result => !result.problems.length).length,
  installedRunnableTypes: types.length, usableEditorTypes: types.filter(type => type.mode !== 'unavailable').length,
  extraUsableTypes: types.filter(type => type.mode !== 'unavailable' && !results.some(result => result.machineName === type.machineName)).map(type => type.machineName),
  passed, results }, null, 2));
if (!passed) process.exitCode = 1;
