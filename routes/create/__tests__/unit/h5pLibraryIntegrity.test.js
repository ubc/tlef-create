import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { assertH5PLibraryIntegrity } from '../../services/h5pLibraryIntegrity.js';
import { createH5PPackage } from '../../services/h5pExportService.js';
import { getStudioCatalog } from '../../services/h5pStudioCatalog.js';

describe('H5P export asset integrity', () => {
  test('rejects a missing declared asset before creating the output package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-integrity-'));
    const library = 'H5P.Test-1.0';
    const directory = path.join(root, library);
    const allLibs = new Map([[library, { dirName: library }]]);
    const outputPath = path.join(root, 'broken.h5p');
    try {
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, 'library.json'), JSON.stringify({ preloadedJs: [{ path: 'missing.js' }] }));
      const document = { metadata: {}, parameters: {}, packaging: {
        allLibs, containerMode: 'standalone', libraryPath: root, questionTypes: new Set(['multiple-choice'])
      } };
      await expect(createH5PPackage({}, outputPath, { document })).rejects.toMatchObject({ code: 'MISSING_H5P_PACKAGE_ASSETS' });
      await expect(fs.access(outputPath)).rejects.toThrow();
      await fs.writeFile(path.join(directory, 'missing.js'), '/* installed runtime */');
      await expect(assertH5PLibraryIntegrity(allLibs, root)).resolves.toBeUndefined();
      await fs.writeFile(path.join(directory, 'library.json'), JSON.stringify({ preloadedCss: [{ path: 'style.css' }] }));
      await fs.writeFile(path.join(directory, 'style.css'), '.icon{background:url(icons/missing.svg)}');
      await expect(assertH5PLibraryIntegrity(allLibs, root)).rejects.toMatchObject({ code: 'MISSING_H5P_PACKAGE_ASSETS' });
      await fs.writeFile(path.join(directory, 'style.css'), '/* Theme generator: url(not-a-runtime-asset.png) */ .icon{color:red}');
      await expect(assertH5PLibraryIntegrity(allLibs, root)).resolves.toBeUndefined();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  test('blocks an incomplete Branching installation with an actionable reason while preserving its source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-unavailable-'));
    const libraries = getStudioCatalog().libraries;
    const editor = libraries.get('H5PEditor.BranchingScenario 1.5');
    libraries.delete('H5PEditor.BranchingScenario 1.5');
    try {
      const outputPath = path.join(root, 'branching.h5p');
      await expect(createH5PPackage({}, outputPath, { document: {
        metadata: {}, parameters: {}, packaging: {
          allLibs: new Map(), libraryPath: root, questionTypes: new Set(['branching-scenario'])
        }
      } })).rejects.toMatchObject({ code: 'QUESTION_TYPE_UNAVAILABLE', message: expect.stringContaining('Existing activities are kept') });
      await expect(fs.access(outputPath)).rejects.toThrow();
    } finally {
      libraries.set('H5PEditor.BranchingScenario 1.5', editor);
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

test('packages runtime assets but excludes development files rejected by H5P import', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-package-files-'));
  const library = 'H5P.Test-1.0';
  const directory = path.join(root, library);
  try {
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'library.json'), JSON.stringify({preloadedJs: [{path: 'runtime.js'}], preloadedCss: [{path: 'runtime.css'}]}));
    for (const [name, body] of Object.entries({'runtime.js':'/* runtime */','runtime.css':'.icon{background:url(icon.svg)}','icon.svg':'<svg/>','theme.scss':'$color: red;', 'crowdin.yml':'files: []'})) {
      await fs.writeFile(path.join(directory, name), body);
    }
    const output = path.join(root, 'valid.h5p');
    await createH5PPackage({}, output, {document: {metadata: {}, parameters: {}, packaging: {
      allLibs: new Map([[library,{dirName:library}]]), libraryPath:root, questionTypes:new Set()
    }}});
    const entries = new AdmZip(output).getEntries().map(entry => entry.entryName);
    expect(entries).toEqual(expect.arrayContaining([`${library}/library.json`,`${library}/runtime.js`,`${library}/runtime.css`,`${library}/icon.svg`]));
    expect(entries.some(name => /\.(scss|yml)$/.test(name))).toBe(false);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
