import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StudioPreview from './StudioPreview';

describe('StudioPreview', () => {
  it('follows H5P resize handshakes, growing and shrinking after interactions', () => {
    render(<StudioPreview contentId="123" title="Activity" />);
    const frame = screen.getByTitle('Preview Activity') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    const receive = (data: object) => fireEvent(window, new MessageEvent('message', {
      origin: window.location.origin, source: frame.contentWindow,
      data: { context: 'h5p', ...data }
    }));
    fireEvent.load(frame);
    expect(post).toHaveBeenCalledWith({ context: 'h5p', action: 'ready' }, window.location.origin);
    receive({ action: 'hello' });
    expect(post).toHaveBeenCalledWith({ context: 'h5p', action: 'hello' }, window.location.origin);
    receive({ action: 'prepareResize', clientHeight: 1400 });
    expect(post).toHaveBeenCalledWith({ context: 'h5p', action: 'resizePrepared' }, window.location.origin);
    receive({ action: 'resize', scrollHeight: 1450.5 });
    expect(frame.style.height).toBe('1451px');
    receive({ action: 'prepareResize', clientHeight: 200 });
    receive({ action: 'resize', scrollHeight: 220 });
    expect(frame.style.height).toBe('220px');
    expect(frame).toHaveAttribute('allowfullscreen');
  });

  it('ignores unrelated frames, origins, malformed dimensions and unmounted previews', () => {
    const view = render(<StudioPreview contentId="123" title="Activity" />);
    const frame = screen.getByTitle('Preview Activity') as HTMLIFrameElement;
    const origin = window.location.origin;
    const source = frame.contentWindow;
    for (const data of [
      { origin: 'https://other.example', source, data: { context: 'h5p', action: 'resize', scrollHeight: 800 } },
      { origin, source: window, data: { context: 'h5p', action: 'resize', scrollHeight: 800 } },
      ...[-5, Infinity, NaN, '800', 100001].map(scrollHeight => ({ origin, source, data: { context: 'h5p', action: 'resize', scrollHeight } })),
      { origin, source, data: null }
    ]) fireEvent(window, new MessageEvent('message', data));
    expect(frame.style.height).toBe('');
    view.unmount();
    fireEvent(window, new MessageEvent('message', { origin, source, data: { context: 'h5p', action: 'resize', scrollHeight: 900 } }));
    expect(frame.style.height).toBe('');
  });
});
