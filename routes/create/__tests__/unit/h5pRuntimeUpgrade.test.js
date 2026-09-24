import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import branchingQuiz from '../fixtures/branchingRuntimeQuiz.js';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { buildNativeH5PDocument, createH5PPackage } from '../../services/h5pExportService.js';
import { renderNativeH5PPreview } from '../../services/h5pNativePreviewService.js';
import { getStudioCatalog, libraryProblems } from '../../services/h5pStudioCatalog.js';
import { assertH5PLibraryIntegrity } from '../../services/h5pLibraryIntegrity.js';
import { getQuestionTypeAvailability } from '../../utils/questionTypeAvailability.js';
import { saveNativeH5PDocument } from '../../services/h5pEditorService.js';
import { getEditor, getSystemUser, initializeLumi } from '../../services/lumiService.js';
import { H5P_CORE_SCRIPTS, H5P_CORE_STYLES } from '../../config/h5pRuntime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');


describe('pinned H5P core 1.28 and Branching runtime', () => {
  test('pins the installed core, editor, descriptors and compiled bundles to the recorded upstream build', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'config/h5p-runtime-manifest.json'), 'utf8'));
    expect(manifest.coreApi).toBe('1.28');
    const entries = [...manifest.core, ...manifest.libraries.map(entry => ({ ...entry, directory: `h5p-libs/${entry.directory}` })), manifest.supportAssets];
    for (const entry of entries) {
      for (const [relativePath, expectedHash] of Object.entries(entry.installedAssetSha256)) {
        const bytes = await fs.readFile(path.join(root, entry.directory, relativePath));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedHash);
      }
    }
  });

  test('retains both Branching minor versions with a complete authoring dependency tree', async () => {
    const { libraries } = getStudioCatalog();
    const closure = new Map();
    const visit = name => {
      if (closure.has(name)) return;
      const entry = libraries.get(name);
      expect(entry).toBeDefined();
      const { descriptor } = entry;
      closure.set(name, { dirName: path.basename(entry.directory) });
      for (const dependency of [...(descriptor.preloadedDependencies || []), ...(descriptor.editorDependencies || []), ...(descriptor.dynamicDependencies || [])]) {
        visit(`${dependency.machineName} ${dependency.majorVersion}.${dependency.minorVersion}`);
      }
    };
    for (const version of ['1.9', '1.10']) {
      const name = `H5P.BranchingScenario ${version}`;
      expect(libraryProblems(name, libraries)).toEqual([]);
      visit(name);
    }
    expect(closure.has('H5PEditor.BranchingQuestion 1.0')).toBe(true);
    expect(closure.has('H5P.CoursePresentation 1.27')).toBe(true);
    expect(closure.has('H5P.InteractiveVideo 1.28')).toBe(true);
    await expect(assertH5PLibraryIntegrity(closure, path.join(root, 'h5p-libs'))).resolves.toBeUndefined();
    expect(getQuestionTypeAvailability('branching-scenario')).toEqual({ available: true });
  });

  test('exports a self-contained Branching package and reopens its exact native parameters through Lumi', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'create-branching-roundtrip-'));
    const user = { id: 'branching-runtime-acceptance', name: 'Runtime acceptance', email: 'runtime@example.invalid', type: 'local' };
    let contentId;
    try {
      const document = await buildNativeH5PDocument(branchingQuiz);
      const packagePath = path.join(directory, 'branching.h5p');
      await createH5PPackage(branchingQuiz, packagePath, { document });
      const archive = new AdmZip(packagePath);
      expect(JSON.parse(archive.readAsText('content/content.json'))).toEqual(document.parameters);
      const queue = [...document.metadata.preloadedDependencies];
      const visited = new Set();
      while (queue.length) {
        const dependency = queue.shift();
        const folder = `${dependency.machineName}-${dependency.majorVersion}.${dependency.minorVersion}`;
        if (visited.has(folder)) continue;
        visited.add(folder);
        expect(archive.getEntry(`${folder}/library.json`)).not.toBeNull();
        const descriptor = JSON.parse(archive.readAsText(`${folder}/library.json`));
        for (const asset of [...(descriptor.preloadedJs || []), ...(descriptor.preloadedCss || [])]) {
          expect(archive.getEntry(`${folder}/${asset.path}`)).not.toBeNull();
        }
        queue.push(...(descriptor.preloadedDependencies || []), ...(descriptor.editorDependencies || []), ...(descriptor.dynamicDependencies || []));
      }
      expect(visited.has('H5PEditor.BranchingScenario-1.5')).toBe(true);
      expect(visited.has('H5PEditor.BranchingQuestion-1.0')).toBe(true);
      archive.extractAllTo(directory, true);
      const html = await renderNativeH5PPreview(document, {
        libraryPath: directory, libraryBasePath: '/h5p-preview-files/acceptance',
        contentBasePath: '/h5p-preview-files/acceptance/content', contentId: 'acceptance'
      });
      expect(html).toContain('/h5p-preview-files/acceptance/H5P.BranchingScenario-1.10/dist/');
      expect(html).not.toContain('cdnjs.cloudflare.com');
      expect(html).not.toContain('/core/h5p-core.js');

      await initializeLumi();
      const editor = getEditor();
      const saved = await saveNativeH5PDocument(editor, document, user);
      contentId = saved.id;
      const reopened = await editor.getContent(contentId, user);
      expect(reopened.library).toBe('H5P.BranchingScenario 1.10');
      expect(JSON.parse(JSON.stringify(reopened.params.params))).toEqual(document.parameters);
    } finally {
      if (contentId) await getEditor().deleteContent(contentId, getSystemUser());
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test.each(['1.9', '1.10'])('executes the real %s bundle with the official core and preserves branch/end targets', async version => {
    const document = await buildNativeH5PDocument(branchingQuiz);
    document.library = `H5P.BranchingScenario ${version}`;
    document.metadata.preloadedDependencies.find(dep => dep.machineName === 'H5P.BranchingScenario').minorVersion = Number(version.split('.')[1]);
    document.parameters.branchingScenario.startScreen.startScreenTitle = branchingQuiz.name;
    document.parameters.branchingScenario.endScreens = [
      { contentId: -1, endScreenTitle: 'Safe choice', endScreenSubtitle: 'You checked the equipment.', endScreenScore: 0 },
      { contentId: -2, endScreenTitle: 'Review the safety check', endScreenSubtitle: 'Stop before using the equipment.', endScreenScore: 0 }
    ];
    const html = await renderNativeH5PPreview(document);
    expect(html).not.toContain('/core/h5p-core.js');
    for (const asset of [...H5P_CORE_SCRIPTS, ...H5P_CORE_STYLES]) expect(html).toContain(`/core/${asset}?createRevision=`);
    const runtime = JSON.parse(execFileSync(process.execPath, [path.join(root, '__tests__/fixtures/runH5PPreviewRuntime.mjs')], {
      input: JSON.stringify(document), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 10000
    }));
    expect(runtime.errors).toEqual([]);
    expect(runtime.instanceCount).toBe(1);
    expect(runtime.library).toBe(document.library);
    expect(runtime.targets).toEqual([-1, -2]);
    expect(runtime.text).toContain(branchingQuiz.name);
    expect(runtime.endScreenIds).toEqual(['-1', '-2']);
  });
});
