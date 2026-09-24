import fs from 'node:fs/promises';
import path from 'node:path';

/** Validate every packaged library before opening an output archive. */
export async function assertH5PLibraryIntegrity(libraries, libraryPath) {
  const problems = [];
  for (const library of libraries.values()) {
    const directory = path.resolve(libraryPath, library.dirName);
    let descriptor;
    try {
      descriptor = JSON.parse(await fs.readFile(path.join(directory, 'library.json'), 'utf8'));
    } catch {
      problems.push(`${library.dirName}/library.json`);
      continue;
    }
    for (const asset of [...(descriptor.preloadedJs || []), ...(descriptor.preloadedCss || [])]) {
      const filename = path.resolve(directory, asset.path);
      if (!filename.startsWith(`${directory}${path.sep}`)) {
        problems.push(`${library.dirName}/${asset.path}`);
        continue;
      }
      try {
        if (!(await fs.stat(filename)).isFile()) throw new Error('Not a file');
        if (asset.path.endsWith('.css')) {
          // Theme-generator URLs in license comments are not loaded assets.
          const css = (await fs.readFile(filename, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
          for (const [, reference] of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
            if (/^(?:data:|https?:|\/\/|#)/i.test(reference)) continue;
            const relativeAsset = reference.split(/[?#]/, 1)[0];
            const cssAssetPath = path.resolve(path.dirname(filename), relativeAsset);
            if (!cssAssetPath.startsWith(`${directory}${path.sep}`)) throw new Error('Asset outside library');
            if (!(await fs.stat(cssAssetPath)).isFile()) throw new Error('Missing CSS asset');
          }
        }
      } catch {
        problems.push(`${library.dirName}/${asset.path} (or a referenced asset)`);
      }
    }
  }
  if (problems.length) {
    const error = new Error('This H5P package cannot be exported because required activity files are missing. Your saved content is unchanged; ask an administrator to repair the installed H5P libraries.');
    error.code = 'MISSING_H5P_PACKAGE_ASSETS';
    error.missingFiles = problems;
    throw error;
  }
}
