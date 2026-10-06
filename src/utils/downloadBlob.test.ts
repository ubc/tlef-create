import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './downloadBlob';

describe('downloadBlob', () => {
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:download'), revokeObjectURL });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('leaves the resource available while the browser begins saving, then releases it', () => {
    let connectedAtClick = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      connectedAtClick = this.isConnected;
      expect(this.download).toBe('activity.h5p');
    });

    downloadBlob(new Blob(['package']), 'activity.h5p');

    expect(connectedAtClick).toBe(true);
    expect(document.querySelector('a[download="activity.h5p"]')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_000);
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('releases the resource immediately if starting the download throws', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Cannot start download'); });
    expect(() => downloadBlob(new Blob(['package']), 'activity.h5p')).toThrow('Cannot start download');
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="activity.h5p"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
