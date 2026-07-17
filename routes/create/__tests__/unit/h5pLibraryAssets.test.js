import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';
import LIBRARY_REGISTRY, { getNeededLibraries } from '../../config/h5pLibraryRegistry.js';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const LIBRARIES_DIRECTORY = path.resolve(TEST_DIRECTORY, '../../h5p-libs');

function readLibraryJson(machineName) {
  const registryEntry = LIBRARY_REGISTRY[machineName];
  expect(registryEntry).toBeDefined();

  const libraryDirectory = path.join(LIBRARIES_DIRECTORY, registryEntry.dirName);
  const libraryJsonPath = path.join(libraryDirectory, 'library.json');
  expect(fs.existsSync(libraryJsonPath)).toBe(true);

  return {
    libraryDirectory,
    libraryJson: JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'))
  };
}

function expectLocalCssAssetsToExist(cssPath) {
  const css = fs.readFileSync(cssPath, 'utf8');
  const assetReferences = css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g);

  for (const [, reference] of assetReferences) {
    if (/^(?:data:|https?:|#)/.test(reference)) {
      continue;
    }

    const assetPath = path.resolve(path.dirname(cssPath), reference.split(/[?#]/, 1)[0]);
    expect(fs.existsSync(assetPath)).toBe(true);
  }
}

function expectDeclaredAssetsToExist(machineName) {
  const { libraryDirectory, libraryJson } = readLibraryJson(machineName);
  const declaredAssets = [
    ...(libraryJson.preloadedJs || []),
    ...(libraryJson.preloadedCss || [])
  ];

  for (const { path: relativePath } of declaredAssets) {
    const assetPath = path.join(libraryDirectory, relativePath);
    expect(fs.existsSync(assetPath)).toBe(true);

    if (relativePath.endsWith('.css')) {
      expectLocalCssAssetsToExist(assetPath);
    }
  }
}

describe('vendored H5P library assets', () => {
  test('Documentation Tool dependency assets are present', () => {
    const libraries = getNeededLibraries(new Set(['documentation-tool']));

    for (const machineName of libraries) {
      expectDeclaredAssetsToExist(machineName);
    }
  });

  test('Components assets used by composite content types are present', () => {
    expectDeclaredAssetsToExist('H5P.Components');
  });

  test('Document Export Page 1.5 uses its version-matched dependencies', () => {
    const { libraryJson } = readLibraryJson('H5P.DocumentExportPage');
    const dependencyNames = libraryJson.preloadedDependencies.map(({ machineName }) => machineName);

    expect(dependencyNames).toContain('H5P.JoubelUI');
    expect(dependencyNames).not.toContain('H5P.Components');
  });
});
