import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';
import { getEditor, initializeLumi } from '../../services/lumiService.js';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CREATE_DIRECTORY = path.resolve(TEST_DIRECTORY, '../..');

function runtimeUrlToFile(url) {
  const pathname = new URL(url, 'http://localhost').pathname;

  if (pathname.includes('/h5p-editor/runtime/core/')) {
    return path.join(
      CREATE_DIRECTORY,
      'h5p-core',
      pathname.replace(/^.*\/h5p-editor\/runtime\/core\//, '')
    );
  }

  if (pathname.includes('/h5p-editor/runtime/editor/')) {
    return path.join(
      CREATE_DIRECTORY,
      'h5p-editor-core',
      pathname.replace(/^.*\/h5p-editor\/runtime\/editor\//, '')
    );
  }

  return null;
}

describe('H5P Studio runtime assets', () => {
  test('the official editor model only references committed core assets', async () => {
    await initializeLumi();
    const model = await getEditor().render(undefined, 'en', {
      id: 'runtime-asset-test',
      name: 'Runtime asset test',
      type: 'local'
    });
    const assetUrls = [...(model.scripts || []), ...(model.styles || [])];

    expect(assetUrls.length).toBeGreaterThan(0);
    for (const url of assetUrls) {
      const assetPath = runtimeUrlToFile(url);
      expect(assetPath).not.toBeNull();
      expect(fs.existsSync(assetPath)).toBe(true);
    }

    const expectBridgeBeforeCore = scripts => {
      const jqueryIndex = scripts.findIndex(url => /\/core\/js\/jquery\.js(?:\?|$)/.test(url));
      const bridgeIndex = scripts.findIndex(url => /\/core\/js\/h5p-jquery-bridge\.js(?:\?|$)/.test(url));
      const coreIndex = scripts.findIndex(url => /\/core\/js\/h5p\.js(?:\?|$)/.test(url));

      expect(jqueryIndex).toBeGreaterThanOrEqual(0);
      expect(bridgeIndex).toBe(jqueryIndex + 1);
      expect(coreIndex).toBe(bridgeIndex + 1);
    };

    expectBridgeBeforeCore(model.scripts);
    expectBridgeBeforeCore(model.integration.editor.assets.js);
  });

  test('authors receive installed types without Hub installation permission', async () => {
    await initializeLumi();
    const cache = await getEditor().getContentTypeCache({
      id: 'content-type-test',
      name: 'Content type test',
      type: 'local'
    });

    expect(cache.libraries.length).toBeGreaterThan(0);
    expect(cache.libraries.every(library => library.installed)).toBe(true);
    expect(cache.libraries.every(library => library.canInstall === false)).toBe(true);
  });

});
