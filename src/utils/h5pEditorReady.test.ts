import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForH5PEditorAssets } from './h5pEditorReady';

describe('native editor readiness', () => {
  afterEach(() => vi.useRealTimers());
  it('waits for nested library assets instead of trusting the root loaded event', async () => {
    vi.useFakeTimers();
    const runtime = { $: { active: 1 }, libraryCache: { Nested: {} }, libraryLoaded: { Nested: false } };
    const element = Object.assign(document.createElement('div'), { editorInstance: { iframeWindow: { H5PEditor: runtime } } });
    let resolved = false;
    const ready = waitForH5PEditorAssets(element, () => true).then(value => { resolved = value; return value; });
    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toBe(false);
    runtime.$.active = 0;
    runtime.libraryLoaded.Nested = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(await ready).toBe(true);
  });
  it('does not wait forever or update an abandoned editor', async () => {
    vi.useFakeTimers();
    const element = Object.assign(document.createElement('div'), { editorInstance: { iframeWindow: { H5PEditor: { $: { active: 1 } } } } });
    const ready = waitForH5PEditorAssets(element, () => true);
    await vi.advanceTimersByTimeAsync(15100);
    expect(await ready).toBe(false);
    expect(await waitForH5PEditorAssets(element, () => false)).toBe(false);
  });
});
