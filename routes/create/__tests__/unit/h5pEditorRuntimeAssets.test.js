import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, jest, test } from '@jest/globals';
import { getEditor, initializeLumi, renderPlayerPage } from '../../services/lumiService.js';
import vm from 'node:vm';
import { H5P_CORE_API, H5P_RUNTIME_REVISION, H5P_CORE_STYLES } from '../../config/h5pRuntime.js';

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
  test('renders a responsive native player without the demo download link', () => {
    const html = renderPlayerPage({
      contentId: '123', downloadPath: '/download/123', styles: ['/native.css'],
      scripts: ['/api/create/h5p-editor/runtime/core/js/jquery.js', '/api/create/h5p-editor/runtime/core/js/h5p.js'],
      integration: { title: '</script><script>alert(1)</script>' }
    });
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(html.indexOf('jquery.js')).toBeLessThan(html.indexOf('h5p-jquery-bridge.js'));
    expect(html.indexOf('h5p-jquery-bridge.js')).toBeLessThan(html.indexOf('/core/js/h5p.js'));
    expect(html).not.toContain('>Download</button>');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('data-content-id="123"');
  });
  test('resolves preview media inside the authenticated activity content directory', async () => {
    const { h5pPlayer } = await initializeLumi();
    expect(h5pPlayer.urlGenerator.contentFilesUrl('12345')).toBe('/api/create/h5p-editor/runtime/content/12345');
    expect(h5pPlayer.urlGenerator.contentFilesUrl('67890')).toBe('/api/create/h5p-editor/runtime/content/67890');
  });
  test('initializes a single-choice nested library exactly once', () => {
    const ns = { createOption: () => '', widgets: {} };
    vm.runInNewContext(fs.readFileSync(path.join(CREATE_DIRECTORY, 'h5p-editor-core/scripts/h5peditor-library.js'), 'utf8'), { ns, H5P: { EventDispatcher: function () {} } });
    const select = { html: () => select, change: () => select, hide: () => select, children: () => ({ val: () => 'H5P.Column 1.18' }) };
    const instance = {
      params: { library: 'H5P.Column 1.18' }, $select: select,
      $myField: { children: () => ({ hide: () => {} }) }, $clearfix: { hide: () => {} },
      loadLibrary: jest.fn(), updateCopyPasteButtons: jest.fn()
    };
    ns.Library.prototype.librariesLoaded.call(instance, [{ uberName: 'H5P.Column 1.18', title: 'Column' }]);
    expect(instance.loadLibrary).toHaveBeenCalledTimes(1);
    expect(instance.loadLibrary).toHaveBeenCalledWith('H5P.Column 1.18', true);
  });

  test('falls back to the standard widget if an optional custom widget is absent', () => {
    const chain = new Proxy({}, { get: () => () => chain });
    const H5P = { jQuery: () => chain, EventDispatcher: function () {} };
    H5P.EventDispatcher.prototype.trigger = () => {};
    const append = jest.fn();
    const H5PEditor = { getNextFieldId: () => 'field', createImportance: () => '', DefaultList: function () { this.appendTo = append; } };
    const context = vm.createContext({ H5P, H5PEditor });
    vm.runInContext(fs.readFileSync(path.join(CREATE_DIRECTORY, 'h5p-editor-core/scripts/h5peditor-semantic-structure.js'), 'utf8'), context);
    vm.runInContext('new H5PEditor.SemanticStructure({name: "items", type: "list", widgets: [{name: "MissingWidget"}]}, {name: "DefaultList"}).appendTo({})', context);
    expect(append).toHaveBeenCalledTimes(1);
  });
  test('shares one Lumi runtime across concurrent startup callers', async () => {
    const [first, second] = await Promise.all([initializeLumi(), initializeLumi()]);

    expect(first.h5pEditor).toBe(second.h5pEditor);
    expect(first.h5pPlayer).toBe(second.h5pPlayer);
  });

  test('the official editor model only references committed core assets', async () => {
    await initializeLumi();
    const model = await getEditor().render(undefined, 'en', {
      id: 'runtime-asset-test',
      name: 'Runtime asset test',
      type: 'local'
    });
    const assetUrls = [...(model.scripts || []), ...(model.styles || [])];

    const patched = [...model.scripts, ...model.integration.editor.assets.js].filter(url => /h5peditor-(library|semantic-structure)\.js/.test(url));
    expect(patched.length).toBeGreaterThan(0);
    expect(patched.every(url => new URL(url, 'http://localhost').searchParams.get('createRevision') === H5P_RUNTIME_REVISION)).toBe(true);
    expect(getEditor().config.coreApiVersion).toEqual(H5P_CORE_API);
    for (const asset of H5P_CORE_STYLES) {
      expect(model.styles.some(url => url.includes(`/core/${asset}?`))).toBe(true);
      expect(model.integration.editor.assets.css.some(url => url.includes(`/core/${asset}?`))).toBe(true);
    }

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
    // Test local availability/permissions independently from H5P Hub uptime.
    const hub = jest.spyOn(getEditor().contentTypeCache, 'get').mockResolvedValue([]);
    try {
    const cache = await getEditor().getContentTypeCache({
      id: 'content-type-test',
      name: 'Content type test',
      type: 'local'
    });

    expect(cache.libraries.length).toBeGreaterThan(0);
    expect(cache.libraries.every(library => library.installed)).toBe(true);
    expect(cache.libraries.every(library => library.canInstall === false)).toBe(true);
    expect(cache.libraries.find(library => library.machineName === 'H5P.Dictation')).toMatchObject({ majorVersion: 1, minorVersion: 3 });
    expect(cache.libraries.find(library => library.machineName === 'H5P.BranchingScenario')).toMatchObject({ majorVersion: 1, minorVersion: 10, patchVersion: 1 });
    } finally { hub.mockRestore(); }
  });

  test('official editor rejects invalid required fields before Lumi saves', () => {
    const ns = {};
    vm.runInNewContext(fs.readFileSync(path.join(CREATE_DIRECTORY, 'h5p-editor-core/scripts/h5peditor-library-selector.js'), 'utf8'), {
      ns, H5P: { EventDispatcher: function () {} }, window: {}, document: {}
    });
    const validate = jest.fn().mockReturnValue(false);
    const form = { metadataForm: { children: [] }, children: [{ validate }], params: { answer: '' } };
    expect(ns.LibrarySelector.prototype.getParams.call({ form })).toBe(false);
    validate.mockReturnValue(true);
    expect(ns.LibrarySelector.prototype.getParams.call({ form })).toBe(form.params);
  });

});
