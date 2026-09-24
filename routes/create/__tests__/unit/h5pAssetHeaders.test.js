import { describe, expect, jest, test } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { allowSandboxedH5PAsset } from '../../middleware/h5pAssetHeaders.js';

describe('sandboxed H5P asset headers', () => {
  test('allows icon fonts and other public runtime assets in opaque-origin previews', () => {
    const setHeader = jest.fn();
    const next = jest.fn();

    allowSandboxedH5PAsset({}, { setHeader }, next);

    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('the resize bridge supports sandboxed frames whose origin is opaque', async () => {
    const source = await readFile(
      new URL('../../h5p-core/js/h5p-resizer.js', import.meta.url),
      'utf8'
    );

    expect(source).toContain("window.origin === 'null' || event.origin === 'null'");
    expect(source).toContain("? '*'");
    expect(source).toContain('event.source.postMessage(data, targetOrigin)');
  });
});
