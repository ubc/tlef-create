import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import {
  renderNativeH5PPreview,
  resolveNativePreviewAssets
} from '../../services/h5pNativePreviewService.js';

async function writeLibrary(basePath, name, libraryJson, assets = {}) {
  const libraryPath = path.join(basePath, name);
  await fs.mkdir(libraryPath, { recursive: true });
  await fs.writeFile(path.join(libraryPath, 'library.json'), JSON.stringify(libraryJson));
  for (const [relativePath, content] of Object.entries(assets)) {
    const assetPath = path.join(libraryPath, relativePath);
    await fs.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.writeFile(assetPath, content);
  }
}

describe('native H5P preview service', () => {
  test('loads transitive runtime dependencies before their parent library', async () => {
    const libraryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tlef-h5p-preview-'));
    try {
      await writeLibrary(libraryPath, 'H5P.Child-1.0', {
        machineName: 'H5P.Child',
        majorVersion: 1,
        minorVersion: 0,
        preloadedJs: [{ path: 'child.js' }]
      }, { 'child.js': 'window.Child = true;' });
      await writeLibrary(libraryPath, 'H5P.Parent-1.0', {
        machineName: 'H5P.Parent',
        majorVersion: 1,
        minorVersion: 0,
        preloadedDependencies: [{ machineName: 'H5P.Child', majorVersion: 1, minorVersion: 0 }],
        preloadedJs: [{ path: 'parent.js' }],
        preloadedCss: [{ path: 'parent.css' }]
      }, {
        'parent.js': 'window.Parent = true;',
        'parent.css': '.parent {}'
      });

      const assets = await resolveNativePreviewAssets({
        preloadedDependencies: [{ machineName: 'H5P.Parent', majorVersion: 1, minorVersion: 0 }]
      }, { libraryPath });

      expect(assets.jsFiles).toEqual([
        'H5P.Child-1.0/child.js',
        'H5P.Parent-1.0/parent.js'
      ]);
      expect(assets.cssFiles).toEqual(['H5P.Parent-1.0/parent.css']);
      expect(assets.missingFiles).toEqual([]);
    } finally {
      await fs.rm(libraryPath, { recursive: true, force: true });
    }
  });

  test('renders the canonical root document and safely serializes authored text', async () => {
    const libraryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tlef-h5p-preview-'));
    try {
      await writeLibrary(libraryPath, 'H5P.Example-1.0', {
        machineName: 'H5P.Example',
        majorVersion: 1,
        minorVersion: 0,
        preloadedJs: [{ path: 'example.js' }]
      }, { 'example.js': 'window.Example = true;' });

      const html = await renderNativeH5PPreview({
        library: 'H5P.Example 1.0',
        metadata: {
          title: 'Example',
          mainLibrary: 'H5P.Example',
          preloadedDependencies: [{ machineName: 'H5P.Example', majorVersion: 1, minorVersion: 0 }]
        },
        parameters: { text: '</script><script>alert("unsafe")</script>' }
      }, { libraryPath });

      expect(html).toContain('H5P.Example 1.0');
      expect(html).toContain('H5P.Example-1.0/example.js');
      expect(html).not.toContain('</script><script>alert');
      expect(html).toContain('\\u003c/script\\u003e');
      expect(html).toContain("type: 'tlef:h5p-preview-height'");
      expect(html).toContain("observe(document.getElementById('h5p-native-preview'))");
    } finally {
      await fs.rm(libraryPath, { recursive: true, force: true });
    }
  });

  test('fails explicitly when a declared runtime asset is absent', async () => {
    const libraryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tlef-h5p-preview-'));
    try {
      await writeLibrary(libraryPath, 'H5P.Broken-1.0', {
        machineName: 'H5P.Broken',
        majorVersion: 1,
        minorVersion: 0,
        preloadedJs: [{ path: 'missing.js' }]
      });

      await expect(renderNativeH5PPreview({
        library: 'H5P.Broken 1.0',
        metadata: {
          title: 'Broken',
          mainLibrary: 'H5P.Broken',
          preloadedDependencies: [{ machineName: 'H5P.Broken', majorVersion: 1, minorVersion: 0 }]
        },
        parameters: {}
      }, { libraryPath })).rejects.toMatchObject({
        code: 'MISSING_H5P_PREVIEW_ASSETS'
      });
    } finally {
      await fs.rm(libraryPath, { recursive: true, force: true });
    }
  });
});
